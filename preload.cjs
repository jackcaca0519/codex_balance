const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexBalance', {
  getState: () => ipcRenderer.invoke('get-state'),
  refreshNow: () => ipcRenderer.invoke('refresh-now'),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),
  openUsageUrl: () => ipcRenderer.invoke('open-usage-url'),
  onRefreshStarted: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('refresh-started', handler);
    return () => ipcRenderer.removeListener('refresh-started', handler);
  },
  onStateUpdate: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('state-update', handler);
    return () => ipcRenderer.removeListener('state-update', handler);
  },
});
