/* Убирает мёртвые ссылки на удалённую кнопку btn-upload-track */
'use strict';
const fs = require('fs');
const FILE = 'C:/Users/User/OneDrive/Desktop/ArbMusic/www/js/app.js';
let s = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

// 1. wireUpload: убрать листенер на удалённую кнопку
const l1 = `  $('#btn-upload-track').addEventListener('click', () => {\n`;
if (!s.includes(l1)) throw new Error('upload listener not found');
s = s.replace(l1, '');

// 2. студия: открывать модалку напрямую
s = s.replace("$('#btn-studio-upload2') && $('#btn-studio-upload2').addEventListener('click', () => $('#btn-upload-track').click());",
  "$('#btn-studio-upload2') && $('#btn-studio-upload2').addEventListener('click', () => openModal('modal-upload'));");
s = s.replace("$('#btn-studio-upload').addEventListener('click', () => $('#btn-upload-track').click());",
  "$('#btn-studio-upload').addEventListener('click', () => openModal('modal-upload'));");

fs.writeFileSync(FILE, s);
new Function(s);
console.log('мёртвые ссылки убраны');
