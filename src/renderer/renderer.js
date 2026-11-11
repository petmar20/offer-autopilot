const api = window.autopilot;

let currentState = null;
const expandedOffers = new Set();
const expandedRuns = new Set();
let settingsFormDirty = false;

// ---------- helpers ----------

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function formatDateTime(iso) {
  if (!iso) {
    return '';
  }
  return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

function isExpired(offer) {
  if (!offer.endDate) {
    return false;
  }
  const end = new Date(offer.endDate);
  end.setHours(23, 59, 59, 999);
  return end < new Date();
}

function hourLabel(hour) {
  const h = hour % 24;
  const suffix = h < 12 ? 'AM' : 'PM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return hour === 24 ? 'midnight' : `${twelve} ${suffix}`;
}

// ---------- header ----------

function renderHeader(state) {
  const statusLine = document.getElementById('status-line');
  const runButton = document.getElementById('run-button');
  const settings = state.settings;

  if (state.running) {
    statusLine.textContent = 'Running now';
    runButton.textContent = 'Stop';
  } else {
    runButton.textContent = 'Run now';
    if (!settings.username || !settings.hasPassword) {
      statusLine.textContent = 'Add your Citi sign-in in Settings to start.';
    } else {
      const lastRun = state.runs.find((r) => r.status !== 'running');
      const last = lastRun ? `Last run ${formatDateTime(lastRun.finishedAt || lastRun.startedAt)}. ` : '';
      statusLine.textContent = `${last}Next run ${formatDateTime(settings.nextRunAt)}.`;
    }
  }

  const updateButton = document.getElementById('update-button');
  if (state.update?.ready) {
    updateButton.textContent = `Restart to update to ${state.update.version}`;
    updateButton.classList.remove('hidden');
  } else {
    updateButton.classList.add('hidden');
  }
  document.title = `Offer Autopilot ${state.version}`;
}

// ---------- offers ----------

function renderStats(offers) {
  const current = offers.filter((o) => !isExpired(o));
  const enrolled = current.filter((o) => o.status === 'ENROLLED');
  const priorityEnrolled = enrolled.filter((o) => o.isPriority);
  const stats = [
    [enrolled.length, 'Enrolled now'],
    [priorityEnrolled.length, 'Priority stores enrolled'],
    [current.filter((o) => o.status === 'AVAILABLE').length, 'Not enrolled yet'],
  ];
  const container = document.getElementById('stats');
  container.replaceChildren(...stats.map(([value, label]) => {
    const box = element('div', 'stat');
    box.append(element('div', 'stat-value', String(value)), element('div', 'stat-label', label));
    return box;
  }));
}

function renderCardFilter(offers) {
  const select = document.getElementById('card-filter');
  const selected = select.value;
  const labels = [...new Set(offers.map((o) => o.cardLabel).filter(Boolean))].sort();
  const options = [new Option('All cards', '')].concat(labels.map((label) => new Option(label, label)));
  select.replaceChildren(...options);
  select.value = labels.includes(selected) ? selected : '';
}

function filteredOffers(offers) {
  const search = document.getElementById('offer-search').value.trim().toLowerCase();
  const filter = document.getElementById('offer-filter').value;
  const card = document.getElementById('card-filter').value;

  return offers.filter((offer) => {
    if (card && offer.cardLabel !== card) {
      return false;
    }
    if (search && !String(offer.merchantName).toLowerCase().includes(search)) {
      return false;
    }
    const expired = isExpired(offer);
    switch (filter) {
      case 'active': return !expired;
      case 'priority': return !expired && offer.isPriority;
      case 'enrolled': return !expired && offer.status === 'ENROLLED';
      case 'available': return !expired && offer.status === 'AVAILABLE';
      case 'expired': return expired;
      default: return true;
    }
  });
}

function offerRow(offer) {
  const key = `${offer.accountId}:${offer.offerId}`;
  const row = element('div', 'offer');
  const summary = element('div', 'offer-summary');

  const logo = element('img', 'offer-logo');
  logo.alt = '';
  if (offer.imageUrl) {
    logo.src = offer.imageUrl;
  }

  const nameBlock = element('div');
  const name = element('div', 'offer-name');
  if (offer.isPriority) {
    name.append(element('span', 'star', '★'));
  }
  name.append(document.createTextNode(offer.merchantName));
  const metaParts = [offer.cardLabel, offer.endDate ? `Ends ${offer.endDate}` : ''];
  if (offer.enrolledAt) {
    metaParts.push(`Enrolled ${formatDate(offer.enrolledAt)}`);
  }
  nameBlock.append(name, element('div', 'offer-meta', metaParts.filter(Boolean).join('  ·  ')));

  const value = element('div', 'offer-value', offer.title || '');

  let badgeText = 'Not enrolled';
  let badgeClass = 'available';
  if (isExpired(offer)) {
    badgeText = 'Expired';
    badgeClass = 'expired';
  } else if (offer.status === 'ENROLLED') {
    badgeText = 'Enrolled';
    badgeClass = 'enrolled';
  } else if (offer.status && offer.status !== 'AVAILABLE') {
    badgeText = offer.status.charAt(0) + offer.status.slice(1).toLowerCase();
    badgeClass = 'enrolled';
  }
  const badge = element('span', `badge ${badgeClass}`, badgeText);

  summary.append(logo, nameBlock, value, badge);
  summary.addEventListener('click', () => {
    if (expandedOffers.has(key)) {
      expandedOffers.delete(key);
    } else {
      expandedOffers.add(key);
    }
    renderOffers(currentState);
  });
  row.append(summary);

  if (expandedOffers.has(key)) {
    const details = element('div', 'offer-details');
    if (offer.description) {
      details.append(element('p', '', offer.description));
    }
    if (offer.longDescription) {
      details.append(element('p', '', offer.longDescription));
    }
    if (offer.redemptionType) {
      details.append(element('p', 'offer-meta', `Use it: ${offer.redemptionType.replace('_', ' and ').toLowerCase()}`));
    }
    if (offer.websiteUrl) {
      const link = element('a', '', offer.websiteUrl);
      link.href = offer.websiteUrl;
      link.target = '_blank';
      const p = element('p');
      p.append(link);
      details.append(p);
    }
    if (offer.terms) {
      details.append(element('p', 'terms', offer.terms));
    }
    if (!offer.description && !offer.terms) {
      details.append(element('p', 'offer-meta', 'Details are saved when the app enrolls an offer.'));
    }
    row.append(details);
  }
  return row;
}

function renderOffers(state) {
  const offers = state.offers;
  renderStats(offers);
  renderCardFilter(offers);

  const visible = filteredOffers(offers).sort((a, b) =>
    String(a.merchantName).localeCompare(String(b.merchantName)) || String(a.cardLabel).localeCompare(String(b.cardLabel)));
  const priority = visible.filter((o) => o.isPriority);
  const others = visible.filter((o) => !o.isPriority);

  const list = document.getElementById('offer-list');
  const children = [];
  if (visible.length === 0) {
    children.push(element('div', 'empty', offers.length ? 'No offers match.' : 'No offers yet. They show up after the first run.'));
  }
  if (priority.length) {
    children.push(element('div', 'section-heading', `Priority stores (${priority.length})`));
    children.push(...priority.map(offerRow));
  }
  if (others.length) {
    children.push(element('div', 'section-heading', `Everything else (${others.length})`));
    children.push(...others.map(offerRow));
  }
  list.replaceChildren(...children);
}

// ---------- activity ----------

function renderActivity(state) {
  const livePanel = document.getElementById('live-panel');
  const liveLog = document.getElementById('live-log');
  livePanel.classList.toggle('hidden', !state.running);
  if (state.running) {
    const atBottom = liveLog.scrollTop + liveLog.clientHeight >= liveLog.scrollHeight - 20;
    liveLog.textContent = state.liveLog.join('\n');
    if (atBottom) {
      liveLog.scrollTop = liveLog.scrollHeight;
    }
  }

  const runList = document.getElementById('run-list');
  const finishedRuns = state.runs.filter((r) => r.status !== 'running' || state.running);
  if (finishedRuns.length === 0) {
    runList.replaceChildren(element('div', 'empty', 'No runs yet.'));
    return;
  }
  runList.replaceChildren(...finishedRuns.map(runRow));
}

const RUN_STATUS_TEXT = { done: 'Finished', failed: 'Failed', stopped: 'Stopped', running: 'Running' };

function runRow(run) {
  const row = element('div', 'run');
  const head = element('div', 'run-head');
  const enrolled = (run.enrolled || []).length;
  const left = element('div', '', `${formatDateTime(run.startedAt)}  ·  ${run.trigger === 'scheduled' ? 'Scheduled' : 'Manual'}`);
  const right = element('div', `run-status ${run.status}`,
    `${RUN_STATUS_TEXT[run.status] || run.status}  ·  ${enrolled} enrolled`);
  head.append(left, right);
  row.append(head);

  head.addEventListener('click', async () => {
    if (expandedRuns.has(run.id)) {
      expandedRuns.delete(run.id);
      renderActivity(currentState);
      return;
    }
    expandedRuns.add(run.id);
    renderActivity(currentState);
  });

  if (expandedRuns.has(run.id)) {
    const body = element('div', 'run-body');
    if (run.error) {
      body.append(element('p', 'run-status failed', run.error));
    }
    const names = (run.enrolled || []).map((e) => `${e.merchant} (${e.title}) on ${e.card}`);
    if (names.length) {
      body.append(element('pre', 'log', names.join('\n')));
    }
    const failures = [...(run.failed || []), ...(run.skipped || [])];
    if (failures.length) {
      body.append(element('div', 'offer-meta', 'Not enrolled:'));
      body.append(element('pre', 'log', failures.map((f) => `${f.merchant} on ${f.card}: ${f.reason}`).join('\n')));
    }
    const logBlock = element('pre', 'log');
    body.append(logBlock);
    api.getRunLog(run.id).then((lines) => {
      logBlock.textContent = lines.join('\n');
    });
    row.append(body);
  }
  return row;
}

// ---------- settings ----------

function fillHourSelect(select, from, to) {
  select.replaceChildren(...Array.from({ length: to - from + 1 }, (_, i) => new Option(hourLabel(from + i), String(from + i))));
}

function renderSettings(state) {
  if (settingsFormDirty) {
    return;
  }
  const settings = state.settings;
  document.getElementById('username').value = settings.username || '';
  document.getElementById('password').value = '';
  document.getElementById('password').placeholder = settings.hasPassword ? 'Saved' : '';
  document.getElementById('password-hint').textContent = settings.hasPassword
    ? 'Leave blank to keep the saved password.'
    : 'Stored encrypted for your Windows account.';
  document.getElementById('interval-days').value = String(settings.intervalDays);
  document.getElementById('window-start').value = String(settings.windowStartHour);
  document.getElementById('window-end').value = String(settings.windowEndHour);
  document.getElementById('open-at-login').checked = Boolean(settings.openAtLogin);
  document.getElementById('priority-keywords').value = settings.priorityKeywords.join('\n');
}

async function saveSettingsForm(event) {
  event.preventDefault();
  const start = Number(document.getElementById('window-start').value);
  const end = Number(document.getElementById('window-end').value);
  const message = document.getElementById('save-message');
  if (end <= start) {
    message.textContent = 'The end time has to be after the start time.';
    return;
  }
  const changes = {
    username: document.getElementById('username').value.trim(),
    intervalDays: Number(document.getElementById('interval-days').value),
    windowStartHour: start,
    windowEndHour: end,
    openAtLogin: document.getElementById('open-at-login').checked,
    priorityKeywords: document.getElementById('priority-keywords').value
      .split('\n').map((k) => k.trim()).filter(Boolean),
  };
  const password = document.getElementById('password').value;
  if (password) {
    changes.password = password;
  }
  settingsFormDirty = false;
  render(await api.saveSettings(changes));
  message.textContent = 'Saved.';
  setTimeout(() => { message.textContent = ''; }, 2500);
}

// ---------- wiring ----------

function render(state) {
  currentState = state;
  renderHeader(state);
  renderOffers(state);
  renderActivity(state);
  renderSettings(state);
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('hidden', panel.id !== `tab-${name}`));
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => showTab(tab.dataset.tab)));

document.getElementById('run-button').addEventListener('click', () => {
  if (currentState?.running) {
    api.stopRun();
  } else {
    api.runNow();
    showTab('activity');
  }
});

document.getElementById('update-button').addEventListener('click', () => api.installUpdate());

for (const id of ['offer-search', 'offer-filter', 'card-filter']) {
  document.getElementById(id).addEventListener('input', () => renderOffers(currentState));
}

fillHourSelect(document.getElementById('window-start'), 0, 23);
fillHourSelect(document.getElementById('window-end'), 1, 24);

const settingsForm = document.getElementById('settings-form');
settingsForm.addEventListener('input', () => { settingsFormDirty = true; });
settingsForm.addEventListener('submit', saveSettingsForm);
document.getElementById('reset-keywords').addEventListener('click', async () => {
  settingsFormDirty = false;
  render(await api.resetPriorityKeywords());
});

api.onStateChanged(render);
api.getState().then(render);
