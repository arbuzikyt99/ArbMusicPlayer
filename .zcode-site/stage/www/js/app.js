/* ================= ArbMusic app ================= */
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ---------- state ---------- */
const state = {
  tracks: [],            // all tracks
  queue: [],             // current queue (track objects)
  baseQueue: [],         // unshuffled queue
  qi: -1,                // current index in queue
  shuffle: false,
  repeat: 'off',         // off | all | one
  favs: new Set(JSON.parse(localStorage.getItem('arbmusic.favs') || '[]')),
  lrcMap: {},            // web: basename -> lyrics text
  view: 'home',
  listKind: 'all',       // 'mix' | 'favs'
  artCache: new Map(),   // id -> dataURL
  seeking: false,
};

const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const Native = isNative ? window.Capacitor.Plugins.MusicScanner : null;

const audio = new Audio();
audio.preload = 'metadata';

/* Chrome sometimes reports Infinity for WAV streams — fall back to seekable range */
function realDuration() {
  if (isFinite(audio.duration) && audio.duration > 0) return audio.duration;
  try {
    if (audio.seekable && audio.seekable.length) return audio.seekable.end(audio.seekable.length - 1);
  } catch (_) { /* ignore */ }
  return 0;
}

/* ---------- utils ---------- */
const fmt = s => {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const m = Math.floor(s / 60), sec = s % 60;
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
};
const hash = str => { let h = 0; for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; } return Math.abs(h); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, few, many) => { const m10 = n % 10, m100 = n % 100; if (m10 === 1 && m100 !== 11) return one; if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 > 20)) return few; return many; };

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove('show'), 2400);
}

/* deterministic pretty gradient per track */
function gradFor(track) {
  const h = hash(track.id) % 360;
  const h2 = (h + 45) % 360;
  return `linear-gradient(135deg, hsl(${h} 65% 42%), hsl(${h2} 70% 30%))`;
}

const NOTE_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M9 18.5V6.8l9-2.3v11" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6.6" cy="18.5" r="2.4" fill="#fff"/><circle cx="15.6" cy="15.5" r="2.4" fill="#fff"/></svg>';

function thumbHTML(track, cls) {
  return `<div class="thumb ${cls || ''}" style="background:${gradFor(track)}">${NOTE_SVG}</div>`;
}

function trackUrl(t) {
  if (t.url) return t.url;
  if (isNative && t.path) {
    let u = window.Capacitor.convertFileSrc(t.path);
    u = encodeURI(u).replace(/%253A/g, '%3A');
    t.url = u;
  }
  return t.url;
}

/* ---------- favorites ---------- */
function saveFavs() {
  localStorage.setItem('arbmusic.favs', JSON.stringify([...state.favs]));
}
function toggleFav(id) {
  if (state.favs.has(id)) state.favs.delete(id); else state.favs.add(id);
  saveFavs();
  refreshFavUI();
}
function refreshFavUI() {
  const n = state.favs.size;
  $('#favs-sub').textContent = n ? `${n} ${plural(n, 'трек', 'трека', 'треков')}` : 'сохранённые треки';
  const cur = current();
  const pf = $('#btn-fav');
  pf.classList.toggle('fav', !!(cur && state.favs.has(cur.id)));
  $$(`.rheart[data-id]`).forEach(b => b.classList.toggle('fav', state.favs.has(b.dataset.id)));
}

/* ---------- scan ---------- */
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|wma)$/i;

