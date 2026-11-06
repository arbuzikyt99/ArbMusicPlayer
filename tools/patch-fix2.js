/* Чинит: 1) крестик мини-плеера останавливает музыку  2) убирает зелень из фона */
'use strict';
const fs = require('fs');
const ROOT = 'C:/Users/User/OneDrive/Desktop/ArbMusic/';

/* 1. крестик = пауза + скрыть панель */
let s = fs.readFileSync(ROOT + 'www/js/app.js', 'utf8').replace(/\r\n/g, '\n');
const oldHandler = `  $('#mini-close').addEventListener('click', e => {
    e.stopPropagation();
    $('#mini').classList.remove('up'); // скрыть панель; музыка играет дальше
  });`;
if (!s.includes(oldHandler)) throw new Error('mini-close handler not found');
const newHandler = `  $('#mini-close').addEventListener('click', e => {
    e.stopPropagation();
    audio.pause();
    updatePlayUI();
    $('#mini').classList.remove('up'); // спрятать панель
  });`;
s = s.replace(oldHandler, newHandler);
fs.writeFileSync(ROOT + 'www/js/app.js', s);
new Function(s);
console.log('mini-close: pause OK');

/* 2. стиль: бирюзовые пятна → фиолет/розовый, без hue-rotate (зелени не будет) */
let c = fs.readFileSync(ROOT + 'www/css/style.css', 'utf8').replace(/\r\n/g, '\n');
c = c.replace(/rgba\(45, 212, 191, \.2\), transparent 62%/g, 'rgba(168, 85, 247, .22), transparent 62%');
c = c.replace(/rgba\(45, 212, 191, .22\), transparent 62%/g, 'rgba(168, 85, 247, .25), transparent 62%');
c = c.replace(/rgba\(56, 189, 248, .28\), transparent 62%/g, 'rgba(217, 70, 239, .26), transparent 62%');
c = c.replace(/rgba\(56, 189, 248, .3\), transparent 62%/g, 'rgba(217, 70, 239, .28), transparent 62%');
c = c.replace(/rgba\(56, 189, 248, .12\), transparent 65%/g, 'rgba(236, 72, 153, .14), transparent 65%');
c = c.replace(/ filter: saturate\(1\.15\);/g, '');
c = c.replace(/ filter: saturate\(1\.45\) hue-rotate\(-8deg\);/g, '');
c = c.replace(/ filter: saturate\(1\.3\) hue-rotate\(8deg\);/g, '');
fs.writeFileSync(ROOT + 'www/css/style.css', c);
console.log('css: зелень убрана, hue-rotate удалён');
