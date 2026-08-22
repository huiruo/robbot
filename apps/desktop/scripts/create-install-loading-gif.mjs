import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(scriptDir, '..', 'assets');
const outputPath = path.join(assetsDir, 'install-loading.gif');

const width = 320;
const height = 120;
const frameCount = 20;
const delayCs = 5;

const palette = [
  [248, 250, 252],
  [226, 232, 240],
  [15, 23, 42],
  [51, 65, 85],
  [14, 165, 233],
  [56, 189, 248],
  [255, 255, 255],
  [125, 211, 252],
];

const font = {
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
};

function createPixels(fill = 0) {
  return new Uint8Array(width * height).fill(fill);
}

function setPixel(pixels, x, y, color) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  pixels[y * width + x] = color;
}

function rect(pixels, x, y, w, h, color) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(width, x + w);
  const y1 = Math.min(height, y + h);
  for (let yy = y0; yy < y1; yy += 1) {
    pixels.fill(color, yy * width + x0, yy * width + x1);
  }
}

function roundedRect(pixels, x, y, w, h, radius, color) {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      const left = xx < x + radius;
      const right = xx >= x + w - radius;
      const top = yy < y + radius;
      const bottom = yy >= y + h - radius;
      if ((left || right) && (top || bottom)) {
        const cx = left ? x + radius : x + w - radius - 1;
        const cy = top ? y + radius : y + h - radius - 1;
        const dx = xx - cx;
        const dy = yy - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
      }
      setPixel(pixels, xx, yy, color);
    }
  }
}

function drawGlyph(pixels, glyph, x, y, scale, color) {
  const rows = font[glyph];
  if (!rows) return;
  rows.forEach((row, rowIndex) => {
    [...row].forEach((cell, columnIndex) => {
      if (cell === '1') {
        rect(pixels, x + columnIndex * scale, y + rowIndex * scale, scale, scale, color);
      }
    });
  });
}

function drawText(pixels, text, x, y, scale, color) {
  let cursor = x;
  for (const glyph of text) {
    drawGlyph(pixels, glyph, cursor, y, scale, color);
    cursor += 6 * scale;
  }
}

function drawLogo(pixels) {
  roundedRect(pixels, 34, 24, 48, 48, 10, 2);
  roundedRect(pixels, 39, 29, 38, 38, 8, 4);
  rect(pixels, 53, 39, 14, 5, 6);
  rect(pixels, 53, 39, 5, 27, 6);
  rect(pixels, 53, 52, 15, 5, 6);
  rect(pixels, 64, 43, 5, 10, 6);
  rect(pixels, 62, 56, 7, 10, 6);
  rect(pixels, 68, 62, 6, 4, 6);
}

function drawFrame(index) {
  const pixels = createPixels(0);
  roundedRect(pixels, 14, 12, 292, 96, 12, 6);
  for (let i = 0; i < 2; i += 1) roundedRect(pixels, 14 + i, 12 + i, 292 - i * 2, 96 - i * 2, 12, 1);
  roundedRect(pixels, 16, 14, 288, 92, 10, 6);

  drawLogo(pixels);
  drawText(pixels, 'ROBBOT', 101, 34, 6, 2);

  roundedRect(pixels, 40, 84, 240, 10, 5, 1);
  const phase = index / frameCount;
  const segmentWidth = 70;
  const travel = 240 + segmentWidth;
  const head = Math.round(40 + phase * travel) - segmentWidth;
  roundedRect(pixels, Math.max(40, head), 84, Math.min(segmentWidth, 280 - Math.max(40, head)), 10, 5, 4);
  roundedRect(pixels, Math.max(40, head + 9), 86, Math.min(38, 280 - Math.max(40, head + 9)), 6, 3, 5);

  for (let dot = 0; dot < 3; dot += 1) {
    const active = (index + dot * 4) % 12 < 6;
    roundedRect(pixels, 138 + dot * 18, 99, 5, 5, 2, active ? 4 : 1);
  }

  return pixels;
}

function writeAscii(parts, text) {
  parts.push(Buffer.from(text, 'ascii'));
}

function writeU16(parts, value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  parts.push(buffer);
}

function writeSubBlocks(parts, data) {
  for (let offset = 0; offset < data.length; offset += 255) {
    const chunk = data.subarray(offset, offset + 255);
    parts.push(Buffer.from([chunk.length]), chunk);
  }
  parts.push(Buffer.from([0]));
}

function packCodes(codes, codeSize) {
  const bytes = [];
  let current = 0;
  let bits = 0;
  for (const code of codes) {
    current |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      bytes.push(current & 0xff);
      current >>= 8;
      bits -= 8;
    }
  }
  if (bits > 0) bytes.push(current & 0xff);
  return Buffer.from(bytes);
}

function encodeImageData(pixels) {
  const minCodeSize = 8;
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const codes = [];
  let sinceClear = 0;

  codes.push(clearCode);
  for (const pixel of pixels) {
    if (sinceClear >= 100) {
      codes.push(clearCode);
      sinceClear = 0;
    }
    codes.push(pixel);
    sinceClear += 1;
  }
  codes.push(endCode);

  return { minCodeSize, data: packCodes(codes, minCodeSize + 1) };
}

function createGif() {
  const parts = [];
  writeAscii(parts, 'GIF89a');
  writeU16(parts, width);
  writeU16(parts, height);
  parts.push(Buffer.from([0xf7, 0x00, 0x00]));
  for (let index = 0; index < 256; index += 1) {
    parts.push(Buffer.from(palette[index] ?? [0, 0, 0]));
  }

  writeAscii(parts, '!\xff\x0bNETSCAPE2.0\x03\x01');
  writeU16(parts, 0);
  parts.push(Buffer.from([0]));

  for (let frame = 0; frame < frameCount; frame += 1) {
    writeAscii(parts, '!\xf9\x04');
    parts.push(Buffer.from([0x04]));
    writeU16(parts, delayCs);
    parts.push(Buffer.from([0x00, 0x00]));

    parts.push(Buffer.from([0x2c]));
    writeU16(parts, 0);
    writeU16(parts, 0);
    writeU16(parts, width);
    writeU16(parts, height);
    parts.push(Buffer.from([0x00]));

    const encoded = encodeImageData(drawFrame(frame));
    parts.push(Buffer.from([encoded.minCodeSize]));
    writeSubBlocks(parts, encoded.data);
  }

  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

fs.mkdirSync(assetsDir, { recursive: true });
fs.writeFileSync(outputPath, createGif());
console.log(`Created ${path.relative(process.cwd(), outputPath)}`);