function parseName(name) {
  let base = name.replace(/\.[^.]+$/, '');
  const m = base.match(/^\s*(?:\d+[\s.\-_]+)?(.+?)\s*-\s*(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: 'Неизвестный исполнитель', title: base.trim() };
}

async function scanNative() {
  const btn = $('#btn-rescan');
  btn.classList.add('spin');
  try {
    const res = await Native.scan();
    if (res.status === 'needsAllFiles') { showPerm(true); return; }
    if (res.status === 'denied') { toast('Нет доступа к файлам'); return; }
    state.tracks = (res.tracks || []).map(t => ({
      id: t.path, path: t.path, title: t.title || t.name, artist: t.artist || 'Неизвестный исполнитель',
      album: t.album || '', dur: t.duration || 0, ext: t.ext || '', name: t.name || '',
    }));
    sortByDefault(state.tracks);
    afterScan();
  } catch (e) {
    console.error(e); toast('Ошибка сканирования');
  } finally { btn.classList.remove('spin'); }
}

function sortByDefault(arr) {
  arr.sort((a, b) => (a.artist || '').localeCompare(b.artist || '', 'ru') || (a.title || '').localeCompare(b.title || '', 'ru'));
}

function afterScan() {
  const n = state.tracks.length;
  $('#mix-sub').textContent = n ? `случайный порядок · ${n} ${plural(n, 'трек', 'трека', 'треков')}` : 'случайный порядок · все треки';
  $('#all-count').textContent = n ? `${n} ${plural(n, 'трек', 'трека', 'треков')}` : '';
  $('#home-sub').textContent = n ? `${n} ${plural(n, 'трек', 'трека', 'треков')} найдено` : 'твоя музыка';
  renderHome();
  if (state.view === 'list') renderListView();
  refreshFavUI();
  if (n) toast(`Найдено ${n} ${plural(n, 'трек', 'трека', 'треков')}`);
}

/* web fallback: pick folder (desktop) or files (iOS) */
function pickFolder() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  (ios ? $('#filepick') : $('#dirpick')).click();
}
function onDirPicked(e) {
  importFiles(e.target.files);
  e.target.value = '';
}

/* lazy duration probing on web */
const probeQueue = [];
let probing = 0;
function probeDuration(track) {
  if ((!track.file && !track.url) || track.dur) return;
  probeQueue.push(track);
  pumpProbe();
}
function pumpProbe() {
  while (probing < 4 && probeQueue.length) {
    const t = probeQueue.shift();
    probing++;
    const a = new Audio();
    a.preload = 'metadata';
    const done = () => {
      if (isFinite(a.duration)) t.dur = a.duration;
      a.src = '';
      probing--;
      pumpProbe();
      $$(`.rdur[data-id="${CSS.escape(t.id)}"]`).forEach(el => el.textContent = fmt(t.dur));
      // сохранить длительность в базу
      if (t.dur && !isNative) {
        openDB().then(db => new Promise(res => {
          const st = db.transaction('tracks').objectStore('tracks');
          const gq = st.get(t.id);
          gq.onsuccess = () => {
            if (gq.result) { gq.result.dur = t.dur; st.put(gq.result); }
            res();
          };
          gq.onerror = res;
        })).catch(() => {});
      }
    };
    a.onloadedmetadata = done;
    a.onerror = () => { probing--; pumpProbe(); };
    a.src = t.file ? URL.createObjectURL(t.file) : t.url;
  }
}

/* ---------- IndexedDB: постоянная библиотека (web / PWA) ---------- */
let idb = null;
function openDB() {
  if (idb) return Promise.resolve(idb);
  return new Promise((res, rej) => {
    const rq = indexedDB.open('arbmusic', 1);
    rq.onupgradeneeded = () => {
      rq.result.createObjectStore('tracks', { keyPath: 'id' });
    };
    rq.onsuccess = () => { idb = rq.result; res(idb); };
    rq.onerror = () => rej(rq.error);
  });
}
function idbPut(rec) {
  return openDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction('tracks', 'readwrite');
    tx.objectStore('tracks').put(rec);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  }));
}
function idbAll() {
  return openDB().then(db => new Promise((res, rej) => {
    const rq = db.transaction('tracks').objectStore('tracks').getAll();
    rq.onsuccess = () => res(rq.result || []);
    rq.onerror = () => rej(rq.error);
  }));
}
function idbDel(id) {
  return openDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction('tracks', 'readwrite');
    tx.objectStore('tracks').delete(id);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  }));
}

