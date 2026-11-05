/* Чинит Микс: чистый рандом без принудительного первого трека + удаляет mix-sub */
'use strict';
const fs = require('fs');
const FILE = 'C:/Users/User/OneDrive/Desktop/ArbMusic/www/js/app.js';
let s = fs.readFileSync(FILE, 'utf8');
s = s.replace(/\r\n/g, '\n'); // нормализация CRLF

const mixOld = `    state.shuffle = true;
    playList(state.tracks, 0, { shuffle: true, keepFirst: true });
    openPlayer();`;
if (!s.includes(mixOld)) throw new Error('mix handler not found');
s = s.replace(mixOld, `    state.shuffle = true;
    playList(state.tracks, -1, { shuffle: true });
    openPlayer();`);

const shOld = `    state.shuffle = true;
    playList(list, 0, { shuffle: true, keepFirst: true });
    openPlayer();`;
if (!s.includes(shOld)) throw new Error('shuffle handler not found');
s = s.replace(shOld, `    state.shuffle = true;
    playList(list, -1, { shuffle: true });
    openPlayer();`);

const msRe = /  \$\('#mix-sub'\)\.textContent = [^\n]*\n/;
if (!msRe.test(s)) throw new Error('mix-sub line not found');
s = s.replace(msRe, '');

const plOld = `    state.queue = shuffleArr([...list]);
    if (startIdx >= 0 && opts.keepFirst) {
      const t = list[startIdx];
      const k = state.queue.indexOf(t);
      if (k > 0) [state.queue[0], state.queue[k]] = [state.queue[k], state.queue[0]];
      state.qi = 0;
    } else state.qi = startIdx >= 0 ? 0 : 0;
    state.shuffle = true;`;
if (!s.includes(plOld)) throw new Error('playList block not found');
s = s.replace(plOld, `    state.queue = shuffleArr([...list]);
    state.qi = 0; // случайно выбранный трек — первый в перемешанной очереди
    state.shuffle = true;`);

fs.writeFileSync(FILE, s);
new Function(s);
console.log('mix random OK');
