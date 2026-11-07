/* main.js: прогресс с МБ/скоростью, фикс «уже запущено», «обновлений нет» */
'use strict';
const fs = require('fs');
const FILE = 'C:/Users/User/OneDrive/Desktop/ArbMusic/electron/main.js';
let m = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

// 1. полный прогресс
const prRe = /  autoUpdater\.on\('download-progress', \(p\) => \{\n    send\('updater', \{ event: 'download-progress', percent: Math\.round\(p\.percent\) \}\);\n  \}\);/;
if (!prRe.test(m)) throw new Error('progress handler not found');
m = m.replace(prRe, `  autoUpdater.on('download-progress', (p) => {
    send('updater', {
      event: 'download-progress',
      percent: Math.round(p.percent),
      transferredMB: p.transferred / 1048576,
      totalMB: p.total / 1048576,
      speedMBps: p.bytesPerSecond / 1048576,
    });
  });`);

// 2. установка: отпускаем лок второго запуска, иначе установщик пишет «уже запущено»
const instOld = `ipcMain.on('updater-install', () => {
  autoUpdater.quitAndInstall(false, true);
});`;
if (!m.includes(instOld)) throw new Error('install handler not found');
m = m.replace(instOld, `ipcMain.on('updater-install', () => {
  try { app.releaseSingleInstanceLock(); } catch (_) {}
  autoUpdater.quitAndInstall(false, true);
});`);

// 3. событие «обновлений нет»
const errAnchor = `  autoUpdater.on('error', (e) => {`;
if (!m.includes(errAnchor)) throw new Error('error anchor not found');
m = m.replace(errAnchor, `  autoUpdater.on('update-not-available', (info) => {
    send('updater', { event: 'update-not-available', version: info.version });
  });
` + errAnchor);

fs.writeFileSync(FILE, m);
new Function(m);
console.log('main.js OK');