async function importFiles(fileList) {
  const arr = [...fileList];
  const audio = [], texts = {};
  for (const f of arr) {
    if (/\.(lrc|txt)$/i.test(f.name)) {
      const base = f.name.replace(/\.(lrc|txt)$/i, '').toLowerCase();
      try { texts[base] = await f.text(); } catch (_) { /* ignore */ }
    } else if (AUDIO_EXT.test(f.name)) {
      audio.push(f);
    }
  }
  if (!audio.length) { toast('Аудиофайлы не найдены'); return; }
  for (const f of audio) {
    const base = f.name.replace(/\.[^.]+$/, '').toLowerCase();
    const { artist, title } = parseName(f.name);
    await idbPut({
      id: `${f.name}_${f.size}`, name: f.name, title, artist, album: '',
      dur: 0, ext: (f.name.match(/\.(\w+)$/i) || [, ''])[1].toLowerCase(),
      blob: f, lrc: texts[base] || null,
    });
  }
  await loadLibrary();
  let extra = '';
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      extra = ` · ${(est.usage / 1048576).toFixed(0)} МБ`;
    }
  } catch (_) { /* ignore */ }
  toast(`Сохранено: ${audio.length} ${plural(audio.length, 'трек', 'трека', 'треков')}${extra}`);
}

