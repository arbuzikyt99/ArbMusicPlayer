/* Публикация музыки в общий каталог ArbMusic.
   Копирует файлы из «Добавить музыку/» в music/, пересобирает catalog.json. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IN = path.join(ROOT, 'Добавить музыку');
const MUSIC = path.join(ROOT, 'music');
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|wma)$/i;

fs.mkdirSync(MUSIC, { recursive: true });
fs.mkdirSync(IN, { recursive: true });

let added = 0;
for (const f of fs.readdirSync(IN)) {
  if (f.startsWith('.')) continue;
  const p = path.join(IN, f);
  if (!fs.statSync(p).isFile()) continue;
  if (AUDIO_EXT.test(f) || /\.(lrc|txt)$/i.test(f)) {
    fs.copyFileSync(p, path.join(MUSIC, f));
    if (AUDIO_EXT.test(f)) added++;
  }
}

function parseName(n) {
  let b = n.replace(/\.[^.]+$/, '').replace(/^\s*\d+[\s.\-_]+/, '');
  const m = b.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: 'Неизвестный исполнитель', title: b.trim() };
}

/* сохраняем обложки, добавленные через модерацию */
let prevCovers = {};
try {
  const prev = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog.json'), 'utf8'));
  for (const t of (prev.tracks || [])) if (t.cover) prevCovers[t.file] = t.cover;
} catch (_) { /* нет старого каталога */ }

const files = fs.readdirSync(MUSIC).filter(f => !f.startsWith('.'));
const entries = [];
for (const f of files.sort()) {
  if (!AUDIO_EXT.test(f)) continue;
  const { artist, title } = parseName(f);
  const base = f.replace(/\.[^.]+$/, '').toLowerCase();
  let lrc = null;
  for (const e of files) {
    const le = e.toLowerCase();
    if (le === base + '.lrc' || le === base + '.txt') { lrc = e; break; }
  }
  entries.push({ id: 'cloud_' + f, file: f, title, artist, lrc, cover: prevCovers[f] || null });
}

fs.writeFileSync(path.join(ROOT, 'catalog.json'),
  JSON.stringify({ updated: new Date().toISOString(), tracks: entries }, null, 2));

console.log(`Новых треков добавлено: ${added}`);
console.log(`Всего в общем каталоге: ${entries.length}`);
if (added) console.log('Дальше запусти push — треки увидят все пользователи приложения.');
