/* UI обновления: прогресс-бар + вес/скорость/остаток; EXE — настоящий апдейтер */
'use strict';
const fs = require('fs');
const FILE = 'C:/Users/User/OneDrive/Desktop/ArbMusic/www/js/app.js';
let s = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

// 1. события апдейтера: полный прогресс + «обновлений нет» + скрытие бара
const evAnchor = `      } else if (d.event === 'update-not-available') {
        res.style.color = '#6ee7b7';
        res.textContent = 'У тебя последняя версия ✓';
      } else if (d.event === 'error') {
        res.style.color = '#fca5a5';
        res.textContent = 'Обновление: ' + d.message;
      }`;
if (!s.includes(evAnchor)) throw new Error('event anchor not found');
const evNew = `      } else if (d.event === 'update-not-available') {
        res.style.color = '#6ee7b7';
        res.textContent = 'У тебя последняя версия ✓';
        hideVerProgress();
      } else if (d.event === 'download-progress') {
        res.style.color = '#fde68a';
        res.textContent = 'Скачиваю: ' + d.percent + '% · ' + d.transferredMB.toFixed(1) + ' из ' + d.totalMB.toFixed(1) + ' МБ · ' + d.speedMBps.toFixed(1) + ' МБ/с · осталось ' + (d.totalMB - d.transferredMB).toFixed(1) + ' МБ';
        showVerProgress(d.percent);
      } else if (d.event === 'update-downloaded') {
        res.style.color = '#6ee7b7';
        res.textContent = 'Обновление ' + d.version + ' скачано — жми «Перезапустить и установить»';
        hideVerProgress();
        $('#ver-install').classList.remove('hidden');
        $('#ver-download').classList.add('hidden');
      } else if (d.event === 'error') {
        res.style.color = '#fca5a5';
        hideVerProgress();
        res.textContent = 'Обновление: ' + d.message;
      }`;
s = s.replace(evAnchor, evNew);

// 2. прогресс-бар хелперы
const fvAnchor = 'async function fetchBuild(bust) {';
if (!s.includes(fvAnchor)) throw new Error('fetchBuild not found');
s = s.replace(fvAnchor, `function showVerProgress(p) {
  const bar = $('#ver-progress');
  if (!bar) return;
  bar.classList.remove('hidden');
  const fill = $('#ver-progress-fill');
  if (fill) fill.style.width = p + '%';
}
function hideVerProgress() {
  const bar = $('#ver-progress');
  if (bar) bar.classList.add('hidden');
}
async function fetchBuild(bust) {`);

// 3. открыть модалку: спрятать прогресс и кнопку установки
const openAnchor = `    $('#ver-install').classList.add('hidden');
    $('#ver-download').classList.add('hidden');
    $('#ver-download').textContent = 'Скачать обновление';`;
if (!s.includes(openAnchor)) throw new Error('modal open anchor not found');
s = s.replace(openAnchor, openAnchor + `
    hideVerProgress();`);

fs.writeFileSync(FILE, s);
new Function(s);
console.log('updater UI OK');
