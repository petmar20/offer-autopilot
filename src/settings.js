const path = require('path');
const { app, safeStorage } = require('electron');
const { readJson, writeJson } = require('./jsonFile');

const DEFAULT_PRIORITY_KEYWORDS = [
  'walmart', 'home depot', "lowe's", 'target', 'costco', "sam's club", "bj's",
  'kroger', 'stop & shop', 'shoprite', 'aldi', 'dollar general', 'dollar tree',
  'shell', 'bp', 'exxon', 'mobil', 'exxonmobil', 'chevron', 'sunoco', 'speedway',
  'wawa', 'circle k', 'valero', 'citgo', 'gulf', 'phillips 66', 'conoco', 'getty',
  'cumberland farms', 'sheetz', 'quiktrip', 'racetrac', "casey's", '7-eleven',
  'gas', 'fuel',
];

const DEFAULTS = {
  username: '',
  passwordEncrypted: '',
  intervalDays: 3,
  windowStartHour: 9,
  windowEndHour: 21,
  priorityKeywords: DEFAULT_PRIORITY_KEYWORDS,
  openAtLogin: true,
  nextRunAt: null,
};

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  return { ...DEFAULTS, ...readJson(settingsPath(), {}) };
}

function saveSettings(settings) {
  writeJson(settingsPath(), settings);
}

function updateSettings(changes) {
  const settings = { ...loadSettings(), ...changes };
  saveSettings(settings);
  return settings;
}

// The password is encrypted with Windows DPAPI, so only this Windows user can read it.
function setPassword(password) {
  const encrypted = safeStorage.encryptString(password).toString('base64');
  updateSettings({ passwordEncrypted: encrypted });
}

function getPassword() {
  const { passwordEncrypted } = loadSettings();
  if (!passwordEncrypted) {
    return '';
  }
  return safeStorage.decryptString(Buffer.from(passwordEncrypted, 'base64'));
}

// Settings safe to send to the window: never the password.
function publicSettings() {
  const { passwordEncrypted, ...rest } = loadSettings();
  return { ...rest, hasPassword: Boolean(passwordEncrypted) };
}

module.exports = {
  loadSettings,
  updateSettings,
  setPassword,
  getPassword,
  publicSettings,
  DEFAULT_PRIORITY_KEYWORDS,
};
