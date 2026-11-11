const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('autopilot', {
  getState: () => ipcRenderer.invoke('get-state'),
  saveSettings: (changes) => ipcRenderer.invoke('save-settings', changes),
  resetPriorityKeywords: () => ipcRenderer.invoke('reset-priority-keywords'),
  runNow: () => ipcRenderer.invoke('run-now'),
  stopRun: () => ipcRenderer.invoke('stop-run'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getRunLog: (runId) => ipcRenderer.invoke('get-run-log', runId),
  onStateChanged: (callback) => ipcRenderer.on('state-changed', (_event, state) => callback(state)),
});
