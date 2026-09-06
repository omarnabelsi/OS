#!/usr/bin/env node
/**
 * Generate the placeholder app icon (src-tauri/icons/source.png, 1024x1024) with zero
 * dependencies - a minimal PNG encoder on top of node:zlib. Then run `npm run icons` to let the
 * Tauri CLI derive every platform size from it. Replace source.png with real art later.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'src-tauri', 'icons', 'source.png');
const SIZE = 1024;

const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Pixel art: dark rounded square, aurora gradient ring, bright "A" chevron.
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
const cx = SIZE / 2;
const cy = SIZE / 2;
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter none
  for (let x = 0; x < SIZE; x++) {
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy);
    // rounded square mask
    const half = SIZE * 0.46;
    const rad = SIZE * 0.2;
    const qx = Math.max(Math.abs(dx) - (half - rad), 0);
    const qy = Math.max(Math.abs(dy) - (half - rad), 0);
    const inside = Math.hypot(qx, qy) <= rad;
    if (!inside) {
      raw[o + 3] = 0;
      continue;
    }
    let R = 7,
      G = 8,
      B = 12;
    // aurora ring
    const ring = Math.abs(r - SIZE * 0.3);
    if (ring < SIZE * 0.045) {
      const t = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI);
      const k = 1 - ring / (SIZE * 0.045);
      R = Math.round(R + k * (110 + 100 * Math.sin(t * 6.283)));
      G = Math.round(G + k * (231 - 60 * t));
      B = Math.round(B + k * 255);
    }
    // chevron "A"
    const ax = Math.abs(dx);
    const legW = SIZE * 0.06;
    const legTop = -SIZE * 0.22;
    const legBottom = SIZE * 0.2;
    if (dy > legTop && dy < legBottom) {
      const slope = (dy - legTop) / (legBottom - legTop);
      const legCenter = slope * SIZE * 0.2;
      if (Math.abs(ax - legCenter) < legW) {
        R = 244;
        G = 246;
        B = 251;
      }
      if (dy > SIZE * 0.05 && dy < SIZE * 0.05 + legW && ax < legCenter) {
        R = 110;
        G = 231;
        B = 255;
      }
    }
    raw[o] = Math.min(255, R);
    raw[o + 1] = Math.min(255, G);
    raw[o + 2] = Math.min(255, B);
    raw[o + 3] = 255;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
