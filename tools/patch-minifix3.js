/* Крестик мини-плеера: полное закрытие панели (не видно за хотбаром) */
'use strict';
const fs = require('fs');
const ROOT = 'C:/Users/User/OneDrive/Desktop/ArbMusic/';

/* 1. CSS: класс closed — панель исчезает полностью */
let c = fs.readFileSync(ROOT + 'www/css/style.css', 'utf8').replace(/\r\n/g, '\n');
if (!c.includes('#mini.closed')) {
  c = c.replace(
    "#mini-close { width: 34px; height: 34px;",
    "#mini.closed { opacity: 0; visibility: hidden; transform: translateY(130%); pointer-events: none; }\n#mini-close { width: 34px; height: 34px;"
  );
  fs.writeFileSync(ROOT + 'www/css/style.css', c);
  console.log('css: #mini.closed добавлен');
} else console.log('css: уже есть');

/* 2. JS: крестик → closed; новый трек → показать снова */
let s = fs.readFileSync(ROOT + 'www/js/app.js', 'utf8').replace(/\r\n/g, '\n');
const oldClose = `    $('#mini').classList.remove('up'); // спрятать панель`;
if (!s.includes(oldClose)) throw new Error('mini-close line not found');
s = s.replace(oldClose, `    $('#mini').classList.remove('up');
    $('#mini').classList.add('closed'); // закрыть полностью`);

const showOld = `  const mini = $('#mini');
  mini.classList.remove('hidden');
  mini.classList.add('up');`;
if (!s.includes(showOld)) throw new Error('onTrackChanged not found');
s = s.replace(showOld, `  const mini = $('#mini');
  mini.classList.remove('hidden');
  mini.classList.remove('closed');
  mini.classList.add('up');`);

fs.writeFileSync(ROOT + 'www/js/app.js', s);
new Function(s);
console.log('js: closed-логика добавлена');
