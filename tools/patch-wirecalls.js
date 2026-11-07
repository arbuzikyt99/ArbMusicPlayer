/* Добавляет вызовы wireVersion() и wireStudio() в wire() */
'use strict';
const fs = require('fs');
const FILE = 'C:/Users/User/OneDrive/Desktop/ArbMusic/www/js/app.js';
let s = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

const anchor = '  wireAuth();\n  wireUpload();\n  wireAdmin();';
if (!s.includes(anchor)) throw new Error('wire anchor not found');
const fixed = '  wireAuth();\n  wireUpload();\n  wireAdmin();\n  wireVersion();\n  wireStudio();';
s = s.replace(anchor, fixed);
// на случай дублей
if (s.split('wireStudio();').length > 3) {
  // убираем возможный дубль
  const first = s.indexOf('  wireVersion();\n  wireStudio();', s.indexOf('wireVersion();') + 100);
  if (first !== -1) s = s.slice(0, first) + s.slice(first + '  wireVersion();\n  wireStudio();'.length + 1);
}
fs.writeFileSync(FILE, s);
new Function(s);
console.log('wire() calls fixed');
