/* Добавляет систему версий и обновлений в www/js/app.js */
'use strict';
const fs = require('fs');
const FILE = 'C:/Users/User/OneDrive/Desktop/ArbMusic/www/js/app.js';
let s = fs.readFileSync(FILE, 'utf8');

// 1) версия UI + определение оболочки
s = s.replace(
  'const APP_VER = 10;',
  `const APP_VER = 11;
/* номер оболочки (нативного приложения): ?shell=N в адресе, 0 — чистый веб */
const SHELL_VER = parseInt(new URLSearchParams(location.search).get('shell')) || 0;
function platformType() {
  if (window.Capacitor && window.Capacitor.getPlatform) {
    const p = window.Capacitor.getPlatform();
    if (p === 'android') return 'apk';
  }
  if (navigator.userAgent.includes('Electron')) return 'exe';
  return 'web';
}`
);

// 2) wiring
const wireAnchor = '  wireAuth();\n  wireUpload();\n  wireAdmin();';
if (!s.includes(wireAnchor)) throw new Error('wire anchor not found');
s = s.replace(wireAnchor, wireAnchor + '\n  wireVersion();');

// 3) wireVersion + fetchBuild + renderVersionInfo
const anchor2 = 'function wireAdmin() {';
if (!s.includes(anchor2)) throw new Error('wireAdmin anchor not found');
const verFn = `/* ---------- версия и обновления ---------- */
function wireVersion() {
  $('#btn-version').addEventListener('click', async () => {
    openModal('modal-version');
    renderVersionInfo(null);
    const b = await fetchBuild(true);
    renderVersionInfo(b);
    const res = $('#ver-result');
    res.classList.remove('hidden');
    res.style.color = '';
    const msg = [];
    if (b.ui > APP_VER) msg.push('Доступно обновление интерфейса (v' + b.ui + ') — жми «Обновить интерфейс»');
    if (b.shell > SHELL_VER) msg.push('Доступна новая версия приложения (' + b.versionName + ') — скачай и установи');
    res.textContent = msg.length ? msg.join('. ') : 'У тебя последняя версия ✓';
    res.style.color = '#6ee7b7';
    if (b.shell > SHELL_VER) showDownload(b);
  });
  $('#ver-download').addEventListener('click', () => {
    const b = window.__latestBuild;
    if (!b) return;
    const p = platformType();
    if (p === 'web') { toast('Скачай под свою систему: APK — ' + b.apkUrl + ' | EXE — ' + b.exeUrl); return; }
    window.open(p === 'apk' ? b.apkUrl : b.exeUrl, '_blank');
  });
  $('#ver-refresh').addEventListener('click', async () => {
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
    location.reload();
  });
}
async function fetchBuild(bust) {
  const r = await fetch('./version.json' + (bust ? '?cb=' + Date.now() : ''), { cache: 'no-cache' });
  const b = await r.json();
  window.__latestBuild = b;
  return b;
}
function renderVersionInfo(b) {
  const el = $('#ver-info');
  if (!el) return;
  const p = platformType();
  const platName = { apk: 'Android (APK)', exe: 'Windows (EXE)', web: 'Веб-версия' }[p];
  el.innerHTML =
    '<div class="ver-row">Интерфейс: <b>v' + APP_VER + '</b></div>' +
    '<div class="ver-row">Приложение: <b>' + (SHELL_VER ? 'v' + SHELL_VER : '—') + '</b> · ' + platName + '</div>' +
    (b ? '<div class="ver-row">На сервере: <b>интерфейс v' + b.ui + ' · оболочка v' + b.shell + '</b></div>' +
         '<div class="ver-row">' + esc(b.versionName) + '</div>' : '');
  const dl = $('#ver-download');
  if (b && b.shell > SHELL_VER && p !== 'web') dl.classList.remove('hidden');
  else dl.classList.add('hidden');
}
function showDownload(b) {
  const dl = $('#ver-download');
  if (dl) dl.classList.remove('hidden');
}

` + anchor2;
s = s.replace(anchor2, verFn);

fs.writeFileSync(FILE, s);
new Function(s);
console.log('version system OK, APP_VER=11, SHELL_VER detect');
