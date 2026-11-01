/* ================= ArbMusic app ================= */
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ---------- state ---------- */
const state = {
  tracks: [],            // всё вместе: каталог + устройство + локальная база
  cloudTracks: [],       // общий каталог с сервера
  deviceTracks: [],      // найденные на устройстве (Android)
  localTracks: [],       // сохранённые в базу на устройстве
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
    state.deviceTracks = (res.tracks || []).map(t => ({
      id: t.path, path: t.path, title: t.title || t.name, artist: t.artist || 'Неизвестный исполнитель',
      album: t.album || '', dur: t.duration || 0, ext: t.ext || '', name: t.name || '',
    }));
    sortByDefault(state.deviceTracks);
    mergeLibrary();
  } catch (e) {
    console.error(e); toast('Ошибка сканирования');
  } finally { btn.classList.remove('spin'); }
}

function sortByDefault(arr) {
  arr.sort((a, b) => (a.artist || '').localeCompare(b.artist || '', 'ru') || (a.title || '').localeCompare(b.title || '', 'ru'));
}

/* объединяем: общий каталог (сервер) + треки устройства + локальная база */
function mergeLibrary() {
  const seen = new Set();
  const out = [];
  const push = t => { if (t && !seen.has(t.id)) { out.push(t); seen.add(t.id); } };
  (state.cloudTracks || []).forEach(push);
  (state.deviceTracks || []).forEach(push);
  (state.localTracks || []).forEach(push);
  state.tracks = out;
  sortByDefault(state.tracks);
  refreshUI();
}

