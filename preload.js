import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('codexBalance', {
  getState: () => ipcRenderer.invoke('get-state'),
  refreshNow: () => ipcRenderer.invoke('refresh-now'),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),
  openUsageUrl: () => ipcRenderer.invoke('open-usage-url'),
  onStateUpdate: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('state-update', handler);
    return () => ipcRenderer.removeListener('state-update', handler);
  },
});
