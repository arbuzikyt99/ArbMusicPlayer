/* Переписывает систему версий в app.js:
   - EXE: настоящее обновление через electron-updater (скачать → перезапустить)
   - APK: версия из устройства + подсказка RuStore
   - Веб: номер версии + ссылка на установщик для ПК */
'use strict';
const fs = require('fs');
const FILE = 'C:/Users/User/OneDrive/Desktop/ArbMusic/www/js/app.js';
let s = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

// 1) версия UI + оболочки
s = s.replace(/const APP_VER = \d+;/, `const APP_VER = 14;
/* версия оболочки: EXE сообщает свою, APK возьмёт из устройства, веб — 0 */
let SHELL_VERSION_NAME = '0';`);

// 2) убрать старый блок версии целиком (wireVersion..showDownload)
const startRe = /\/\* ---------- версия и обновления ---------- \*\/\nfunction wireVersion\(\) \{[\s\S]*?^function showDownload\(b\) \{\n  const dl = \$\('#ver-download'\);\n  if \(dl\) dl\.classList\.remove\('hidden'\);\n\}\n/m;
if (!startRe.test(s)) throw new Error('old version block not found');
const newBlock = `/* ---------- версия и обновления ---------- */
function wireVersion() {
  $('#btn-version').addEventListener('click', async () => {
    openModal('modal-version');
    renderVersionInfo(null);
    const res = $('#ver-result');
    res.classList.remove('hidden');
    res.style.color = '';
    $('#ver-install').classList.add('hidden');
    $('#ver-download').classList.add('hidden');
    $('#ver-download').textContent = 'Скачать обновление';
    if (window.arbShell) {
      // оболочка EXE: проверка и установка через встроенный апдейтер
      res.textContent = 'Проверяю…';
      arbShell.checkForUpdates();
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
    }
  });
  $('#ver-download').addEventListener('click', () => {
    if (window.arbShell) { arbShell.downloadUpdate(); return; }
    const b = window.__latestBuild;
    if (b && b.exeUrl) window.open(b.exeUrl, '_blank');
  });
  $('#ver-install').addEventListener('click', () => {
    if (window.arbShell) arbShell.installUpdate();
  });
  if (window.arbShell) {
    arbShell.onUpdaterEvent(d => {
      const res = $('#ver-result');
      if (!res) return;
      res.classList.remove('hidden');
      if (d.event === 'update-available') {
        res.style.color = '#fde68a';
        res.textContent = 'Доступна версия оболочки ' + d.version + ' — скачиваю…';
        arbShell.downloadUpdate();
      } else if (d.event === 'download-progress') {
        res.style.color = '#fde68a';
        res.textContent = 'Скачиваю обновление: ' + d.percent + '%';
      } else if (d.event === 'update-downloaded') {
        res.style.color = '#6ee7b7';
        res.textContent = 'Обновление ' + d.version + ' скачано — жми «Перезапустить и установить»';
        $('#ver-install').classList.remove('hidden');
        $('#ver-download').classList.add('hidden');
      } else if (d.event === 'error') {
        res.style.color = '#fca5a5';
        res.textContent = 'Обновление: ' + d.message;
      }
    });
  }
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
  const shellName = window.arbShell ? ('v' + SHELL_VERSION_NAME) : '—';
  el.innerHTML =
    '<div class="ver-row">Интерфейс: <b>v' + APP_VER + '</b></div>' +
    '<div class="ver-row">Приложение: <b>' + shellName + '</b> · ' + platName + '</div>' +
    (b ? '<div class="ver-row">На сервере: <b>интерфейс v' + b.ui + ' · оболочка ' + b.shellVersionName + '</b></div>' +
         '<div class="ver-row">' + esc(b.versionName) + '</div>' : '');
  const dl = $('#ver-download');
  if (!window.arbShell && p === 'web' && b && b.exeUrl) dl.classList.remove('hidden');
  else dl.classList.add('hidden');
}
function showDownload(b) {
  const dl = $('#ver-download');
  if (dl) dl.classList.remove('hidden');
}
`;
s = s.replace(startRe, newBlock);

// 3) APK: версия из устройства
const initAnchor = "  // фоновое прослушивание — только с премиумом";
if (!s.includes(initAnchor)) throw new Error('init anchor not found');
s = s.replace(initAnchor, `  // версия APK из устройства (для раздела «Версия»)
  if (isNative && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Device) {
    window.Capacitor.Plugins.Device.getInfo().then(i => {
      if (i.appVersion) { SHELL_VERSION_NAME = i.appVersion; }
    }).catch(() => {});
  }
` + initAnchor);

fs.writeFileSync(FILE, s);
new Function(s);
console.log('updater UI OK');
