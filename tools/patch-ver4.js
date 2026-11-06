/* 1) кнопка Проверить: try/catch + shell-сравнение  2) checkVersion надёжный */
'use strict';
const fs = require('fs');
const FILE = 'C:/Users/User/OneDrive/Desktop/ArbMusic/www/js/app.js';
let s = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

// 1. shell-ветка кнопки Проверить: try/catch + сравнение версий оболочки
const shellOld = `    if (window.arbShell) {
      // оболочка EXE: проверка и установка через встроенный апдейтер
      res.textContent = 'Проверяю…';
      arbShell.checkForUpdates();
      clearTimeout(window.__verT);
      window.__verT = setTimeout(() => {
        const res = $('#ver-result');
        if (res && res.textContent === 'Проверяю…') {
          res.style.color = '#6ee7b7';
          res.textContent = 'У тебя последняя версия ✓';
        }
      }, 15000);
    } else if (platformType() === 'apk') {
      await fetchBuild(true);
      renderVersionInfo(await fetchBuild(true));
      res.textContent = 'Обновления приложения — через RuStore';
      res.style.color = '#6ee7b7';
    } else {
      const b = await fetchBuild(true);
      renderVersionInfo(b);
      const msg = [];
      if (b.ui > APP_VER) msg.push('Доступно обновление интерфейса (v' + b.ui + ') — жми «Обновить интерфейс»');
      res.textContent = msg.length ? msg.join('. ') : 'У тебя последняя версия ✓';
      res.style.color = '#6ee7b7';
      if (b.exeUrl) showDownload(b);
    }`;
if (!s.includes(shellOld)) throw new Error('shell block not found');
const shellNew = `    try {
      if (window.arbShell) {
        // оболочка EXE: проверка через встроенный апдейтер
        res.textContent = 'Проверяю…';
        arbShell.checkForUpdates();
      } else if (platformType() === 'apk') {
        const b = await fetchBuild(true);
        renderVersionInfo(b);
        res.textContent = 'Обновления приложения — через RuStore';
        res.style.color = '#6ee7b7';
      } else {
        const b = await fetchBuild(true);
        renderVersionInfo(b);
        const msg = [];
        if (b.ui > APP_VER) msg.push('Доступно обновление интерфейса (v' + b.ui + ') — жми «Обновить интерфейс»');
        if (compareVersions(b.shellVersionName, SHELL_VERSION_NAME) > 0 && b.exeUrl) {
          msg.push('Доступна новая версия приложения (' + b.versionName + ') — скачай и установи');
          showDownload(b);
        }
        res.textContent = msg.length ? msg.join('. ') : 'У тебя последняя версия ✓';
        res.style.color = '#6ee7b7';
      }
    } catch (e) {
      res.style.color = '#fca5a5';
      res.textContent = 'Не удалось проверить: ' + e.message;
    }`;
s = s.replace(shellOld, shellNew);

// 2. compareVersions, если нет
if (!s.includes('function compareVersions')) {
  const fv = 'async function fetchBuild(bust) {';
  if (!s.includes(fv)) throw new Error('fetchBuild not found');
  s = s.replace(fv, `function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
async function fetchBuild(bust) {`);
}

// 3. checkVersion: надёжный авто-апдейт интерфейса
const cvMatch = s.match(/async function checkVersion\(\) \{[\s\S]*?\n\}/);
if (!cvMatch) throw new Error('checkVersion not found');
const cvNew = `async function checkVersion() {
  if (isNative || !/^https?:$/.test(location.protocol)) return;
  try {
    const r = await fetch('./version.json?cb=' + Date.now(), { cache: 'no-cache' });
    if (!r.ok) return;
    const j = await r.json();
    if (typeof j.ui !== 'number') return;
    if (j.ui !== APP_VER && sessionStorage.getItem('arbmv') !== String(j.ui)) {
      sessionStorage.setItem('arbmv', String(j.ui));
      for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
      for (const k of await caches.keys()) await caches.delete(k);
      location.reload();
    }
  } catch (_) { /* ignore */ }
}`;
s = s.replace(cvMatch[0], cvNew);

fs.writeFileSync(FILE, s);
new Function(s);
console.log('version modal + checkVersion fixed');