async function loadLibrary() {
  if (!('indexedDB' in window)) return false;
  try {
    const recs = await idbAll();
    state.tracks.forEach(t => { if (t.url) URL.revokeObjectURL(t.url); });
    state.lrcMap = {};
    state.tracks = recs.map(r => ({
      id: r.id, name: r.name, title: r.title, artist: r.artist, album: r.album || '',
      dur: r.dur || 0, ext: r.ext || '', url: URL.createObjectURL(r.blob), lrc: r.lrc || null,
    }));
    for (const t of state.tracks) {
      if (t.lrc && t.name) state.lrcMap[t.name.replace(/\.[^.]+$/, '').toLowerCase()] = t.lrc;
    }
    sortByDefault(state.tracks);
    afterScan();
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

/* ---------- rendering ---------- */
function rowHTML(t, i) {
  const fav = state.favs.has(t.id);
  return `<div class="row" data-i="${i}">
    ${thumbHTML(t)}
    <div class="rmeta">
      <div class="rtitle">${esc(t.title)}</div>
      <div class="rartist">${esc(t.artist)}</div>
    </div>
    <span class="rdur" data-id="${esc(t.id)}">${t.dur ? fmt(t.dur) : (t.file ? '·:··' : '')}</span>
    <button class="rdel" data-del="${esc(t.id)}" aria-label="Удалить">
      <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
    <button class="rheart ${fav ? 'fav' : ''}" data-id="${esc(t.id)}" aria-label="В избранное">
      <svg viewBox="0 0 24 24" fill="none"><path d="M12 20.7C7 16.5 3.5 13.3 3.5 9.7 3.5 7 5.6 5 8.2 5c1.5 0 3 .7 3.8 2 .8-1.3 2.3-2 3.8-2 2.6 0 4.7 2 4.7 4.7 0 3.6-3.5 6.8-8.5 11z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
    </button>
  </div>`;
}

function renderRows(container, list, emptyEl) {
  container.innerHTML = list.map((t, i) => rowHTML(t, i)).join('');
  if (emptyEl) emptyEl.classList.toggle('show', list.length === 0);
  markPlaying();
  if (container === $('#tracklist') && !isNative) list.forEach(probeDuration);
}

function renderHome() {
  renderRows($('#tracklist'), state.tracks, $('#empty-home'));
  $('#btn-pick-folder').classList.toggle('hidden', isNative);
  $('#empty-home-text').textContent = isNative
    ? 'Нажми «Обновить» сверху, чтобы найти музыку на устройстве'
    : 'Выбери папку с музыкой, чтобы начать';
}

function renderListView() {
  const isFav = state.listKind === 'favs';
  $('#list-title').textContent = isFav ? 'Моя музыка' : 'Микс';
  const list = isFav ? state.tracks.filter(t => state.favs.has(t.id)) : state.tracks;
  renderRows($('#list-tracks'), list, $('#empty-list'));
}

function renderSearch(q) {
  q = (q || '').trim().toLowerCase();
  const list = q ? state.tracks.filter(t =>
    t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || (t.album || '').toLowerCase().includes(q)
  ) : state.tracks;
  state.searchList = list;
  renderRows($('#search-results'), list, $('#empty-search'));
  $('#empty-search').style.display = q || state.tracks.length ? '' : 'none';
}

function markPlaying() {
  const cur = current();
  $$('.row').forEach(r => {
    const inQueue = r.closest('#tracklist') ? state.tracks
      : r.closest('#list-tracks') ? getListForView()
      : r.closest('#search-results') ? (state.searchList || state.tracks)
      : state.tracks;
    const t = inQueue[+r.dataset.i];
    r.classList.toggle('playing', !!(cur && t && t.id === cur.id));
  });
}

function getListForView() {
  return state.listKind === 'favs' ? state.tracks.filter(t => state.favs.has(t.id)) : state.tracks;
}

/* ---------- views ---------- */
function showView(name) {
  state.view = name;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'list') renderListView();
  if (name === 'search') { renderSearch($('#search-input').value); if (!isNative) return; }
}

/* ---------- queue & playback ---------- */
function current() { return state.queue[state.qi] || null; }

function shuffleArr(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function playList(list, startIdx, opts = {}) {
  state.baseQueue = [...list];
  if (opts.shuffle || state.shuffle) {
    state.queue = shuffleArr([...list]);
    if (startIdx >= 0 && opts.keepFirst) {
      const t = list[startIdx];
      const k = state.queue.indexOf(t);
      if (k > 0) [state.queue[0], state.queue[k]] = [state.queue[k], state.queue[0]];
      state.qi = 0;
    } else state.qi = startIdx >= 0 ? 0 : 0;
    state.shuffle = true;
  } else {
    state.queue = [...list];
    state.qi = startIdx >= 0 ? startIdx : 0;
  }
  updateShuffleUI();
  playCurrent();
}

function playCurrent() {
  const t = current();
  if (!t) return;
  audio.src = trackUrl(t);
  audio.play().catch(err => { console.error(err); toast('Не удалось воспроизвести файл'); });
  onTrackChanged(t);
}

function next(auto = false) {
  if (!state.queue.length) return;
  if (state.qi < state.queue.length - 1) { state.qi++; }
  else if (state.repeat === 'all' || !auto) { state.qi = 0; }
  else { // end of queue, repeat off
    audio.pause(); audio.currentTime = 0;
    updatePlayUI();
    return;
  }
  playCurrent();
}

function prev() {
  if (audio.currentTime > 3 || state.queue.length < 2) { audio.currentTime = 0; return; }
  state.qi = state.qi > 0 ? state.qi - 1 : state.queue.length - 1;
  playCurrent();
}

function togglePlay() {
  if (!current()) {
    if (state.tracks.length) playList(state.tracks, 0);
    return;
  }
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}

function onTrackChanged(t) {
  // mini
  const mini = $('#mini');
  mini.classList.remove('hidden');
  mini.classList.add('up');
  $('#mini-title').textContent = t.title;
  $('#mini-artist').textContent = t.artist;
  $('#mini-art').outerHTML = thumbHTML(t, 'mini-art').replace('class="thumb', 'id="mini-art" class="thumb');
  // full player
  $('#p-title').textContent = t.title;
  $('#p-artist').textContent = t.artist;
  const pa = $('#p-art');
  pa.style.background = gradFor(t);
  pa.innerHTML = NOTE_SVG;
  const img = pa.querySelector('img'); if (img) img.remove();
  $('#p-art-glow').style.background = gradFor(t);
  loadArt(t);
  loadLyrics(t);
  updatePlayUI();
  markPlaying();
  refreshFavUI();
  updateMediaSession(t);
  // lazy duration probe for web
  if (!isNative) probeDuration(t);
}

function updatePlayUI() {
  const playing = !audio.paused && !audio.ended && !!audio.src;
  $('#btn-play').classList.toggle('playing', playing);
  $('#btn-play').innerHTML = playing
    ? '<svg class="ic-pause" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4.2" height="15" rx="1.6"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.6"/></svg>'
    : '<svg class="ic-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.4v13.2c0 .8.9 1.3 1.6.9l10-6.6a1.06 1.06 0 0 0 0-1.8l-10-6.6c-.7-.5-1.6 0-1.6.9z"/></svg>';
  const mp = $('#mini-play');
  mp.innerHTML = playing
    ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4.2" height="15" rx="1.6"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.6"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.4v13.2c0 .8.9 1.3 1.6.9l10-6.6a1.06 1.06 0 0 0 0-1.8l-10-6.6c-.7-.5-1.6 0-1.6.9z"/></svg>';
}

function updateShuffleUI() {
  $('#btn-shuffle').classList.toggle('on', state.shuffle);
}

function updateRepeatUI() {
  const b = $('#btn-repeat');
  b.classList.toggle('on', state.repeat !== 'off');
  b.querySelector('.rep-one').classList.toggle('hidden', state.repeat !== 'one');
}

/* ---------- art ---------- */
async function loadArt(t) {
  if (!isNative) return;
  if (state.artCache.has(t.id)) return applyArt(t, state.artCache.get(t.id));
  try {
    const r = await Native.getArt({ path: t.path });
    if (r && r.data) { state.artCache.set(t.id, r.data); applyArt(t, r.data); }
  } catch (_) { /* no art */ }
}
function applyArt(t, dataUrl) {
  const cur = current();
  if (!cur || cur.id !== t.id) return;
  const img = document.createElement('img');
  img.src = dataUrl;
  img.onload = () => {
    const pa = $('#p-art');
    if (current() && current().id === t.id) {
      pa.querySelector('img')?.remove();
      pa.appendChild(img);
      $('#p-art-glow').style.opacity = '.75';
    }
    // mini art too
    const ma = $('#mini-art');
    if (ma && current().id === t.id) {
      ma.querySelector('img')?.remove();
      const mi = document.createElement('img'); mi.src = dataUrl; ma.appendChild(mi);
    }
  };
}

/* ---------- lyrics ---------- */
let lyricLines = [];       // {t, el} or plain
let lyricSync = false;
let lastLyricIdx = -1;
let userScrollUntil = 0;

function parseLrc(text) {
  const out = [];
  const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  let hasTags = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    re.lastIndex = 0;
    let m, times = [], lastIndex = 0;
    while ((m = re.exec(raw))) { hasTags = true; times.push(+m[1] * 60 + +m[2] + (m[3] ? +(('0.' + m[3])) : 0)); lastIndex = re.lastIndex; }
    const txt = raw.slice(lastIndex).trim();
    if (times.length && txt) times.forEach(t => out.push({ t, txt }));
  }
  out.sort((a, b) => a.t - b.t);
  return { lines: out, synced: hasTags && out.length > 0 };
}

async function loadLyrics(t) {
  lyricLines = []; lyricSync = false; lastLyricIdx = -1;
  let text = null;
  try {
    if (isNative && t.path) {
      const r = await Native.getLyrics({ path: t.path });
      if (r && r.lyrics) text = r.lyrics;
    } else if (t.name) {
      const base = t.name.replace(/\.[^.]+$/, '').toLowerCase();
      const v = state.lrcMap[base];
      if (typeof v === 'string') text = v;
    }
  } catch (_) { /* ignore */ }

  const box = $('#lyrics-scroll');
  if (!text || !text.trim()) {
    box.innerHTML = '<div class="lrc-empty">Текст недоступен для этого трека<br><br>Положи файл <b>.lrc</b> рядом с треком</div>';
    return;
  }
  const { lines, synced } = parseLrc(text);
  if (!lines.length) {
    box.innerHTML = '<div class="lrc-empty">Текст недоступен для этого трека</div>';
    return;
  }
  lyricSync = synced;
  lyricLines = lines;
  box.innerHTML = lines.map((l, i) =>
    `<div class="lrc-line" data-i="${i}">${esc(l.txt)}</div>`).join('');
  [...box.children].forEach((el, i) => { lyricLines[i].el = el; });
  lastLyricIdx = -1;
}

function syncLyrics(t) {
  if (!lyricSync || state.seeking) return;
  const cur = current(); if (!cur) return;
  const time = audio.currentTime;
  // find last line with t <= time
  let lo = 0, hi = lyricLines.length - 1, idx = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (lyricLines[mid].t <= time) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  if (idx === lastLyricIdx) return;
  if (lastLyricIdx >= 0 && lyricLines[lastLyricIdx]) lyricLines[lastLyricIdx].el.classList.remove('active');
  lastLyricIdx = idx;
  if (idx >= 0) {
    const el = lyricLines[idx].el;
    el.classList.add('active');
    if (Date.now() > userScrollUntil) {
      const box = $('#lyrics-scroll');
      const top = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
      box.scrollTo({ top, behavior: 'smooth' });
    }
  }
}

/* ---------- seekbar ---------- */
const seekbar = $('#seekbar');
function seekFromEvent(e) {
  const r = seekbar.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
  return Math.min(1, Math.max(0, x / r.width));
}
function startSeek(e) {
  if (!audio.src) return;
  state.seeking = true;
  seekbar.classList.add('drag');
  moveSeek(e);
  window.addEventListener('pointermove', moveSeek);
  window.addEventListener('pointerup', endSeek);
  window.addEventListener('pointercancel', endSeek);
}
function moveSeek(e) {
  const p = seekFromEvent(e);
  $('#seek-fill').style.width = (p * 100) + '%';
  $('#seek-thumb').style.left = (p * 100) + '%';
  $('#t-cur').textContent = fmt(p * realDuration());
}
function endSeek(e) {
  const p = seekFromEvent(e.changedTouches ? { clientX: e.changedTouches[0].clientX } : e);
  const d = realDuration();
  if (d > 0) audio.currentTime = p * d;
  state.seeking = false;
  seekbar.classList.remove('drag');
  window.removeEventListener('pointermove', moveSeek);
  window.removeEventListener('pointerup', endSeek);
  window.removeEventListener('pointercancel', endSeek);
}
seekbar.addEventListener('pointerdown', startSeek);

/* ---------- audio events ---------- */
audio.addEventListener('timeupdate', () => {
  const d = realDuration();
  const p = d ? audio.currentTime / d : 0;
  if (!state.seeking) {
    $('#seek-fill').style.width = (p * 100) + '%';
    $('#seek-thumb').style.left = (p * 100) + '%';
    $('#t-cur').textContent = fmt(audio.currentTime);
  }
  $('#t-dur').textContent = fmt(d);
  $('#mini-fill').style.width = (p * 100) + '%';
  syncLyrics();
});
audio.addEventListener('loadedmetadata', () => {
  if (!isFinite(audio.duration)) {
    // Chrome отдаёт Infinity для WAV-потоков — заставляем досчитать длительность
    audio.currentTime = 1e7;
    const reset = () => {
      audio.removeEventListener('durationchange', reset);
      // сбрасываем позицию только если пользователь не перемотал во время пересчёта
      if (audio.currentTime > 1e6) audio.currentTime = 0;
      $('#t-dur').textContent = fmt(realDuration());
    };
    audio.addEventListener('durationchange', reset);
    return;
  }
  const t = current();
  if (t && !t.dur && isFinite(audio.duration)) {
    t.dur = audio.duration;
    $$(`.rdur[data-id="${CSS.escape(t.id)}"]`).forEach(el => el.textContent = fmt(t.dur));
  }
  $('#t-dur').textContent = fmt(audio.duration);
});
audio.addEventListener('play', updatePlayUI);
audio.addEventListener('pause', updatePlayUI);
audio.addEventListener('ended', () => {
  if (state.repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
  next(true);
});
audio.addEventListener('error', () => {
  if (audio.src) toast('Ошибка воспроизведения файла');
});

/* ---------- media session ---------- */
function updateMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  try {
    const art = state.artCache.get(t.id);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist, album: t.album || 'ArbMusic',
      artwork: art ? [{ src: art, sizes: '512x512', type: 'image/jpeg' }] : [],
    });
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', prev);
    navigator.mediaSession.setActionHandler('nexttrack', () => next());
    navigator.mediaSession.setActionHandler('seekto', d => { if (d.seekTime != null) audio.currentTime = d.seekTime; });
  } catch (_) { /* ignore */ }
}

