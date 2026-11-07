/* v2.0.0: версии, обработка «обновлений нет», бейдж обновления в профиле */
'use strict';
const fs = require('fs');
const ROOT = 'C:/Users/User/OneDrive/Desktop/ArbMusic/';

/* version.json */
fs.writeFileSync(ROOT + 'www/version.json', JSON.stringify({
  ui: 20, shell: 5, shellVersionName: '2.0.0',
  versionName: 'ArbMusic 2.0.0',
  exeUrl: 'https://github.com/arbuzikyt99/ArbMusicPlayer/releases/latest/download/ArbMusic-Setup.exe',
  apkUrl: 'https://github.com/arbuzikyt99/ArbMusicPlayer/releases/latest/download/ArbMusic.apk',
  whatsNew: 'Обновления из приложения (только изменённое), ArbStudio, премиум через ЮKassa'
}, null, 2) + '\n');

/* package.json 2.0.0 */
let p = JSON.parse(fs.readFileSync(ROOT + 'package.json', 'utf8'));
p.version = '2.0.0';
fs.writeFileSync(ROOT + 'package.json', JSON.stringify(p, null, 2) + '\n');

/* app.js: APP_VER 20 + update-not-available + бейдж в профиле */
let s = fs.readFileSync(ROOT + 'www/js/app.js', 'utf8').replace(/\r\n/g, '\n');
s = s.replace(/const APP_VER = \d+;/, 'const APP_VER = 20;');

const evAnchor = `      } else if (d.event === 'error') {
        res.style.color = '#fca5a5';
        res.textContent = 'Обновление: ' + d.message;
      }`;
if (!s.includes(evAnchor)) throw new Error('updater event anchor not found');
s = s.replace(evAnchor, `      } else if (d.event === 'update-not-available') {
        res.style.color = '#6ee7b7';
        res.textContent = 'У тебя последняя версия ✓';
      } else if (d.event === 'error') {
        res.style.color = '#fca5a5';
        res.textContent = 'Обновление: ' + d.message;
      }`);

/* бейдж на кнопке «Версия» в профиле, когда обновление скачано */
const badgeCss = `\n/* бейдж доступного обновления на кнопке Версия */
.btn-version .upd-dot {
  position: absolute; top: 10px; right: 14px; width: 10px; height: 10px;
  border-radius: 50%; background: #4ade80; box-shadow: 0 0 8px rgba(74, 222, 128, .8);
}
.profile-action { position: relative; }
`;
if (!s.includes('.upd-dot')) {
  let c = fs.readFileSync(ROOT + 'www/css/style.css', 'utf8').replace(/\r\n/g, '\n');
  c += badgeCss;
  fs.writeFileSync(ROOT + 'www/css/style.css', c);
}
const btnAnchor = `    // версия: веб — просто номер, apk/exe — кнопка обновлений
    const p = platformType();`;
if (!s.includes(btnAnchor)) throw new Error('version btn anchor not found');
s = s.replace(btnAnchor, `    // зелёная точка, если обновление скачано и ждёт установки
    const vb = $('#btn-version');
    if (vb && !vb.querySelector('.upd-dot')) {
      const dot = document.createElement('i');
      dot.className = 'upd-dot';
      vb.appendChild(dot);
      vb.classList.add('upd-ready');
      dot.style.display = window.__updateReady ? 'block' : 'none';
    }
` + btnAnchor);

/* событие скачанного обновления → точка + тост */
const dlAnchor = `      } else if (d.event === 'update-downloaded') {
        res.style.color = '#6ee7b7';
        res.textContent = 'Обновление ' + d.version + ' скачано — жми «Перезапустить и установить»';
        $('#ver-install').classList.remove('hidden');
        $('#ver-download').classList.add('hidden');
      }`;
if (!s.includes(dlAnchor)) throw new Error('downloaded anchor not found');
s = s.replace(dlAnchor, dlAnchor + `
        window.__updateReady = true;
        const vb = $('#btn-version .upd-dot');
        if (vb) vb.style.display = 'block';`);

fs.writeFileSync(ROOT + 'www/js/app.js', s);
new Function(s);

/* android 2.0.0 */
let g = fs.readFileSync(ROOT + 'android/app/build.gradle', 'utf8').replace(/\r\n/g, '\n');
g = g.replace(/versionCode \d+/, 'versionCode 6').replace(/versionName "[^"]*"/, 'versionName "2.0.0"');
fs.writeFileSync(ROOT + 'android/app/build.gradle', g);

console.log('v2.0.0 versions OK');
