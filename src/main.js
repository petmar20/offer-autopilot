const path = require('path');
const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, shell } = require('electron');
const { autoUpdater } = require('electron-updater');

const settingsStore = require('./settings');
const offerStore = require('./offerStore');
const { CitiSession, StopRequested } = require('./citi');
const { pickNextRunTime, pickCatchUpTime } = require('./scheduler');
const { isPriorityMerchant } = require('./priority');

const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.png');
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_LIVE_LOG_LINES = 400;

const state = {
  running: false,
  stopRequested: false,
  liveLog: [],
  update: null,
};

let mainWindow = null;
let tray = null;
let isQuitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => showWindow());

// ---------- window and tray ----------

function createWindow(showOnCreate) {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 500,
    show: showOnCreate,
    icon: ICON_PATH,
    title: 'Offer Autopilot',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Closing the window keeps the app running in the tray.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow(true);
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Offer Autopilot');
  tray.on('click', showWindow);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) {
    return;
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open', click: showWindow },
    state.running
      ? { label: 'Stop run', click: () => requestStop() }
      : { label: 'Run now', click: () => startRun('manual') },
    { type: 'separator' },
    { label: 'Quit', click: () => quitApp() },
  ]));
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

function notify(body) {
  if (Notification.isSupported()) {
    const notification = new Notification({ title: 'Offer Autopilot', body, icon: ICON_PATH });
    notification.on('click', showWindow);
    notification.show();
  }
}

// ---------- state sent to the window ----------

function buildState() {
  const settings = settingsStore.publicSettings();
  const data = offerStore.loadOffers();
  const offers = Object.values(data.offers).map((offer) => ({
    ...offer,
    cardLabel: data.cards[offer.accountId]?.label || '',
    isPriority: isPriorityMerchant(offer.merchantName, settings.priorityKeywords),
  }));
  return {
    version: app.getVersion(),
    settings,
    offers,
    runs: offerStore.loadRuns().map(({ log, ...run }) => run),
    running: state.running,
    liveLog: state.liveLog,
    update: state.update,
  };
}

function broadcast() {
  refreshTrayMenu();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state-changed', buildState());
  }
}

function log(line) {
  const stamped = `${new Date().toLocaleTimeString()}  ${line}`;
  state.liveLog.push(stamped);
  if (state.liveLog.length > MAX_LIVE_LOG_LINES) {
    state.liveLog.shift();
  }
  broadcast();
}

// ---------- runs and schedule ----------

function hasCredentials() {
  const settings = settingsStore.loadSettings();
  return Boolean(settings.username) && Boolean(settings.passwordEncrypted);
}

function scheduleNextRun(daysFromNow) {
  const settings = settingsStore.loadSettings();
  const next = pickNextRunTime(settings, new Date(), daysFromNow);
  settingsStore.updateSettings({ nextRunAt: next.toISOString() });
}

function prepareScheduleOnLaunch() {
  const settings = settingsStore.loadSettings();
  if (!settings.nextRunAt) {
    scheduleNextRun(0);
    if (new Date(settingsStore.loadSettings().nextRunAt) < new Date()) {
      scheduleNextRun(1);
    }
    return;
  }
  if (new Date(settings.nextRunAt) < new Date()) {
    settingsStore.updateSettings({ nextRunAt: pickCatchUpTime().toISOString() });
  }
}

function checkSchedule() {
  const { nextRunAt } = settingsStore.loadSettings();
  if (!state.running && hasCredentials() && nextRunAt && new Date(nextRunAt) <= new Date()) {
    startRun('scheduled');
  }
}

function describeResult(summary) {
  const enrolled = summary.enrolled.length;
  if (enrolled === 0) {
    return 'No new offers to enroll.';
  }
  const keywords = settingsStore.loadSettings().priorityKeywords;
  const priorityNames = [...new Set(summary.enrolled
    .filter((e) => isPriorityMerchant(e.merchant, keywords))
    .map((e) => e.merchant))];
  const plural = enrolled === 1 ? 'offer' : 'offers';
  if (priorityNames.length === 0) {
    return `Enrolled ${enrolled} new ${plural}.`;
  }
  return `Enrolled ${enrolled} new ${plural}, including ${priorityNames.slice(0, 4).join(', ')}.`;
}

