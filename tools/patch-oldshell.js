/* Старые оболочки: проверка версии приложения + кнопка скачивания */
'use strict';
const fs = require('fs');
const FILE = 'C:/Users/User/OneDrive/Desktop/ArbMusic/www/js/app.js';
let s = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

const oldElse = `      } else {
        const b = await fetchBuild(true);
        renderVersionInfo(b);
        const msg = [];
        if (b.ui > APP_VER) msg.push('Доступно обновление интерфейса (v' + b.ui + ') — жми «Обновить интерфейс»');
        res.textContent = msg.length ? msg.join('. ') : 'У тебя последняя версия ✓';
        res.style.color = '#6ee7b7';
        if (b.exeUrl) showDownload(b);
      }`;
if (!s.includes(oldElse)) throw new Error('else block not found');
const newElse = `      } else {
        const b = await fetchBuild(true);
        renderVersionInfo(b);
        const msg = [];
        if (b.ui > APP_VER) msg.push('Доступно обновление интерфейса (v' + b.ui + ') — жми «Обновить интерфейс»');
        // старая оболочка EXE: предлагаем обновление приложения
        if (platformType() === 'exe' && compareVersions(b.shellVersionName, SHELL_VERSION_NAME) > 0 && b.exeUrl) {
          msg.push('Доступна новая версия приложения (' + b.versionName + ') — скачай и установи');
          showDownload(b);
        }
        res.textContent = msg.length ? msg.join('. ') : 'У тебя последняя версия ✓';
        res.style.color = '#6ee7b7';
      }`;
s = s.replace(oldElse, newElse);

// renderVersionInfo: кнопка скачивания для старых оболочек EXE
const rviOld = `  const dl = $('#ver-download');
  if (!window.arbShell && p === 'web' && b && b.exeUrl) dl.classList.remove('hidden');
  else dl.classList.add('hidden');`;
if (!s.includes(rviOld)) throw new Error('renderVersionInfo gate not found');
const rviNew = `  const dl = $('#ver-download');
  if (b && b.exeUrl && (p === 'exe' || p === 'web')) dl.classList.remove('hidden');
  else dl.classList.add('hidden');`;
s = s.replace(rviOld, rviNew);

fs.writeFileSync(FILE, s);
new Function(s);
console.log('old-shell update check OK');
