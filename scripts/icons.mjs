import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../icons/', import.meta.url));
const crc32 = data => { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
function chunk(type, bytes) { const name = Buffer.from(type); const out = Buffer.alloc(bytes.length + 12); out.writeUInt32BE(bytes.length); name.copy(out, 4); bytes.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([name, bytes])), bytes.length + 8); return out; }
function image(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const rounded = (x,y,left,top,width,height,radius) => { const dx = Math.max(left + radius - x, 0, x - (left + width - radius)), dy = Math.max(top + radius - y, 0, y - (top + height - radius)); return x >= left && x <= left + width && y >= top && y <= top + height && dx * dx + dy * dy <= radius * radius; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (x / size - .5) * 64, ny = (y / size - .5) * 64;
    const px = nx * .819 - ny * .574 + 32, py = nx * .574 + ny * .819 + 32;
    let cover = rounded(px,py,13,23,8,18,3) || rounded(px,py,21,17,8,30,3) || rounded(px,py,28,29,9,6,1) || rounded(px,py,36,17,8,30,3) || rounded(px,py,44,23,8,18,3);
    const offset = y * (size * 3 + 1) + 1 + x * 3;
    raw[offset] = cover ? 48 : 22; raw[offset + 1] = cover ? 254 : 22; raw[offset + 2] = cover ? 217 : 22;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size,4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
await mkdir(root, { recursive: true });
for (const [file,size] of [['apple-touch-icon.png',180],['icon-192.png',192],['icon-512.png',512],['maskable-512.png',512]]) await writeFile(`${root}/${file}`, image(size));
console.log('Generated four local PWA icons.');
