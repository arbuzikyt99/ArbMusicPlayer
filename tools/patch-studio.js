/* ArbStudio: раздел студии + подсчёт прослушиваний */
'use strict';
const fs = require('fs');
const FILE = 'C:/Users/User/OneDrive/Desktop/ArbMusic/www/js/app.js';
let s = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

// 1. подсчёт прослушивания облачного трека (раз за сессию на трек)
const tpAnchor = 'function updatePlayUI() {';
if (!s.includes(tpAnchor)) throw new Error('updatePlayUI not found');
s = s.replace(tpAnchor, `/* учёт прослушивания: раз за сессию на трек */
const playsSent = new Set();
function trackPlay(t) {
  if (!t || !t.cloud || !t.file || playsSent.has(t.id)) return;
  playsSent.add(t.id);
  api('/api/play', { body: { file: t.file } }).catch(() => {});
}

` + tpAnchor);

// 2. учёт при старте воспроизведения — в onTrackChanged
const otcAnchor = `  updateMediaSession(t);`;
if (!s.includes(otcAnchor)) throw new Error('onTrackChanged anchor not found');
s = s.replace(otcAnchor, otcAnchor + `
  trackPlay(t);`);

// 3. показать студию при открытии профиля-вью — wireVersion не трогаем; отдельная wireStudio
const wvAnchor = 'function wireVersion() {';
if (!s.includes(wvAnchor)) throw new Error('wireVersion not found');
const wireStudio = `/* ---------- ArbStudio ---------- */
function wireStudio() {
  $('#btn-studio').addEventListener('click', async () => {
    if (!session()) { openModal('modal-auth'); return; }
    showView('studio');
    loadStudio();
  });
  $('#btn-studio-upload2') && $('#btn-studio-upload2').addEventListener('click', () => $('#btn-upload-track').click());
  $('#btn-studio-upload').addEventListener('click', () => $('#btn-upload-track').click());
  $('#studio-refresh').addEventListener('click', () => loadStudio());
}
async function loadStudio() {
  if (!session()) { showView('profile'); return; }
  const refresh = $('#studio-refresh');
  refresh.classList.add('spin');
  try {
    const d = await api('/api/studio');
    $('#st-plays').textContent = d.totals.plays;
    $('#st-pub').textContent = d.totals.published;
    $('#st-pend').textContent = d.totals.pending;
    const box = $('#studio-tracks');
    const rows = [];
    for (const t of d.published) {
      rows.push(\`<div class="studio-track">
        <div class="thumb" style="background:\${gradFor({ id: 'cloud_' + t.file })}">\${NOTE_SVG}</div>
        <div class="smeta"><b>\${esc(t.title)}</b><span>\${esc(t.artist)} · в общей базе</span></div>
        <div class="splays"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.4v13.2c0 .8.9 1.3 1.6.9l10-6.6a1.06 1.06 0 0 0 0-1.8l-10-6.6c-.7-.5-1.6 0-1.6.9z"/></svg>\${t.plays}</div>
      </div>\`);
    }
    for (const t of d.pending) {
      rows.push(\`<div class="studio-track">
        <div class="thumb" style="background:\${gradFor({ id: t.id })}">\${NOTE_SVG}</div>
        <div class="smeta"><b>\${esc(t.title)}</b><span>\${esc(t.artist)} · на модерации</span></div>
        <span class="badge pending">Проверка</span>
      </div>\`);
    }
    box.innerHTML = rows.join('');
    $('#empty-studio').classList.toggle('hidden', rows.length > 0);
  } catch (e) {
    const box = $('#studio-tracks');
    box.innerHTML = '<div class="admin-spin">' + esc(e.message) + '</div>';
  } finally {
    refresh.classList.remove('spin');
  }
}

` + wvAnchor;
s = s.replace(wvAnchor, wireStudio);

// 4. wire(): вызвать wireStudio
const wAnchor = '  wireAuth();\n  wireUpload();\n  wireAdmin();\n  wireVersion();';
if (!s.includes(wAnchor)) throw new Error('wire calls not found');
s = s.replace(wAnchor, wAnchor + '\n  wireStudio();');

// 5. showView('studio') — грузить студию
const svAnchor = "  if (name === 'profile') refreshProfile();";
if (!s.includes(svAnchor)) throw new Error('showView anchor not found');
s = s.replace(svAnchor, svAnchor + `
  if (name === 'studio') loadStudio();`);

fs.writeFileSync(FILE, s);
new Function(s);
console.log('studio OK');
