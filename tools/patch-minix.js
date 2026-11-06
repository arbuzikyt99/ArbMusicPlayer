/* Чинит крестик мини-плеера: виден всем, скрывает панель */
'use strict';
const fs = require('fs');
const ROOT = 'C:/Users/User/OneDrive/Desktop/ArbMusic/';

// HTML: класс mini-x (не админ-гейт)
let h = fs.readFileSync(ROOT + 'www/index.html', 'utf8');
h = h.replace('<button class="rdel" id="mini-close" title="Скрыть панель"', '<button class="mini-x" id="mini-close" title="Скрыть панель"');
fs.writeFileSync(ROOT + 'www/index.html', h);

// JS: обработчик
let s = fs.readFileSync(ROOT + 'www/js/app.js', 'utf8');
const anchor = "  $('#mini-play').addEventListener('click', togglePlay);";
if (!s.includes(anchor)) throw new Error('anchor not found');
const add = `  $('#mini-close').addEventListener('click', e => {
    e.stopPropagation();
    $('#mini').classList.remove('up'); // скрыть панель; музыка играет дальше
  });
` + anchor;
if (s.includes("$('#mini-close')")) throw new Error('handler already wired');
s = s.replace(anchor, add);
fs.writeFileSync(ROOT + 'www/js/app.js', s);
new Function(s);
console.log('mini-close fixed');
