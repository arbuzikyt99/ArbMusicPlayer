/* ArbMusic API — аккаунты, загрузка треков, модерация.
   Чистый Node без зависимостей. Данные в $DATA_DIR (JSON-файлы). */
'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_USER = process.env.ADMIN_USER || 'arbuzikyt99';
const MAX_UPLOAD = 30 * 1024 * 1024;

fs.mkdirSync(path.join(DATA, 'pending'), { recursive: true });

/* ---------- json db ---------- */
function readJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); }
  catch (_) { return def; }
}

/* ---------- зеркалирование в GitHub (данные переживут перезапуск) ---------- */
const GH_TOKEN = process.env.GH_TOKEN || '';
const GH_MIRROR_REPO = process.env.GH_MIRROR_REPO || 'arbuzikyt99/ArbMusicPlayer';
const mirrorQueue = {};
let mirrorTimer = null;
let catCache = null;
let catCacheAt = 0;

async function ghApi(path, opts = {}) {
  const r = await fetch('https://api.github.com' + path, {
    method: opts.method || 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + GH_TOKEN,
      'User-Agent': 'arbmusic-api',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) throw new Error('GH ' + r.status + ' ' + path);
  return r.status === 204 ? null : r.json();
}

async function commitMirror(batch, message) {
  const treeItems = [];
  for (const f of batch) {
    if (f.content === null) {
      // удаление файла из зеркала
      treeItems.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const b64 = Buffer.isBuffer(f.content) ? f.content.toString('base64') : Buffer.from(f.content, 'utf8').toString('base64');
    const b = await ghApi(`/repos/${GH_MIRROR_REPO}/git/blobs`, { method: 'POST', body: { content: b64, encoding: 'base64' } });
    treeItems.push({ path: f.path, mode: '100644', type: 'blob', sha: b.sha });
  }
  const ref = await ghApi(`/repos/${GH_MIRROR_REPO}/git/ref/heads/main`);
  const commit = await ghApi(`/repos/${GH_MIRROR_REPO}/git/commits/${ref.object.sha}`);
  const baseTree = await ghApi(`/repos/${GH_MIRROR_REPO}/git/trees/${commit.tree.sha}`);
  const newTree = await ghApi(`/repos/${GH_MIRROR_REPO}/git/trees`, { method: 'POST', body: { base_tree: baseTree.sha, tree: treeItems } });
  const newCommit = await ghApi(`/repos/${GH_MIRROR_REPO}/git/commits`, { method: 'POST', body: { message, tree: newTree.sha, parents: [ref.object.sha] } });
  // возможен конфликт, если кто-то запушил параллельно — один повтор
  try {
    await ghApi(`/repos/${GH_MIRROR_REPO}/git/refs/heads/main`, { method: 'PATCH', body: { sha: newCommit.sha, force: false } });
  } catch (e) {
    const ref2 = await ghApi(`/repos/${GH_MIRROR_REPO}/git/ref/heads/main`);
    const c2 = await ghApi(`/repos/${GH_MIRROR_REPO}/git/commits/${ref2.object.sha}`);
    const t2 = await ghApi(`/repos/${GH_MIRROR_REPO}/git/trees/${c2.tree.sha}`);
    const nt2 = await ghApi(`/repos/${GH_MIRROR_REPO}/git/trees`, { method: 'POST', body: { base_tree: t2.sha, tree: treeItems } });
    const nc2 = await ghApi(`/repos/${GH_MIRROR_REPO}/git/commits`, { method: 'POST', body: { message, tree: nt2.sha, parents: [ref2.object.sha] } });
    await ghApi(`/repos/${GH_MIRROR_REPO}/git/refs/heads/main`, { method: 'PATCH', body: { sha: nc2.sha, force: false } });
  }
}

function scheduleMirror(files, message) {
  if (!GH_TOKEN) return;
  for (const f of files) mirrorQueue[f.path] = f;
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(async () => {
    const batch = Object.values(mirrorQueue);
    for (const k of Object.keys(mirrorQueue)) delete mirrorQueue[k];
    if (!batch.length) return;
    try {
      await commitMirror(batch, message || 'arbmusic server-data sync');
      console.log('mirrored', batch.length, 'files');
    } catch (e) {
      console.error('mirror failed:', e.message);
    }
  }, 3000);
}

/* публикация трека из очереди на сервере (идемпотентно — старые клиенты тоже работают) */
async function publishTrackServer(item) {
  if (!GH_TOKEN) throw new Error('Сервер не подключён к GitHub');
  const fileName = `${item.artist} - ${item.title}.${item.ext}`.replace(/[\\/:*?"<>|]/g, '_').trim();
  // уже закоммичено старым клиентом?
  let audioExists = false, coverExists = false;
  try { await ghApi(`/repos/${GH_MIRROR_REPO}/contents/music/${encodeURIComponent(fileName)}`); audioExists = true; } catch (_) {}
  const coverRel = item.coverExt ? 'covers/' + fileName.replace(/\.[^.]+$/, '') + '.' + item.coverExt : null;
  if (coverRel) {
    try { await ghApi(`/repos/${GH_MIRROR_REPO}/contents/music/${encodeURIComponent(coverRel)}`); coverExists = true; } catch (_) {}
  }
  const files = [];
  if (!audioExists) files.push({ path: 'music/' + fileName, content: fs.readFileSync(path.join(DATA, 'pending', item.id + '.' + item.ext)) });
  if (coverRel && !coverExists) files.push({ path: 'music/' + coverRel, content: fs.readFileSync(path.join(DATA, 'pending', item.id + '.cover.' + item.coverExt)) });
  if (item.lrc) files.push({ path: 'music/' + fileName.replace(/\.[^.]+$/, '.lrc'), content: item.lrc });
  if (files.length) await commitMirror(files, 'Add track: ' + fileName);

  // каталог — добавить запись, если её нет
  let cat = { updated: new Date().toISOString(), tracks: [] };
  let catSha = null;
  try {
    const cur = await ghApi(`/repos/${GH_MIRROR_REPO}/contents/catalog.json`);
    catSha = cur.sha;
    cat = JSON.parse(Buffer.from(cur.content, 'base64').toString('utf8'));
  } catch (_) { /* нет каталога — создадим */ }
  cat.tracks = cat.tracks || [];
  if (!cat.tracks.some(t => t.id === 'cloud_' + fileName)) {
    cat.tracks.push({
      id: 'cloud_' + fileName, file: fileName, title: item.title, artist: item.artist,
      by: item.by || null,
      lrc: item.lrc ? fileName.replace(/\.[^.]+$/, '.lrc') : null,
      cover: coverRel,
    });
    cat.updated = new Date().toISOString();
    const putBody = { message: 'catalog: + ' + fileName, content: Buffer.from(JSON.stringify(cat, null, 2)).toString('base64') };
    if (catSha) putBody.sha = catSha;
    await ghApi(`/repos/${GH_MIRROR_REPO}/contents/catalog.json`, { method: 'PUT', body: putBody });
  }

  // снять с очереди + почистить
  const q = queue();
  const idx = q.items.findIndex(i => i.id === item.id);
  if (idx !== -1) {
    q.items.splice(idx, 1);
    writeJSON('queue.json', q);
  }
  try {
    for (const f of fs.readdirSync(path.join(DATA, 'pending'))) {
      if (f.startsWith(item.id + '.')) fs.unlinkSync(path.join(DATA, 'pending', f));
    }
  } catch (_) {}
  try {
    const del = [{ path: 'server-data/pending/' + item.id + '.' + item.ext, content: null }];
    if (item.coverExt) del.push({ path: 'server-data/pending/' + item.id + '.cover.' + item.coverExt, content: null });
    await commitMirror(del, 'server-data: published ' + item.id);
  } catch (_) { /* не критично */ }
  return fileName;
}

function writeJSON(file, obj) {
  const p = path.join(DATA, file);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, p);
  scheduleMirror([{ path: 'server-data/' + file, content: JSON.stringify(obj) }], 'server-data: ' + file);
}

/* восстановление данных из зеркала при старте */
async function restoreFromMirror() {
  if (!GH_TOKEN) { console.log('mirror: GH_TOKEN не задан — зеркалирование выключено'); return; }
  try {
    const ref = await ghApi(`/repos/${GH_MIRROR_REPO}/git/ref/heads/main`);
    const commit = await ghApi(`/repos/${GH_MIRROR_REPO}/git/commits/${ref.object.sha}`);
    const tree = await ghApi(`/repos/${GH_MIRROR_REPO}/git/trees/${commit.tree.sha}?recursive=1`);
    const entries = (tree.tree || []).filter(t => t.path.startsWith('server-data/') && t.type === 'blob');
    if (!entries.length) { console.log('mirror: пусто, стартуем с чистой базы'); return; }
    for (const e of entries) {
      const blob = await ghApi(`/repos/${GH_MIRROR_REPO}/git/blobs/${e.sha}`);
      const buf = Buffer.from(blob.content, 'base64');
      const rel = e.path.slice('server-data/'.length);
      const dest = path.join(DATA, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
    }
    console.log('mirror: восстановлено', entries.length, 'файлов');
  } catch (e) {
    console.error('mirror restore failed:', e.message);
  }
}
const users = () => readJSON('users.json', {});
const queue = () => readJSON('queue.json', { items: [] });

/* ---------- auth ---------- */
const b64u = b => Buffer.from(b).toString('base64url');
/* токен подписывается личным ключом пользователя (его хэшем) —
   сессия живёт, пока существует аккаунт в зеркале */
function makeToken(name, admin, key) {
  const payload = b64u(JSON.stringify({ n: name, a: !!admin, exp: Date.now() + 365 * 864e5 }));
  const sig = crypto.createHmac('sha256', key).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function checkToken(tok) {
  if (!tok || typeof tok !== 'string' || !tok.includes('.')) return null;
  const [payload, sig] = tok.split('.');
  let d;
  try {
    d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
  const db = users();
  const u = db[String(d.n || '').toLowerCase()];
  if (!u) return null;
  const want = crypto.createHmac('sha256', u.hash).update(payload).digest('base64url');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  if (d.exp < Date.now()) return null;
  return { name: u.name, admin: u.name.toLowerCase() === ADMIN_USER.toLowerCase() };
}
function hashPass(pass, salt) {
  return crypto.pbkdf2Sync(pass, salt, 120000, 32, 'sha256').toString('hex');
}

/* ---------- helpers ---------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((res, rej) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { rej(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}
/* минимальный multipart-парсер */
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw new Error('no boundary');
  const boundary = '--' + (m[1] || m[2]).trim();
  const bBound = Buffer.from(boundary);
  const parts = {};
  let pos = buf.indexOf(bBound);
  while (pos !== -1) {
    const start = pos + bBound.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    const headEnd = buf.indexOf('\r\n\r\n', start);
    if (headEnd === -1) break;
    const head = buf.slice(start + 2, headEnd).toString('utf8');
    const next = buf.indexOf(bBound, headEnd + 4);
    const body = buf.slice(headEnd + 4, next === -1 ? buf.length : next - 2); // -2: \r\n
    const nameM = /name="([^"]*)"/i.exec(head);
    const fileM = /filename="([^"]*)"/i.exec(head);
    if (nameM) parts[nameM[1]] = fileM ? { filename: fileM[1], data: body } : body.toString('utf8');
    pos = next;
  }
  return parts;
}
const BAD_NAME = /[^a-zA-Z0-9_а-яА-ЯёЁ\-. ]/g;
function safeName(s) {
  return String(s || '').replace(BAD_NAME, '_').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method === 'OPTIONS') return json(res, 204, {});

  try {
    /* --- каталог для приложения (без лимитов GitHub) --- */
    if (p === '/api/catalog' && req.method === 'GET') {
      let data = null;
      if (GH_TOKEN && Date.now() - catCacheAt > 30000) {
        try {
          const cur = await ghApi(`/repos/${GH_MIRROR_REPO}/contents/catalog.json`);
          data = JSON.parse(Buffer.from(cur.content, 'base64').toString('utf8'));
          catCache = data;
          catCacheAt = Date.now();
        } catch (_) { /* упадём на fallback ниже */ }
      } else if (catCache) {
        data = catCache;
      }
      if (!data) return json(res, 502, { error: 'catalog unavailable' });
      return json(res, 200, data);
    }

    /* --- интерфейс приложения (надёжный хостинг без лимитов) --- */
    if (p === '/app' || p.startsWith('/app/') || p === '/' || p === '/index.html' || p === '/sw.js' ||
        p.startsWith('/css/') || p.startsWith('/js/') || p.startsWith('/icon-') || p === '/manifest.webmanifest') {
      const WWW = path.join(__dirname, 'www');
      let rel;
      if (p === '/app' || p === '/app/') rel = 'index.html';
      else if (p.startsWith('/app/')) rel = decodeURIComponent(p.slice('/app/'.length));
      else if (p === '/sw.js') rel = 'sw.js';
      else if (p === '/' || p === '/index.html') rel = 'index.html';
      else rel = p.slice(1);
      let file = path.join(WWW, rel);
      if (!file.startsWith(WWW)) { res.writeHead(403); return res.end(); }
      const serve = (f) => {
        const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
        const data = fs.readFileSync(f);
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
          'Content-Length': data.length,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(data);
      };
      try {
        if (fs.existsSync(file) && fs.statSync(file).isFile()) return serve(file);
        // SPA: неизвестный путь → index.html
        return serve(path.join(WWW, 'index.html'));
      } catch (_) {
        return json(res, 404, { error: 'not found' });
      }
    }

    /* health */
    if (p === '/' || p === '/api/health') return json(res, 200, { ok: true, service: 'arbmusic-api', time: Date.now() });

    /* --- регистрация / вход --- */
    if (p === '/api/register' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 1e6)).toString('utf8') || '{}');
      const name = safeName(body.username);
      const pass = String(body.password || '');
      if (name.length < 3) return json(res, 400, { error: 'Имя: минимум 3 символа' });
      if (pass.length < 4) return json(res, 400, { error: 'Пароль: минимум 4 символа' });
      const db = users();
      if (db[name.toLowerCase()]) return json(res, 400, { error: 'Это имя уже занято' });
      const salt = crypto.randomBytes(16).toString('hex');
      db[name.toLowerCase()] = { name, salt, hash: hashPass(pass, salt), created: Date.now() };
      writeJSON('users.json', db);
      const admin = name.toLowerCase() === ADMIN_USER.toLowerCase();
      return json(res, 200, { ok: true, token: makeToken(name, admin, db[key].hash), name, admin });
    }

    if (p === '/api/login' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 1e6)).toString('utf8') || '{}');
      const db = users();
      const u = db[String(body.username || '').toLowerCase()];
      if (!u) return json(res, 401, { error: 'Неверное имя или пароль' });
      if (hashPass(String(body.password || ''), u.salt) !== u.hash) {
        return json(res, 401, { error: 'Неверное имя или пароль' });
      }
      const admin = String(u.name).toLowerCase() === ADMIN_USER.toLowerCase();
      return json(res, 200, { ok: true, token: makeToken(u.name, admin, u.hash), name: u.name, admin });
    }

    /* --- кто я --- */
    if (p === '/api/me') {
      const me = checkToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      if (!me) return json(res, 200, { authorized: false });
      return json(res, 200, { authorized: true, name: me.name, admin: me.admin });
    }

    /* --- загрузка трека на модерацию --- */
    if (p === '/api/upload' && req.method === 'POST') {
      const me = checkToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      if (!me) return json(res, 401, { error: 'Войди, чтобы загрузить трек' });
      const buf = await readBody(req, MAX_UPLOAD);
      const parts = parseMultipart(buf, req.headers['content-type']);
      const file = parts.file;
      if (!file || !file.data || !file.data.length) return json(res, 400, { error: 'Файл не выбран' });
      const ext = (file.filename.match(/\.(\w+)$/i) || [, 'bin'])[1].toLowerCase();
      if (!['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma'].includes(ext)) {
        return json(res, 400, { error: 'Это не аудиофайл' });
      }
      // обложка (необязательно)
      let coverExt = null;
      const cover = parts.cover;
      if (cover && cover.data && cover.data.length) {
        coverExt = (cover.filename.match(/\.(\w+)$/i) || [, ''])[1].toLowerCase();
        if (!['jpg', 'jpeg', 'png', 'webp'].includes(coverExt)) {
          return json(res, 400, { error: 'Обложка: только jpg/png/webp' });
        }
        if (cover.data.length > 8 * 1024 * 1024) {
          return json(res, 400, { error: 'Обложка больше 8 МБ' });
        }
      }
      const id = crypto.randomBytes(8).toString('hex');
      const mirrorFiles = [];
      fs.writeFileSync(path.join(DATA, 'pending', id + '.' + ext), file.data);
      mirrorFiles.push({ path: 'server-data/pending/' + id + '.' + ext, content: file.data });
      if (coverExt) {
        fs.writeFileSync(path.join(DATA, 'pending', id + '.cover.' + coverExt), cover.data);
        mirrorFiles.push({ path: 'server-data/pending/' + id + '.cover.' + coverExt, content: cover.data });
      }
      let lrc = null;
      if (parts.lrc && parts.lrc.data && parts.lrc.data.length) {
        lrc = parts.lrc.data.toString('utf8').slice(0, 200000);
      }
      const q = queue();
      q.items.unshift({
        id, ext, coverExt, by: me.name, at: Date.now(),
        title: safeName(parts.title) || 'Без названия',
        artist: safeName(parts.artist) || me.name,
        size: file.data.length, lrc,
      });
      writeJSON('queue.json', q);
      scheduleMirror(mirrorFiles, 'server-data: upload ' + id);
      return json(res, 200, { ok: true, id });
    }

    /* --- просмотр файла на модерации (для прослушивания админом) --- */
    if (p.startsWith('/audio/') && req.method === 'GET') {
      const rest = p.slice(7);
      const slash = rest.indexOf('/');
      const id = (slash === -1 ? rest : rest.slice(0, slash)).replace(/[^a-f0-9]/g, '').slice(0, 16);
      const q = queue();
      const item = q.items.find(i => i.id === id);
      if (!item) return json(res, 404, { error: 'not found' });
      const isCover = slash !== -1 && rest.slice(slash + 1) === 'cover';
      const file = isCover
        ? path.join(DATA, 'pending', id + '.cover.' + item.coverExt)
        : path.join(DATA, 'pending', id + '.' + item.ext);
      if (!fs.existsSync(file)) return json(res, 404, { error: 'not found' });
      const data = fs.readFileSync(file);
      const mime = isCover
        ? (item.coverExt === 'png' ? 'image/png' : item.coverExt === 'webp' ? 'image/webp' : 'image/jpeg')
        : 'audio/' + (item.ext === 'ogg' ? 'ogg' : item.ext);
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': data.length,
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'none',
      });
      return res.end(data);
    }

    /* --- админ: публикация трека (коммит в репозиторий делает сервер) --- */
    if (p === '/api/publish' && req.method === 'POST') {
      const me = checkToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      if (!me || !me.admin) return json(res, 403, { error: 'Только для админа' });
      const body = JSON.parse((await readBody(req, 1e6)).toString('utf8') || '{}');
      const q = queue();
      const idx = q.items.findIndex(i => i.id === body.id);
      if (idx === -1) return json(res, 404, { error: 'Трек не найден в очереди' });
      try {
        const fileName = await publishTrackServer(q.items[idx]);
        return json(res, 200, { ok: true, published: fileName });
      } catch (e) {
        return json(res, 500, { error: 'Публикация не удалась: ' + e.message });
      }
    }

    /* --- админ и автор: удалить трек из общей базы --- */
    if (p === '/api/delete-track' && req.method === 'POST') {
      const me = checkToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      if (!me) return json(res, 401, { error: 'Войди в аккаунт' });
      if (!GH_TOKEN) return json(res, 500, { error: 'Сервер не подключён к GitHub' });
      const body = JSON.parse((await readBody(req, 1e6)).toString('utf8') || '{}');
      const id = String(body.id || '');
      if (!id.startsWith('cloud_')) return json(res, 400, { error: 'Можно удалять только треки общей базы' });
      const fileName = id.slice('cloud_'.length);
      let cat = { tracks: [] }, catSha = null;
      try {
        const cur = await ghApi(`/repos/${GH_MIRROR_REPO}/contents/catalog.json`);
        catSha = cur.sha;
        cat = JSON.parse(Buffer.from(cur.content, 'base64').toString('utf8'));
      } catch (_) {
        return json(res, 404, { error: 'Каталог недоступен' });
      }
      const entry = (cat.tracks || []).find(t => t.id === id || t.file === fileName);
      if (!entry) return json(res, 404, { error: 'Трек не найден в каталоге' });
      // удалять может админ ИЛИ автор трека
      const isOwner = !!(entry.by && me.name && entry.by.toLowerCase() === me.name.toLowerCase());
      if (!me.admin && !isOwner) {
        return json(res, 403, { error: 'Удалять может только админ или автор трека' });
      }
      // удаляем файлы из репозитория (аудио, обложку, текст)
      for (const rel of [entry.file, entry.cover, entry.lrc].filter(Boolean)) {
        try {
          const cur = await ghApi(`/repos/${GH_MIRROR_REPO}/contents/music/${encodeURIComponent(rel)}`);
          await ghApi(`/repos/${GH_MIRROR_REPO}/contents/music/${encodeURIComponent(rel)}`, {
            method: 'DELETE',
            body: { message: 'Remove track: ' + rel, sha: cur.sha },
          });
        } catch (_) { /* файла может не быть — не критично */ }
      }
      // обновляем каталог
      cat.tracks = cat.tracks.filter(t => t.id !== id);
      cat.updated = new Date().toISOString();
      const putBody = { message: 'catalog: - ' + fileName, content: Buffer.from(JSON.stringify(cat, null, 2)).toString('base64') };
      if (catSha) putBody.sha = catSha;
      await ghApi(`/repos/${GH_MIRROR_REPO}/contents/catalog.json`, { method: 'PUT', body: putBody });
      return json(res, 200, { ok: true, deleted: fileName });
    }

    /* --- админ: очередь --- */
    if (p === '/api/queue' && req.method === 'GET') {
      const me = checkToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      if (!me || !me.admin) return json(res, 403, { error: 'Только для админа' });
      return json(res, 200, { items: queue().items });
    }

    /* --- админ: одобрить/отклонить --- */
    if (p === '/api/moderate' && req.method === 'POST') {
      const me = checkToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      if (!me || !me.admin) return json(res, 403, { error: 'Только для админа' });
      const body = JSON.parse((await readBody(req, 1e6)).toString('utf8') || '{}');
      const q = queue();
      const idx = q.items.findIndex(i => i.id === body.id);
      if (idx === -1) return json(res, 404, { error: 'Трек не найден в очереди' });
      const item = q.items[idx];
      const removeFiles = () => {
        try {
          for (const f of fs.readdirSync(path.join(DATA, 'pending'))) {
            if (f.startsWith(item.id + '.')) fs.unlinkSync(path.join(DATA, 'pending', f));
          }
        } catch (_) {}
      };
      if (body.action === 'reject') {
        q.items.splice(idx, 1);
        writeJSON('queue.json', q);
        removeFiles();
        return json(res, 200, { ok: true, action: 'reject' });
      }
      if (body.action === 'approve') {
        // сервер публикует сам (идемпотентно — совместимо со старыми клиентами,
        // которые уже закоммитили файлы со своего устройства)
        if (GH_TOKEN) {
          try {
            const published = await publishTrackServer(item);
            return json(res, 200, { ok: true, action: 'approve', published });
          } catch (e) {
            return json(res, 500, { error: 'Публикация не удалась: ' + e.message + ' — трек остался в очереди' });
          }
        }
        q.items.splice(idx, 1);
        writeJSON('queue.json', q);
        removeFiles(item.id);
        return json(res, 200, { ok: true, action: 'approve' });
      }
      return json(res, 400, { error: 'bad action' });
    }

    return json(res, 404, { error: 'unknown' });
  } catch (e) {
    return json(res, 500, { error: e.message || 'server error' });
  }
});

/* старт: сначала восстанавливаем данные из зеркала, потом слушаем */
(async () => {
  await restoreFromMirror();
  // админ-аккаунт всегда существует, даже после перезапуска
  const ADMIN_PASS = process.env.ADMIN_PASS || '';
  if (ADMIN_PASS) {
    const db = users();
    const key = ADMIN_USER.toLowerCase();
    if (!db[key]) {
      const salt = crypto.randomBytes(16).toString('hex');
      db[key] = { name: ADMIN_USER, salt, hash: hashPass(ADMIN_PASS, salt), created: Date.now() };
      writeJSON('users.json', db);
      console.log('admin account restored:', ADMIN_USER);
    }
  }
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`arbmusic-api on 0.0.0.0:${PORT}, data: ${DATA}`);
  });
})();
