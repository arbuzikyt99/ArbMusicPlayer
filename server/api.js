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
function writeJSON(file, obj) {
  const p = path.join(DATA, file);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, p);
}
const users = () => readJSON('users.json', {});
const queue = () => readJSON('queue.json', { items: [] });

/* ---------- auth ---------- */
let SECRET = null;
function secret() {
  if (!SECRET) {
    try { SECRET = fs.readFileSync(path.join(DATA, 'secret'), 'utf8').trim(); } catch (_) {}
    if (!SECRET) {
      SECRET = crypto.randomBytes(32).toString('hex');
      try { fs.writeFileSync(path.join(DATA, 'secret'), SECRET); } catch (_) {}
    }
  }
  return SECRET;
}
const b64u = b => Buffer.from(b).toString('base64url');
function makeToken(name, admin) {
  const payload = b64u(JSON.stringify({ n: name, a: !!admin, exp: Date.now() + 90 * 864e5 }));
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function checkToken(tok) {
  if (!tok || typeof tok !== 'string' || !tok.includes('.')) return null;
  const [payload, sig] = tok.split('.');
  const want = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (d.exp < Date.now()) return null;
    return { name: d.n, admin: !!d.a };
  } catch (_) { return null; }
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
      return json(res, 200, { ok: true, token: makeToken(name, admin), name, admin });
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
      return json(res, 200, { ok: true, token: makeToken(u.name, admin), name: u.name, admin });
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
      const id = crypto.randomBytes(8).toString('hex');
      fs.writeFileSync(path.join(DATA, 'pending', id + '.' + ext), file.data);
      let lrc = null;
      if (parts.lrc && parts.lrc.data && parts.lrc.data.length) {
        lrc = parts.lrc.data.toString('utf8').slice(0, 200000);
      }
      const q = queue();
      q.items.unshift({
        id, ext, by: me.name, at: Date.now(),
        title: safeName(parts.title) || 'Без названия',
        artist: safeName(parts.artist) || me.name,
        size: file.data.length, lrc,
      });
      writeJSON('queue.json', q);
      return json(res, 200, { ok: true, id });
    }

    /* --- просмотр файла на модерации (для прослушивания админом) --- */
    if (p.startsWith('/audio/') && req.method === 'GET') {
      const id = p.slice(7).replace(/[^a-f0-9]/g, '').slice(0, 16);
      const q = queue();
      const item = q.items.find(i => i.id === id);
      if (!item) return json(res, 404, { error: 'not found' });
      const file = path.join(DATA, 'pending', id + '.' + item.ext);
      if (!fs.existsSync(file)) return json(res, 404, { error: 'not found' });
      const data = fs.readFileSync(file);
      res.writeHead(200, {
        'Content-Type': 'audio/' + (item.ext === 'ogg' ? 'ogg' : item.ext),
        'Content-Length': data.length,
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'none',
      });
      return res.end(data);
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
      if (body.action === 'reject') {
        q.items.splice(idx, 1);
        writeJSON('queue.json', q);
        try { fs.unlinkSync(path.join(DATA, 'pending', item.id + '.' + item.ext)); } catch (_) {}
        return json(res, 200, { ok: true, action: 'reject' });
      }
      if (body.action === 'approve') {
        // клиент уже закоммитил файл в репозиторий и обновил каталог
        q.items.splice(idx, 1);
        writeJSON('queue.json', q);
        try { fs.unlinkSync(path.join(DATA, 'pending', item.id + '.' + item.ext)); } catch (_) {}
        return json(res, 200, { ok: true, action: 'approve' });
      }
      return json(res, 400, { error: 'bad action' });
    }

    return json(res, 404, { error: 'unknown' });
  } catch (e) {
    return json(res, 500, { error: e.message || 'server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`arbmusic-api on 0.0.0.0:${PORT}, data: ${DATA}`));
