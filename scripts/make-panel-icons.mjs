// make-panel-icons.mjs
// Writes the PWA icons of the team panel (white "Y" on a black square) as plain
// PNGs, with no dependencies besides zlib. Re-run only if the design changes:
//
//   node scripts/make-panel-icons.mjs
//
// Output: src/panel-icons/icon-192.png and icon-512.png (committed; the Worker
// serves them like the fonts, as binary imports).

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src/panel-icons');
mkdirSync(outDir, { recursive: true });

// The "Y" as polygons on a 100x100 canvas. It stays inside the central 60% so
// the same file also works as a maskable icon (safe zone = central 80%).
const POLYGONS = [
  // left arm
  [[22, 20], [34, 20], [53, 50], [44, 62]],
  // right arm
  [[66, 20], [78, 20], [56, 56], [47, 50]],
  // stem
  [[44, 50], [56, 50], [56, 80], [44, 80]],
];

function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function renderPng(size) {
  const SS = 4; // 4x4 supersampling for smooth edges
  const raw = Buffer.alloc((size + 1) * size); // 8-bit grayscale, 1 filter byte per row
  for (let py = 0; py < size; py++) {
    raw[py * (size + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / size) * 100;
          const y = ((py + (sy + 0.5) / SS) / size) * 100;
          if (POLYGONS.some((p) => inPolygon(x, y, p))) hit++;
        }
      }
      raw[py * (size + 1) + 1 + px] = Math.round((hit / (SS * SS)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type 0 = grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const file = join(outDir, `icon-${size}.png`);
  const png = renderPng(size);
  writeFileSync(file, png);
  console.log(`${file} ${png.length} bytes`);
}
