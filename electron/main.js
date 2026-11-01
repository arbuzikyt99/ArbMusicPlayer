/* ArbMusic — Electron main process (Windows build).
   Интерфейс всегда свежий: грузим с сервера, при отсутствии сети — встроенная копия. */
'use strict';
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const REMOTE_URL = 'https://arbuzikyt99.github.io/ArbMusicPlayer/';
const LOCAL_FILE = path.join(__dirname, '..', 'www', 'index.html');

let win = null;
let fellBackToLocal = false;

function createWindow() {
  win = new BrowserWindow({
    width: 430,
    height: 900,
    minWidth: 360,
    minHeight: 640,
    title: 'ArbMusic',
    backgroundColor: '#07070c',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  loadRemote();
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function loadRemote() {
  // Service worker сайта сам отдаёт кэш, когда нет сети
  win.webContents.once('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && !fellBackToLocal) {
      fellBackToLocal = true;
      win.loadFile(LOCAL_FILE).catch(() => {});
    }
  });
  win.loadURL(REMOTE_URL).catch(() => {
    if (!fellBackToLocal) {
      fellBackToLocal = true;
      win.loadFile(LOCAL_FILE).catch(() => {});
    }
  });
}

app.setAppUserModelId('com.arbuzik.arbmusic');

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