async function startRun(trigger) {
  if (state.running) {
    return;
  }
  if (!hasCredentials()) {
    notify('Add your Citi user ID and password in Settings first.');
    showWindow();
    return;
  }

  state.running = true;
  state.stopRequested = false;
  state.liveLog = [];
  const run = { id: String(Date.now()), trigger, startedAt: new Date().toISOString(), status: 'running' };
  offerStore.saveRun(run);
  log(trigger === 'scheduled' ? 'Scheduled run started.' : 'Run started.');

  const session = new CitiSession({
    settings: settingsStore.loadSettings(),
    password: settingsStore.getPassword(),
    log,
    notify,
    shouldStop: () => state.stopRequested,
  });

  let summary = { enrolled: [], skipped: [], failed: [] };
  let nextRunDays = settingsStore.loadSettings().intervalDays;
  try {
    summary = await session.run();
    run.status = 'done';
    log(describeResult(summary));
    notify(describeResult(summary));
  } catch (error) {
    summary = error.summary || summary;
    if (error instanceof StopRequested) {
      run.status = 'stopped';
      log('Run stopped.');
    } else {
      run.status = 'failed';
      run.error = error.message;
      nextRunDays = 1;
      log(`Run failed: ${error.message}`);
      notify(`The run didn't finish: ${error.message}`);
    }
  }

  run.finishedAt = new Date().toISOString();
  run.enrolled = summary.enrolled;
  run.skipped = summary.skipped;
  run.failed = summary.failed;
  run.log = state.liveLog.slice();
  offerStore.saveRun(run);

  scheduleNextRun(nextRunDays);
  state.running = false;
  broadcast();
  installUpdateIfIdle();
}

function requestStop() {
  if (state.running) {
    state.stopRequested = true;
    log('Stopping after the current step.');
  }
}

// ---------- updates ----------

function setupAutoUpdate() {
  if (!app.isPackaged) {
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', (info) => {
    state.update = { version: info.version, ready: true };
    broadcast();
    installUpdateIfIdle();
  });
  autoUpdater.on('error', (error) => {
    console.error('Update check failed:', error.message);
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
}

// Install quietly when nothing is running and the window is not in use.
function installUpdateIfIdle() {
  const windowInUse = mainWindow && mainWindow.isVisible();
  if (state.update?.ready && !state.running && !windowInUse) {
    installUpdateNow();
  }
}

function installUpdateNow() {
  if (state.running) {
    return;
  }
  isQuitting = true;
  autoUpdater.quitAndInstall(true, true);
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.handle('get-state', () => buildState());

  ipcMain.handle('save-settings', (_event, changes) => {
    const { password, ...rest } = changes;
    const scheduleChanged = ['intervalDays', 'windowStartHour', 'windowEndHour']
      .some((key) => key in rest && rest[key] !== settingsStore.loadSettings()[key]);
    settingsStore.updateSettings(rest);
    if (password) {
      settingsStore.setPassword(password);
    }
    if (scheduleChanged) {
      scheduleNextRun(0);
      if (new Date(settingsStore.loadSettings().nextRunAt) < new Date()) {
        scheduleNextRun(1);
      }
    }
    applyLoginItem();
    broadcast();
    return buildState();
  });

  ipcMain.handle('reset-priority-keywords', () => {
    settingsStore.updateSettings({ priorityKeywords: settingsStore.DEFAULT_PRIORITY_KEYWORDS });
    broadcast();
    return buildState();
  });

  ipcMain.handle('run-now', () => {
    startRun('manual');
  });

  ipcMain.handle('stop-run', () => requestStop());

  ipcMain.handle('install-update', () => installUpdateNow());

  ipcMain.handle('get-run-log', (_event, runId) => {
    const run = offerStore.loadRuns().find((r) => r.id === runId);
    return run ? run.log || [] : [];
  });
}

function applyLoginItem() {
  if (!app.isPackaged) {
    return;
  }
  app.setLoginItemSettings({
    openAtLogin: settingsStore.loadSettings().openAtLogin,
    args: ['--hidden'],
  });
}

// ---------- startup ----------

app.whenReady().then(() => {
  app.setAppUserModelId('com.petmar20.offerautopilot');
  registerIpc();
  createTray();
  createWindow(!process.argv.includes('--hidden'));
  applyLoginItem();
  prepareScheduleOnLaunch();
  setInterval(checkSchedule, 60 * 1000);
  setupAutoUpdate();
  mainWindow.on('hide', installUpdateIfIdle);
});

app.on('window-all-closed', (event) => {
  // Stay in the tray.
  event.preventDefault();
});

app.on('before-quit', () => {
  isQuitting = true;
});
