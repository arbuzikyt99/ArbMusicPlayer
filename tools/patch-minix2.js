/* Чинит сломанный блок mini-close */
'use strict';
const fs = require('fs');
const FILE = 'C:/Users/User/OneDrive/Desktop/ArbMusic/www/js/app.js';
let s = fs.readFileSync(FILE, 'utf8');

const broken = `  $('#mini-close').addEventListener('click', e => {
    e.stopPropagation();
    .classList.remove('up'); // скрыть панель; музыка продолжает играть
  });
  $('#mini-play').addEventListener('click', togglePlay);
  $('#mini-close').addEventListener('click', e => {
    e.stopPropagation();
    .classList.remove('up');
    toast('Панель скрыта — музыка играет дальше');
  });`;
if (!s.includes(broken)) throw new Error('broken block not found');
const fixed = `  $('#mini-close').addEventListener('click', e => {
    e.stopPropagation();
    $('#mini').classList.remove('up'); // скрыть панель; музыка играет дальше
  });
  $('#mini-play').addEventListener('click', togglePlay);`;
s = s.replace(broken, fixed);

// HTML: класс mini-x (не админ-гейт)
let h = fs.readFileSync('C:/Users/User/OneDrive/Desktop/ArbMusic/www/index.html', 'utf8');
h = h.replace('<button class="rdel" id="mini-close" title="Скрыть панель"', '<button class="mini-x" id="mini-close" title="Скрыть панель"');
fs.writeFileSync('C:/Users/User/OneDrive/Desktop/ArbMusic/www/index.html', h);

fs.writeFileSync(FILE, s);
new Function(s);
console.log('mini-close fixed, JS OK');