/* ---------- player sheet ---------- */
function openPlayer() {
  if (!current()) { toast('Сначала выбери трек'); return; }
  $('#player').classList.add('open');
  showLyrics(false);
}
function closePlayer() { $('#player').classList.remove('open'); }

let lyricsOpen = false;
function showLyrics(on) {
  lyricsOpen = on;
  $('#p-art-wrap').classList.toggle('hidden', on);
  $('#p-lyrics').classList.toggle('hidden', !on);
  $('#btn-lyrics').classList.toggle('active', on);
  if (on) {
    const cur = current();
    if (cur) loadLyrics(cur);
  }
}

/* ---------- permissions (android) ---------- */
function showPerm(on) { $('#perm').classList.toggle('hidden', !on); $('#perm').classList.toggle('show', on); }

/* ---------- events wiring ---------- */
function wire() {
  // home
  $('#btn-rescan').addEventListener('click', () => {
    if (isNative) scanNative(); else pickFolder();
  });
  $('#card-mix').addEventListener('click', () => {
    if (!state.tracks.length) { toast('Сначала найди музыку'); return; }
    state.shuffle = true;
    playList(state.tracks, 0, { shuffle: true, keepFirst: true });
    openPlayer();
  });
  $('#card-favs').addEventListener('click', () => {
    state.listKind = 'favs'; showView('list');
  });
  $('#btn-search').addEventListener('click', () => {
    showView('search');
    setTimeout(() => $('#search-input').focus(), 250);
  });
  $('#btn-pick-folder').addEventListener('click', pickFolder);
  $('#dirpick').addEventListener('change', onDirPicked);
  $('#filepick').addEventListener('change', onDirPicked);

  // list view
  $('#btn-list-shuffle').addEventListener('click', () => {
    const list = getListForView();
    if (!list.length) { toast('Пусто'); return; }
    state.shuffle = true;
    playList(list, 0, { shuffle: true, keepFirst: true });
    openPlayer();
  });
  $$('[data-back]').forEach(b => b.addEventListener('click', () => showView('home')));

  // search
  $('#search-input').addEventListener('input', e => renderSearch(e.target.value));

  // row clicks (delegation)
  const rowHandler = (container, getList) => {
    container.addEventListener('click', e => {
      const del = e.target.closest('.rdel');
      if (del) {
        e.stopPropagation();
        const id = del.dataset.del;
        idbDel(id).then(() => {
          const wasCurrent = current() && current().id === id;
          if (wasCurrent) { audio.pause(); audio.removeAttribute('src'); }
          state.favs.delete(id); saveFavs();
          loadLibrary().then(() => toast('Трек удалён'));
        });
        return;
      }
      const heart = e.target.closest('.rheart');
      const row = e.target.closest('.row');
      if (!row) return;
      const list = getList();
      const t = list[+row.dataset.i];
      if (!t) return;
      if (heart) { toggleFav(heart.dataset.id); return; }
      const cur = current();
      if (cur && cur.id === t.id) { openPlayer(); return; }
      const idx = state.queue.findIndex(q => q.id === t.id);
      if (idx >= 0 && state.queue.length && sameQueue(getList())) {
        state.qi = idx; playCurrent(); openPlayer(); return;
      }
      playList(list, +row.dataset.i);
      openPlayer();
    });
  };
  const sameQueue = list => state.baseQueue.length === list.length && state.baseQueue[0] === list[0];
  rowHandler($('#tracklist'), () => state.tracks);
  rowHandler($('#list-tracks'), getListForView);
  rowHandler($('#search-results'), () => state.searchList || state.tracks);

  // mini
  $('#mini').addEventListener('click', e => {
    if (e.target.closest('.iconbtn')) return;
    openPlayer();
  });
  $('#mini-play').addEventListener('click', togglePlay);
  $('#mini-next').addEventListener('click', () => next());

  // full player
  $('#btn-collapse').addEventListener('click', closePlayer);
  $('#btn-play').addEventListener('click', togglePlay);
  $('#btn-next').addEventListener('click', () => next());
  $('#btn-prev').addEventListener('click', prev);
  $('#btn-fav').addEventListener('click', () => { const c = current(); if (c) toggleFav(c.id); });
  $('#btn-shuffle').addEventListener('click', () => {
    state.shuffle = !state.shuffle;
    if (state.queue.length) {
      const cur = current();
      if (state.shuffle) {
        const rest = state.baseQueue.filter(t => t.id !== cur.id);
        state.queue = [cur, ...shuffleArr([...rest])];
        state.qi = 0;
      } else {
        state.queue = [...state.baseQueue];
        state.qi = Math.max(0, state.queue.findIndex(t => t.id === cur.id));
      }
    }
    updateShuffleUI();
    toast(state.shuffle ? 'Перемешивание включено' : 'Перемешивание выключено');
  });
  $('#btn-repeat').addEventListener('click', () => {
    state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
    updateRepeatUI();
    toast(state.repeat === 'off' ? 'Повтор выключен' : state.repeat === 'all' ? 'Повтор очереди' : 'Повтор трека');
  });
  $('#btn-lyrics').addEventListener('click', () => showLyrics(!lyricsOpen));

  // lyrics interactions
  $('#lyrics-scroll').addEventListener('click', e => {
    const line = e.target.closest('.lrc-line');
    if (line && lyricSync && isFinite(audio.duration)) {
      const l = lyricLines[+line.dataset.i];
      if (l) audio.currentTime = l.t;
    }
  });
  const userScroll = () => { userScrollUntil = Date.now() + 3200; };
  $('#lyrics-scroll').addEventListener('pointerdown', userScroll);
  $('#lyrics-scroll').addEventListener('wheel', userScroll, { passive: true });

  // permission overlay
  $('#btn-open-perm').addEventListener('click', async () => {
    if (Native) await Native.openAllFilesSettings();
  });
  $('#btn-perm-later').addEventListener('click', () => showPerm(false));
  window.addEventListener('focus', () => {
    if (!$('#perm').classList.contains('hidden') && isNative) {
      showPerm(false);
      scanNative();
    }
  });

  // space = play/pause (desktop)
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') { e.preventDefault(); togglePlay(); }
  });
}

