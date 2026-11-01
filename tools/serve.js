/* Tiny static file server with HTTP Range support (for local UI testing) */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8765;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.json': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.lrc': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/www/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }

  fs.stat(file, (err, stat) => {
    if (err || (!stat.isFile() && !(stat.isDirectory() && !p.endsWith('/')))) {
      res.writeHead(404); res.end('not found'); return;
    }
    if (stat.isDirectory()) {
      // отдаём index.html из папки
      const idx = path.join(file, 'index.html');
      fs.readFile(idx, (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(d2);
      });
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (isNaN(start) || start > end || end >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Length': stat.size,
      });
      fs.createReadStream(file).pipe(res);
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`http://127.0.0.1:${PORT}/www/index.html?test=../test-music`));
