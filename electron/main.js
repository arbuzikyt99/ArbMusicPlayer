/* ArbMusic — Electron main process (Windows build).
   Запуск мгновенный: сразу открываем встроенную версию,
   затем, если сервер доступен, переключаемся на неё —
   так интерфейс всегда свежий без переустановок.

   Обновления оболочки: electron-updater + GitHub Releases.
   Качается только изменённое (дельта по blockmap), ставится без переустановки. */
'use strict';
const { app, BrowserWindow, shell, net, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const REMOTE_URL = 'https://arbmusic-7371.zai-ai.site/app/?shell=4';
const FALLBACK_URL = 'https://arbuzikyt99.github.io/';
const LOCAL_FILE = path.join(__dirname, '..', 'www', 'index.html');

let win = null;
let usingRemote = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // уже запущено — показываем существующее окно
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.setAppUserModelId('com.arbuzik.arbmusic');

  app.whenReady().then(async () => {
    // каждый запуск — со свежим интерфейсом: чистим HTTP-кэш и service worker'ы
    try {
      const { session } = require('electron');
      await session.defaultSession.clearCache();
      await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
    } catch (_) { /* не критично */ }
    createWindow();
    setupUpdater();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

/* ---------- автообновление оболочки ---------- */
function setupUpdater() {
  autoUpdater.autoDownload = false; // скачиваем только по кнопке пользователя
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    send('updater', { event: 'update-available', version: info.version });
  });
  autoUpdater.on('download-progress', (p) => {
    send('updater', { event: 'download-progress', percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    send('updater', { event: 'update-downloaded', version: info.version });
  });
  autoUpdater.on('error', (e) => {
    send('updater', { event: 'error', message: String(e && e.message || e).slice(0, 140) });
  });
  // тихая проверка при старте
  autoUpdater.checkForUpdates().catch(() => {});
}

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

ipcMain.on('updater-check', () => {
  autoUpdater.checkForUpdates().catch(() => {});
});
ipcMain.on('updater-download', () => {
  autoUpdater.downloadUpdate().catch(() => {});
});
ipcMain.on('updater-install', () => {
  autoUpdater.quitAndInstall(false, true);
});
ipcMain.on('app-version', (e) => {
  e.returnValue = app.getVersion();
});

function createWindow() {
  win = new BrowserWindow({
    width: 430,
    height: 900,
    minWidth: 360,
    minHeight: 640,
    title: 'ArbMusic',
    backgroundColor: '#07070c',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.setMenuBarVisibility(false);
  // фоновое воспроизведение — только с премиумом: при сворачивании плеер проверяет права
  win.on('minimize', () => {
    win.webContents.executeJavaScript('window.__onBackground && window.__onBackground()').catch(() => {});
  });
  // мгновенный старт на встроенной версии
  win.loadFile(LOCAL_FILE).catch(() => {});
  win.once('ready-to-show', () => {
    win.show();
    probeRemote();
  });
  win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && usingRemote) backToLocal();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function probeRemote() {
  try {
    const req = net.request(REMOTE_URL);
    let settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      if (ok && win && !win.isDestroyed()) {
        usingRemote = true;
        win.loadURL(REMOTE_URL).catch(() => {
          // запасной вариант — github.io, потом локальная копия
          win.loadURL(FALLBACK_URL).catch(() => backToLocal());
        });
      }
    };
    req.setTimeout(5000, () => { req.abort(); finish(false); });
    req.on('response', res => finish(res.statusCode >= 200 && res.statusCode < 400));
    req.on('error', () => finish(false));
    req.end();
  } catch (_) { /* остаёмся на локальной */ }
}

function backToLocal() {
  usingRemote = false;
  if (win && !win.isDestroyed()) win.loadFile(LOCAL_FILE).catch(() => {});
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