/* ---------- dev/test mode (browser: ?test=<dir>) ---------- */
async function initTestServer() {
  const q = new URLSearchParams(location.search).get('test');
  if (!q || isNative) return false;
  try {
    const manifest = await (await fetch(`${q}/manifest.json`)).json();
    state.tracks = manifest.tracks.map((t, i) => ({
      id: `test_${i}`, url: `${q}/${encodeURIComponent(t.file)}`, name: t.file,
      title: t.title || t.file, artist: t.artist || 'Test', album: '', dur: t.dur || 0, ext: 'wav',
    }));
    sortByDefault(state.tracks);
    for (const t of state.tracks) {
      const base = t.name.replace(/\.[^.]+$/, '').toLowerCase();
      try {
        state.lrcMap[base] = await (await fetch(`${q}/${encodeURIComponent(base)}.lrc`)).text();
      } catch (_) { /* no lyrics */ }
    }
    afterScan();
    return true;
  } catch (e) { return false; }
}

/* ---------- init ---------- */
async function init() {
  if (!isNative) document.body.classList.add('web');
  wire();
  updateShuffleUI();
  updateRepeatUI();
  updatePlayUI();
  refreshFavUI();
  renderHome();
  if (isNative) {
    scanNative();
  } else {
    // service worker — оффлайн-режим (только на http/https, не в Electron file://)
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    const testOk = await initTestServer();
    if (!testOk) await loadLibrary();
  }
}

document.addEventListener('DOMContentLoaded', init);
window.__arb = { get audio() { return audio; }, get state() { return state; } };
