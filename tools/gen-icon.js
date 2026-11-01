/* ArbMusic icon generator — pure Node, no deps.
   Renders master 1024px RGBA canvas, downscales to targets, encodes PNG (zlib). */
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

/* ---------- png encode ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- drawing ---------- */
const S = 1024;
const px = new Float64Array(S * S * 4);

function mix(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function put(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const d = px[i + 3] / 255;
  // src-over
  px[i] = r * a + px[i] * (1 - a);
  px[i + 1] = g * a + px[i + 1] * (1 - a);
  px[i + 2] = b * a + px[i + 2] * (1 - a);
  px[i + 3] = (a + px[i + 3] / 255 * (1 - a)) * 255;
}

/* full-bleed icon: rounded dark square with glows + waveform */
function drawFull() {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      // rounded rect coverage
      const R = S * 0.225;
      let cov = 1;
      const cx = x + 0.5, cy = y + 0.5;
      const inCorner =
        (cx < R && cy < R) ? [R, R] :
        (cx > S - R && cy < R) ? [S - R, R] :
        (cx < R && cy > S - R) ? [R, S - R] :
        (cx > S - R && cy > S - R) ? [S - R, S - R] : null;
      if (inCorner) {
        const dx = cx - inCorner[0], dy = cy - inCorner[1];
        const d = Math.sqrt(dx * dx + dy * dy);
        cov = clamp(R - d + 0.5, 0, 1);
      }
      // base: dark gradient
      let r = mix(13, 10, y / S), g = mix(13, 10, y / S), b = mix(22, 17, y / S);
      // purple glow top-left
      {
        const dx = cx - S * 0.22, dy = cy - S * 0.18;
        const e = Math.exp(-(dx * dx + dy * dy) / (2 * (S * 0.38) ** 2));
        r += 139 * e * 0.55; g += 92 * e * 0.55; b += 246 * e * 0.55;
      }
      // pink glow bottom-right
      {
        const dx = cx - S * 0.8, dy = cy - S * 0.85;
        const e = Math.exp(-(dx * dx + dy * dy) / (2 * (S * 0.34) ** 2));
        r += 236 * e * 0.4; g += 72 * e * 0.4; b += 153 * e * 0.4;
      }
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = cov * 255;
    }
  }
  drawBars(1.0, true);
}

/* adaptive foreground: transparent, bars in safe zone */
function drawForeground() {
  drawBars(0.62, false);
}

/* waveform bars: 5 capsule bars, heights symmetric */
function drawBars(scale, glow) {
  const heights = [0.34, 0.62, 0.95, 0.62, 0.34];
  const n = heights.length;
  const bw = S * 0.075 * scale;          // bar half width
  const gap = S * 0.045 * scale;         // gap between centers beyond width
  const step = bw * 2 + gap;
  const total = step * (n - 1);
  const x0 = S / 2 - total / 2;
  const maxH = S * 0.42 * scale;         // max bar height
  for (let i = 0; i < n; i++) {
    const cx = x0 + i * step;
    const h = maxH * heights[i];
    const cy = S / 2;
    const top = cy - h / 2, bot = cy + h / 2;
    // gradient tint across bars: purple -> pink
    const t = i / (n - 1);
    const cr = mix(196, 255, t), cg = mix(181, 255, t), cb = mix(253, 255, t);
    const xLo = Math.floor(cx - bw - 2), xHi = Math.ceil(cx + bw + 2);
    const yLo = Math.floor(top - bw - 2), yHi = Math.ceil(bot + bw + 2);
    for (let y = Math.max(0, yLo); y <= Math.min(S - 1, yHi); y++) {
      for (let x = Math.max(0, xLo); x <= Math.min(S - 1, xHi); x++) {
        const cxp = x + 0.5, cyp = y + 0.5;
        // capsule SDF
        const inY = clamp(cyp, top + bw, bot - bw);
        const dx = cxp - cx;
        let dy;
        if (cyp < top + bw) dy = cyp - (top + bw);
        else if (cyp > bot - bw) dy = cyp - (bot - bw);
        else dy = 0;
        const d = Math.sqrt(dx * dx + dy * dy) - bw;
        let a = clamp(0.5 - d, 0, 1);
        if (a > 0) put(x, y, cr, cg, cb, a);
      }
    }
  }
  if (glow) {
    // soft white glow behind bars
    const cx = S / 2, cy = S / 2;
    for (let y = 0; y < S; y += 1) {
      for (let x = 0; x < S; x += 1) {
        const dx = (x - cx), dy = (y - cy);
        const e = Math.exp(-(dx * dx + dy * dy) / (2 * (S * 0.30) ** 2));
        if (e > 0.05) {
          const i = (y * S + x) * 4;
          px[i] = mix(px[i], 255, e * 0.10);
          px[i + 1] = mix(px[i + 1], 255, e * 0.10);
          px[i + 2] = mix(px[i + 2], 255, e * 0.10);
        }
      }
    }
  }
}

/* ---------- downscale (box filter) ---------- */
function downscale(src, srcW, dstW) {
  const out = Buffer.alloc(dstW * dstW * 4);
  const f = srcW / dstW;
  for (let y = 0; y < dstW; y++) {
    for (let x = 0; x < dstW; x++) {
      let r = 0, g = 0, b = 0, a = 0, cnt = 0;
      const x0 = Math.floor(x * f), x1 = Math.min(srcW, Math.ceil((x + 1) * f));
      const y0 = Math.floor(y * f), y1 = Math.min(srcW, Math.ceil((y + 1) * f));
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * srcW + xx) * 4;
          const al = src[i + 3] / 255;
          r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al;
          cnt++;
        }
      }
      const o = (y * dstW + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a);
        out[o + 3] = Math.round(a / cnt * 255);
      }
    }
  }
  return out;
}

function toBuf(size) {
  const scaled = downscale(px, S, size);
  return encodePNG(size, size, scaled);
}

/* ---------- main ---------- */
function main() {
  const root = path.resolve(__dirname, '..');
  const targets = [
    ['android/app/src/main/res/mipmap-mdpi/ic_launcher.png', 48],
    ['android/app/src/main/res/mipmap-hdpi/ic_launcher.png', 72],
    ['android/app/src/main/res/mipmap-xhdpi/ic_launcher.png', 96],
    ['android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png', 144],
    ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 192],
    ['ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024],
    ['www/icon-192.png', 192],
    ['www/icon-512.png', 512],
  ];
  drawFull();
  for (const [rel, size] of targets) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, toBuf(size));
    console.log('wrote', rel, size);
  }
  // adaptive foreground (transparent bg)
  px.fill(0);
  drawForeground();
  const fg = [
    ['android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png', 108],
    ['android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png', 162],
    ['android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png', 216],
    ['android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png', 324],
    ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png', 432],
  ];
  for (const [rel, size] of fg) {
    const p = path.join(root, rel);
    fs.writeFileSync(p, toBuf(size));
    console.log('wrote', rel, size);
  }
}
main();
