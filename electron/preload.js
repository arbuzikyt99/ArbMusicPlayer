/* ArbMusic preload: безопасный мост для автообновления оболочки */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('arbShell', {
  isShell: true,
  getAppVersion: () => ipcRenderer.sendSync('app-version'),
  checkForUpdates: () => ipcRenderer.send('updater-check'),
  downloadUpdate: () => ipcRenderer.send('updater-download'),
  installUpdate: () => ipcRenderer.send('updater-install'),
  onUpdaterEvent: (cb) => {
    ipcRenderer.on('updater', (_e, data) => cb(data));
  },
});
