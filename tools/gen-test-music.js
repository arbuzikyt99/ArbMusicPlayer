/* Generates 4 test WAV tracks + .lrc + manifest.json into ../test-music */
'use strict';
const fs = require('fs');
const path = require('path');

const SR = 44100;
const OUT = path.resolve(__dirname, '..', 'test-music');
fs.mkdirSync(OUT, { recursive: true });

const N = { C: 261.63, D: 293.66, E: 329.63, F: 349.23, G: 392.0, A: 440.0, B: 493.88 };
const N2 = o => ({ C: N.C * 2 * o, D: N.D * 2 * o, E: N.E * 2 * o, F: N.F * 2 * o, G: N.G * 2 * o, A: N.A * 2 * o, B: N.B * 2 * o });

function synth(dur, f) {
  const n = Math.floor(SR * dur);
  const data = new Float64Array(n);
  for (let i = 0; i < n; i++) data[i] = f(i / SR, i);
  // normalize + fades
  let max = 1e-9;
  for (const v of data) max = Math.max(max, Math.abs(v));
  const fade = Math.floor(SR * 1.5);
  for (let i = 0; i < n; i++) {
    let g = 0.85 / max;
    if (i < fade) g *= i / fade;
    if (i > n - fade) g *= (n - i) / fade;
    data[i] *= g;
  }
  return data;
}

const seq = (bpm, notes, wave) => synth(notes.length * 60 / bpm * 2, (t) => {
  const beat = 60 / bpm;
  const idx = Math.floor(t / beat) % notes.length;
  const tt = t % beat;
  const freq = notes[idx];
  if (!freq) return 0;
  const env = Math.exp(-tt * (wave === 'pluck' ? 6 : 2.2));
  const v = wave === 'pluck'
    ? Math.sin(2 * Math.PI * freq * tt) * env + 0.4 * Math.sin(4 * Math.PI * freq * tt) * env
    : 0.6 * Math.sin(2 * Math.PI * freq * tt) + 0.25 * Math.sin(6 * Math.PI * freq * tt) * env;
  // soft bass layer
  return v * 0.9 + 0.3 * Math.sin(2 * Math.PI * freq / 2 * t) * Math.exp(-tt * 1.5);
});

const tracks = [
  { file: 'ArbDJ - Neon Drift.wav', title: 'Ночной город', artist: 'ArbDJ', dur: 26,
    gen: () => seq(112, [N2(1).A, null, N2(1).C * 2, N2(1).E, N2(1).A, N2(1).G, N2(1).E, null], 'pluck') },
  { file: 'ArbDJ - Rain Chords.wav', title: 'Дождь за окном', artist: 'ArbDJ', dur: 24,
    gen: () => seq(84, [N.F * 2, N.A, N.C * 2, N.E * 2, N.D, N.F, N.A, N.C * 2], 'pad') },
  { file: 'ArbDJ - Sky Line.wav', title: 'Полёт', artist: 'SynthArb', dur: 25,
    gen: () => seq(128, [N2(1).E, N2(1).G, N2(1).B, N2(2).D, N2(1).D, N2(1).F, N2(1).A, N2(2).C], 'pluck') },
  { file: 'ArbDJ - Deep Bass.wav', title: 'Глубина', artist: 'SynthArb', dur: 22,
    gen: () => seq(96, [N.C / 2, N.C / 2, N.G / 2, N.C, N.D / 2, N.D / 2, N.A / 2, N.D], 'pad') },
];

function writeWav(file, data) {
  const n = data.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, data[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path.join(OUT, file), buf);
}

const manifest = { tracks: [] };
const lrc1 = `[00:01.0]Неон горит на мокрых улицах
[00:05.0]Огни плывут в темноте
[00:09.5]Этот город не спит до утра
[00:14.0]И музыка зовёт с собой
[00:18.5]Мы едем сквозь ночной город
[00:22.5]Свет фар как реки в ночи`;
const lrc2 = `[00:02.0]Капли стучат по стеклу
[00:07.0]Тёплый свет настольной лампы
[00:12.0]Дождь за окном усыпает
[00:17.0]Всё, что волновало, — пройдёт`;

tracks.forEach((t, i) => {
  writeWav(t.file, t.gen());
  manifest.tracks.push({ file: t.file, title: t.title, artist: t.artist, dur: t.dur });
  if (i === 0) fs.writeFileSync(path.join(OUT, 'ArbDJ - Neon Drift.lrc'), lrc1, 'utf8');
  if (i === 1) fs.writeFileSync(path.join(OUT, 'ArbDJ - Rain Chords.lrc'), lrc2, 'utf8');
  console.log('wrote', t.file);
});
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('done ->', OUT);