function refreshUI() {
  const n = state.tracks.length;
  $('#mix-sub').textContent = n ? `случайный порядок · ${n} ${plural(n, 'трек', 'трека', 'треков')}` : 'случайный порядок · все треки';
  $('#all-count').textContent = n ? `${n} ${plural(n, 'трек', 'трека', 'треков')}` : '';
  $('#home-sub').textContent = n ? `${n} ${plural(n, 'трек', 'трека', 'треков')}` : 'твоя музыка';
  renderHome();
  if (state.view === 'list') renderListView();
  refreshFavUI();
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
    (state.localTracks || []).forEach(t => { if (t.url) URL.revokeObjectURL(t.url); });
    state.lrcMap = {};
    state.localTracks = recs.map(r => ({
      id: r.id, name: r.name, title: r.title, artist: r.artist, album: r.album || '',
      dur: r.dur || 0, ext: r.ext || '', url: URL.createObjectURL(r.blob), lrc: r.lrc || null,
      cloud: !!r.cloud, cached: true,
    }));
    for (const t of state.localTracks) {
      if (t.lrc && t.name) state.lrcMap[t.name.replace(/\.[^.]+$/, '').toLowerCase()] = t.lrc;
    }
    mergeLibrary();
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

/* ---------- общий каталог (все треки сервера — видны всем) ---------- */
const CATALOG_URL = 'https://raw.githubusercontent.com/arbuzikyt99/ArbMusicPlayer/main/catalog.json';
const MUSIC_BASE = 'https://raw.githubusercontent.com/arbuzikyt99/ArbMusicPlayer/main/music/';

async function loadCatalog() {
  let data = null;
  // свежий каталог через GitHub API (без CDN-кэша), потом raw, потом офлайн-копия
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/catalog.json`, { headers: { Accept: 'application/vnd.github+json' } });
    if (r.ok) data = b64ToJSON((await r.json()).content);
  } catch (_) { /* ignore */ }
  if (!data) {
    try {
      const r = await fetch(CATALOG_URL, { cache: 'no-cache' });
      if (r.ok) data = await r.json();
    } catch (_) { /* offline */ }
  }
  if (data) {
    try { localStorage.setItem('arbmusic.catalog', JSON.stringify(data)); } catch (_) { /* ignore */ }
  } else {
    try { data = JSON.parse(localStorage.getItem('arbmusic.catalog') || 'null'); } catch (_) { /* ignore */ }
  }
  if (!data || !Array.isArray(data.tracks)) return;
  state.cloudTracks = data.tracks.map(t => ({
    id: 'cloud_' + t.file, name: t.file, title: t.title, artist: t.artist || 'Неизвестный исполнитель', album: '',
    dur: 0, ext: (t.file.match(/\.(\w+)$/i) || [, ''])[1].toLowerCase(),
    cloud: true, lrcFile: t.lrc || null,
    url: MUSIC_BASE + encodeURIComponent(t.file),
  }));
  mergeLibrary();
}

/* скачали трек — сохранили в базу на устройстве (слушать без интернета) */
async function cacheCloudTrack(t) {
  if (!t.cloud || t.cached) return;
  t.cached = 'pending';
  try {
    const r = await fetch(t.url);
    if (!r.ok) { t.cached = false; return; }
    const blob = await r.blob();
    await idbPut({
      id: t.id, name: t.name, title: t.title, artist: t.artist, album: t.album || '',
      dur: t.dur || 0, ext: t.ext, blob, lrc: null, cloud: true,
    });
    t.cached = true;
    toast('Сохранено для оффлайна: ' + t.title);
  } catch (_) { t.cached = false; }
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
  const navMap = { home: 'home', search: 'search', list: 'favs', profile: 'profile' };
  const navKey = navMap[name] || 'home';
  $$('.hb-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === navKey));
  if (name === 'list') renderListView();
  if (name === 'search') renderSearch($('#search-input').value);
  if (name === 'profile') refreshProfile();
}

/* ================= API / аккаунты / модерация ================= */
const API_URL = 'https://arbmusic-7371.zai-ai.site';
const GH_REPO = 'arbuzikyt99/ArbMusicPlayer';
const ADMIN_LOGIN = 'arbuzikyt99';

function session() {
  try { return JSON.parse(localStorage.getItem('arbmusic.session') || 'null'); } catch (_) { return null; }
}
function setSession(s) {
  if (s) localStorage.setItem('arbmusic.session', JSON.stringify(s));
  else localStorage.removeItem('arbmusic.session');
}
async function api(path, opts = {}) {
  const s = session();
  const init = { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: {} };
  if (s && !opts.noAuth) init.headers.Authorization = 'Bearer ' + s.token;
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body != null) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  const r = await fetch(API_URL + path, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Ошибка ' + r.status);
  return d;
}

/* ---------- профиль ---------- */
function refreshProfile() {
  const s = session();
  $('#profile-out').classList.toggle('hidden', !!s);
  $('#profile-in').classList.toggle('hidden', !s);
  if (s) {
    $('#profile-name').textContent = s.name;
    $('#profile-avatar').textContent = (s.name[0] || 'A').toUpperCase();
    $('#profile-admin-badge').classList.toggle('hidden', !s.admin);
    $('#btn-admin').classList.toggle('hidden', !s.admin);
  }
}

/* ---------- модалки ---------- */
function openModal(id) { $('#' + id).classList.add('show'); }
function closeModal(id) { $('#' + id).classList.remove('show'); }

/* ---------- авторизация ---------- */
let authTab = 'login';
function wireAuth() {
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    authTab = t.dataset.tab;
    $$('.tab').forEach(x => x.classList.toggle('active', x === t));
    $('#auth-submit').textContent = authTab === 'login' ? 'Войти' : 'Создать аккаунт';
  }));
  $('#btn-open-auth').addEventListener('click', () => {
    $('#auth-err').classList.add('hidden');
    openModal('modal-auth');
  });
  $('#auth-submit').addEventListener('click', async () => {
    const err = $('#auth-err');
    err.classList.add('hidden');
    try {
      const d = await api('/api/' + (authTab === 'login' ? 'login' : 'register'), {
        body: { username: $('#auth-name').value.trim(), password: $('#auth-pass').value },
      });
      setSession({ token: d.token, name: d.name, admin: d.admin });
      closeModal('modal-auth');
      refreshProfile();
      toast(authTab === 'login' ? `С возвращением, ${d.name}!` : `Аккаунт создан, ${d.name}!`);
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove('hidden');
    }
  });
  $('#btn-logout').addEventListener('click', () => {
    setSession(null);
    refreshProfile();
    toast('Вышел из аккаунта');
  });
  $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('show'); }));
  $$('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
}

/* ---------- загрузка трека на модерацию ---------- */
let upAudio = null, upLrc = null;
function wireUpload() {
  $('#btn-upload-track').addEventListener('click', () => {
    if (!session()) { openModal('modal-auth'); return; }
    upAudio = upLrc = null;
    $('#upload-audio-name').textContent = 'Выбрать аудиофайл';
    $('#upload-lrc-name').textContent = 'Текст песни .lrc (необязательно)';
    $('#upload-audio-btn').classList.remove('filled');
    $('#upload-lrc-btn').classList.remove('filled');
    $('#upload-title').value = '';
    $('#upload-artist').value = '';
    $('#upload-err').classList.add('hidden');
    openModal('modal-upload');
  });
  $('#upload-audio-btn').addEventListener('click', () => $('#upload-audio').click());
  $('#upload-lrc-btn').addEventListener('click', () => $('#upload-lrc').click());
  $('#upload-audio').addEventListener('change', e => {
    upAudio = e.target.files[0] || null;
    if (upAudio) {
      $('#upload-audio-name').textContent = upAudio.name + ' · ' + (upAudio.size / 1048576).toFixed(1) + ' МБ';
      $('#upload-audio-btn').classList.add('filled');
      const pn = parseName(upAudio.name);
      if (!$('#upload-title').value) $('#upload-title').value = pn.title;
      if (!$('#upload-artist').value && pn.artist !== 'Неизвестный исполнитель') $('#upload-artist').value = pn.artist;
    }
  });
  $('#upload-lrc').addEventListener('change', e => {
    upLrc = e.target.files[0] || null;
    $('#upload-lrc-name').textContent = upLrc ? upLrc.name : 'Текст песни .lrc (необязательно)';
    $('#upload-lrc-btn').classList.toggle('filled', !!upLrc);
  });
  $('#upload-submit').addEventListener('click', async () => {
    const err = $('#upload-err');
    err.classList.add('hidden');
    if (!upAudio) { err.textContent = 'Выбери аудиофайл'; err.classList.remove('hidden'); return; }
    if (!session()) { err.textContent = 'Сессия истекла — войди заново'; err.classList.remove('hidden'); return; }
    const btn = $('#upload-submit');
    btn.disabled = true; btn.textContent = 'Загружаю…';
    try {
      const fd = new FormData();
      fd.append('file', upAudio, upAudio.name);
      if (upLrc) fd.append('lrc', upLrc, upLrc.name);
      fd.append('title', $('#upload-title').value.trim() || parseName(upAudio.name).title);
      fd.append('artist', $('#upload-artist').value.trim() || session().name);
      await api('/api/upload', { body: fd });
      closeModal('modal-upload');
      toast('Трек отправлен на модерацию ✅');
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove('hidden');
    }
    btn.disabled = false; btn.textContent = 'Отправить на модерацию';
  });
}

/* ---------- админ-панель ---------- */
function ghKey() { return localStorage.getItem('arbmusic.ghkey') || ''; }

function bytesToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
async function gh(path, opts = {}) {
  const r = await fetch('https://api.github.com' + path, {
    method: opts.method || 'GET',
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + ghKey() },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) throw new Error('GitHub ' + r.status + ': ' + (await r.text()).slice(0, 140));
  return r.status === 204 ? null : r.json();
}
function b64ToJSON(b64) {
  return JSON.parse(decodeURIComponent(escape(atob(b64.replace(/\n/g, '')))));
}
function jsonToB64(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj, null, 2))));
}

/* одобрить: аудио с API → коммит в репозиторий → обновление каталога → снятие с очереди */
async function approveTrack(item) {
  toast('Публикую: ' + item.title + '…');
  const fileName = `${item.artist} - ${item.title}.${item.ext}`.replace(/[\\/:*?"<>|]/g, '_').trim();
  const files = [{ path: 'music/' + fileName, content: await (await fetch(API_URL + '/audio/' + item.id)).arrayBuffer() }];
  if (item.lrc) files.push({ path: 'music/' + fileName.replace(/\.[^.]+$/, '.lrc'), content: item.lrc });

  const treeItems = [];
  for (const f of files) {
    const b = await gh(`/repos/${GH_REPO}/git/blobs`, { method: 'POST', body: { content: bytesToB64(f.content), encoding: 'base64' } });
    treeItems.push({ path: f.path, mode: '100644', type: 'blob', sha: b.sha });
  }
  const ref = await gh(`/repos/${GH_REPO}/git/ref/heads/main`);
  const commit = await gh(`/repos/${GH_REPO}/git/commits/${ref.object.sha}`);
  const baseTree = await gh(`/repos/${GH_REPO}/git/trees/${commit.tree.sha}`);
  const newTree = await gh(`/repos/${GH_REPO}/git/trees`, { method: 'POST', body: { base_tree: baseTree.sha, tree: treeItems } });
  const newCommit = await gh(`/repos/${GH_REPO}/git/commits`, { method: 'POST', body: { message: 'Add track: ' + fileName, tree: newTree.sha, parents: [ref.object.sha] } });
  await gh(`/repos/${GH_REPO}/git/refs/heads/main`, { method: 'PATCH', body: { sha: newCommit.sha, force: false } });

  let cat = { updated: new Date().toISOString(), tracks: [] };
  let catSha = null;
  try {
    const cur = await gh(`/repos/${GH_REPO}/contents/catalog.json`);
    catSha = cur.sha;
    cat = b64ToJSON(cur.content);
  } catch (_) { /* нет каталога — создадим */ }
  cat.tracks = cat.tracks || [];
  cat.tracks.push({ id: 'cloud_' + fileName, file: fileName, title: item.title, artist: item.artist, lrc: item.lrc ? fileName.replace(/\.[^.]+$/, '.lrc') : null });
  cat.updated = new Date().toISOString();
  const putBody = { message: 'catalog: + ' + fileName, content: jsonToB64(cat) };
  if (catSha) putBody.sha = catSha;
  await gh(`/repos/${GH_REPO}/contents/catalog.json`, { method: 'PUT', body: putBody });

  await api('/api/moderate', { body: { id: item.id, action: 'approve' } });
}

function adminItemHTML(t) {
  const mb = (t.size / 1048576).toFixed(1);
  return `<div class="admin-item" data-id="${esc(t.id)}">
    <div class="thumb" style="background:${gradFor({ id: t.id })}">${NOTE_SVG}</div>
    <div class="ameta"><b>${esc(t.title)}</b><span>${esc(t.artist)} · от ${esc(t.by)} · ${mb} МБ</span></div>
    <button class="abtn play" title="Послушать"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.4v13.2c0 .8.9 1.3 1.6.9l10-6.6a1.06 1.06 0 0 0 0-1.8l-10-6.6c-.7-.5-1.6 0-1.6.9z"/></svg></button>
    <button class="abtn ok" title="Одобрить"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <button class="abtn no" title="Отклонить"><svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>
  </div>`;
}

async function loadAdminQueue() {
  const box = $('#admin-queue');
  box.innerHTML = '<div class="admin-spin">Загружаю очередь…</div>';
  $('#admin-empty').classList.add('hidden');
  try {
    const d = await api('/api/queue');
    box.innerHTML = d.items.map(adminItemHTML).join('');
    $('#admin-empty').classList.toggle('hidden', d.items.length > 0);
  } catch (e) {
    box.innerHTML = `<div class="admin-spin">${esc(e.message)}</div>`;
  }
}

function wireAdmin() {
  $('#btn-admin').addEventListener('click', () => {
    const hasKey = !!ghKey();
    $('#admin-key-box').classList.toggle('hidden', hasKey);
    $('#admin-panel-box').classList.toggle('hidden', !hasKey);
    openModal('modal-admin');
    if (hasKey) loadAdminQueue();
  });
  $('#admin-key-save').addEventListener('click', async () => {
    const err = $('#admin-err');
    err.classList.add('hidden');
    const key = $('#admin-key').value.trim();
    try {
      const r = await fetch('https://api.github.com/user', { headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + key } });
      if (!r.ok) throw new Error('Токен не подошёл (' + r.status + ')');
      const u = await r.json();
      if (u.login.toLowerCase() !== ADMIN_LOGIN) throw new Error('Это токен другого аккаунта');
      localStorage.setItem('arbmusic.ghkey', key);
      $('#admin-key-box').classList.add('hidden');
      $('#admin-panel-box').classList.remove('hidden');
      loadAdminQueue();
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove('hidden');
    }
  });
  $('#admin-refresh').addEventListener('click', loadAdminQueue);
  $('#admin-queue').addEventListener('click', async e => {
    const el = e.target.closest('.admin-item');
    if (!el) return;
    const id = el.dataset.id;
    const items = (await api('/api/queue').catch(() => ({ items: [] }))).items;
    const item = items.find(i => i.id === id);
    if (!item) return;

    if (e.target.closest('.play')) {
      const t = { id: 'mod_' + id, url: API_URL + '/audio/' + id, title: item.title, artist: item.artist + ' · модерация', album: '', dur: 0, ext: item.ext };
      playList([t], 0);
      openPlayer();
      return;
    }
    if (e.target.closest('.no')) {
      if (!confirm('Отклонить трек «' + item.title + '»?')) return;
      await api('/api/moderate', { body: { id, action: 'reject' } });
      loadAdminQueue();
      toast('Трек отклонён');
      return;
    }
    if (e.target.closest('.ok')) {
      const btn = e.target.closest('.ok');
      btn.disabled = true;
      try {
        await approveTrack(item);
        toast('Опубликован в общей базе ✅');
        loadAdminQueue();
        loadCatalog();
      } catch (err) {
        toast('Ошибка: ' + err.message);
        btn.disabled = false;
      }
    }
  });
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
    if (!text && t.cloud && t.lrcFile) {
      // текст трека из общего каталога — с офлайн-копией
      const key = 'arbmusic.lrc.' + t.id;
      try {
        const saved = localStorage.getItem(key);
        if (saved) text = saved;
        else {
          const r = await fetch(MUSIC_BASE + encodeURIComponent(t.lrcFile));
          if (r.ok) {
            text = await r.text();
            try { localStorage.setItem(key, text); } catch (_) { /* ignore */ }
          }
        }
      } catch (_) { /* ignore */ }
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
audio.addEventListener('play', () => {
  updatePlayUI();
  const c = current();
  if (c && c.cloud) cacheCloudTrack(c);
});
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
  $('#btn-search').addEventListener('click', () => {
    showView('search');
    setTimeout(() => $('#search-input').focus(), 250);
  });
  // hotbar
  $$('.hb-btn').forEach(b => b.addEventListener('click', () => {
    const n = b.dataset.nav;
    if (n === 'home') showView('home');
    else if (n === 'search') { showView('search'); setTimeout(() => $('#search-input').focus(), 250); }
    else if (n === 'favs') { state.listKind = 'favs'; showView('list'); }
    else if (n === 'profile') showView('profile');
  }));
  wireAuth();
  wireUpload();
  wireAdmin();
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
    state.localTracks = manifest.tracks.map((t, i) => ({
      id: `test_${i}`, url: `${q}/${encodeURIComponent(t.file)}`, name: t.file,
      title: t.title || t.file, artist: t.artist || 'Test', album: '', dur: t.dur || 0, ext: 'wav',
    }));
    for (const t of state.localTracks) {
      const base = t.name.replace(/\.[^.]+$/, '').toLowerCase();
      try {
        state.lrcMap[base] = await (await fetch(`${q}/${encodeURIComponent(base)}.lrc`)).text();
      } catch (_) { /* no lyrics */ }
    }
    mergeLibrary();
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
  refreshProfile();
  renderHome();
  // общий каталог — на всех платформах
  loadCatalog();
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
