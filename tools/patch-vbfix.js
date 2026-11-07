/* Чинит дубль const vb в refreshProfile */
'use strict';
const fs = require('fs');
const FILE = 'C:/Users/User/OneDrive/Desktop/ArbMusic/www/js/app.js';
let s = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

const broken = `    // зелёная точка, если обновление скачано и ждёт установки
    const vb = $('#btn-version');
    if (vb && !vb.querySelector('.upd-dot')) {
      const dot = document.createElement('i');
      dot.className = 'upd-dot';
      vb.appendChild(dot);
      vb.classList.add('upd-ready');
      dot.style.display = window.__updateReady ? 'block' : 'none';
    }
    // версия: веб — просто номер, apk/exe — кнопка обновлений
    const p = platformType();
    const vb = $('#btn-version'), vs = $('#ver-static'), vn = $('#ver-num');`;
if (!s.includes(broken)) throw new Error('broken block not found');
const fixed = `    // зелёная точка, если обновление скачано и ждёт установки
    const vbtn = $('#btn-version');
    if (vbtn && !vbtn.querySelector('.upd-dot')) {
      const dot = document.createElement('i');
      dot.className = 'upd-dot';
      vbtn.appendChild(dot);
      dot.style.display = window.__updateReady ? 'block' : 'none';
    }
    // версия: веб — просто номер, apk/exe — кнопка обновлений
    const p = platformType();
    const vb = $('#btn-version'), vs = $('#ver-static'), vn = $('#ver-num');`;
s = s.replace(broken, fixed);
fs.writeFileSync(FILE, s);
new Function(s);
console.log('fixed');
