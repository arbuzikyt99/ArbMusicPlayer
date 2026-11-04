/* Версия в профиле: веб — номер, apk/exe — кнопка обновлений */
'use strict';
const fs = require('fs');
const FILE = 'C:/Users/User/OneDrive/Desktop/ArbMusic/www/js/app.js';
let s = fs.readFileSync(FILE, 'utf8');

const anchor = "    const pb = $('#profile-premium-badge');";
if (!s.includes(anchor)) throw new Error('anchor not found');
const add = `    // версия: веб — просто номер, apk/exe — кнопка обновлений
    const p = platformType();
    const vb = $('#btn-version'), vs = $('#ver-static'), vn = $('#ver-num');
    if (p === 'web') { vb.classList.add('hidden'); vs.classList.remove('hidden'); vn.textContent = APP_VER; }
    else { vb.classList.remove('hidden'); vs.classList.add('hidden'); }
` + anchor;
s = s.replace(anchor, add);
fs.writeFileSync(FILE, s);
new Function(s);
console.log('refreshProfile OK');
