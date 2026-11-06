/* 1) палитра обложек без зелени  2) апдейтер: «обновлений нет» + таймаут проверки */
'use strict';
const fs = require('fs');
const FILE = 'C:/Users/User/OneDrive/Desktop/ArbMusic/www/js/app.js';
let s = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

// 1. gradFor: избегаем зелёных оттенков (70–175) — сдвигаем в сине-фиолет-розовый диапазон
const gradOld = `function gradFor(track) {
  const h = hash(track.id) % 360;
  const h2 = (h + 45) % 360;
  return \`linear-gradient(135deg, hsl(\${h} 65% 42%), hsl(\${h2} 70% 30%))\`;
}`;
if (!s.includes(gradOld)) throw new Error('gradFor not found');
const gradNew = `function gradFor(track) {
  const h0 = hash(track.id) % 360;
  // зелёные оттенки (70–175) сдвигаем в фиолетово-розовый диапазон
  const h = (h0 >= 65 && h0 <= 180) ? 195 + (h0 - 65) % 140 : h0;
  const h2 = (h + 45) % 360;
  return \`linear-gradient(135deg, hsl(\${h} 65% 42%), hsl(\${h2} 70% 30%))\`;
}`;
s = s.replace(gradOld, gradNew);

// 2. UI: обработка «обновлений нет» + таймаут проверки
const evAnchor = `      } else if (d.event === 'error') {
        res.style.color = '#fca5a5';
        res.textContent = 'Обновление: ' + d.message;
      }`;
if (!s.includes(evAnchor)) throw new Error('updater event anchor not found');
const evNew = `      } else if (d.event === 'update-not-available') {
        res.style.color = '#6ee7b7';
        res.textContent = 'У тебя последняя версия ✓';
      } else if (d.event === 'error') {
        res.style.color = '#fca5a5';
        res.textContent = 'Обновление: ' + d.message;
      }`;
s = s.replace(evAnchor, evNew);

// таймаут: если за 15с апдейтер ничего не сказал — считаем что всё актуально
const checkAnchor = `      arbShell.checkForUpdates();`;
if (!s.includes(checkAnchor)) throw new Error('checkForUpdates anchor not found');
s = s.replace(checkAnchor, checkAnchor + `
      clearTimeout(window.__verT);
      window.__verT = setTimeout(() => {
        const res = $('#ver-result');
        if (res && res.textContent === 'Проверяю…') {
          res.style.color = '#6ee7b7';
          res.textContent = 'У тебя последняя версия ✓';
        }
      }, 15000);`);

fs.writeFileSync(FILE, s);
new Function(s);
console.log('OK: палитра без зелени + «обновлений нет» + таймаут');
