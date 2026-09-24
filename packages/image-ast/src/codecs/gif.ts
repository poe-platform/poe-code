import type { ImageMetadata, RgbaImage } from "../ast.js";

export function isGifBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 6 &&
    bytes[0] === 0x47 && // G
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x38 && // 8
    (bytes[4] === 0x37 || bytes[4] === 0x39) && // 7 or 9
    bytes[5] === 0x61 // a
  );
}

function countGifFrames(bytes: Uint8Array): number {
  const packed = bytes[10]!;
  const hasGct = (packed & 0x80) !== 0;
  const gctSize = 1 << ((packed & 0x07) + 1);
  let pos = 13 + (hasGct ? gctSize * 3 : 0);
  let frames = 0;
  while (pos < bytes.length) {
    const intro = bytes[pos++]!;
    if (intro === 0x3b) break;
    if (intro === 0x21) {
      pos++; // label
      while (pos < bytes.length) {
        const subLen = bytes[pos++]!;
        if (subLen === 0) break;
        pos += subLen;
      }
    } else if (intro === 0x2c) {
      if (pos + 9 > bytes.length) break;
      frames++;
      const imgFlags = bytes[pos + 8]!;
      pos += 9;
      if (imgFlags & 0x80) {
        const lctSize = 1 << ((imgFlags & 0x07) + 1);
        pos += lctSize * 3;
      }
      pos++; // minCodeSize
      while (pos < bytes.length) {
        const subLen = bytes[pos++]!;
        if (subLen === 0) break;
        pos += subLen;
      }
    } else {
      break;
    }
  }
  return Math.max(1, frames);
}

export function readGifMetadata(bytes: Uint8Array): ImageMetadata {
  if (!isGifBytes(bytes) || bytes.length < 13) {
    throw new Error("Invalid GIF header");
  }
  const width = bytes[6]! | (bytes[7]! << 8);
  const height = bytes[8]! | (bytes[9]! << 8);
  return {
    format: "gif",
    width,
    height,
    space: "srgb",
    channels: 4,
    depth: "uchar",
    density: 72,
    hasAlpha: true,
    pages: countGifFrames(bytes),
    size: bytes.byteLength
  };
}

function lzwDecode(minCodeSize: number, data: Uint8Array, pixelCount: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;

  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);

  for (let i = 0; i < clearCode; i++) {
    prefix[i] = -1;
    suffix[i] = i;
  }

  const out = new Uint8Array(pixelCount);
  let outPos = 0;
  let bitPos = 0;
  let oldCode = -1;
  let firstChar = 0;

  const readCode = (): number => {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const byteIdx = (bitPos + i) >>> 3;
      if (byteIdx >= data.length) return eoiCode;
      const bit = (data[byteIdx]! >>> ((bitPos + i) & 7)) & 1;
      code |= bit << i;
    }
    bitPos += codeSize;
    return code;
  };

  while (outPos < pixelCount) {
    const code = readCode();
    if (code === eoiCode) break;
    if (code === clearCode) {
      codeSize = minCodeSize + 1;
      nextCode = eoiCode + 1;
      oldCode = -1;
      continue;
    }
    let inCode = code;
    let sp = 0;
    if (code >= nextCode) {
      stack[sp++] = firstChar;
      inCode = oldCode;
    }
    while (inCode >= clearCode && inCode >= 0) {
      stack[sp++] = suffix[inCode]!;
      inCode = prefix[inCode]!;
    }
    if (inCode < 0) break;
    firstChar = suffix[inCode]!;
    stack[sp++] = firstChar;

    while (sp > 0 && outPos < pixelCount) {
      out[outPos++] = stack[--sp]!;
    }

    if (oldCode !== -1 && nextCode < 4096) {
      prefix[nextCode] = oldCode;
      suffix[nextCode] = firstChar;
      nextCode++;
      if (nextCode === 1 << codeSize && codeSize < 12) {
        codeSize++;
      }
    }
    oldCode = code;
  }
  return out;
}

export function decodeGifImage(bytes: Uint8Array, options?: { readonly page?: number }): RgbaImage {
  const meta = readGifMetadata(bytes);
  const { width, height } = meta;
  const packed = bytes[10]!;
  const hasGct = (packed & 0x80) !== 0;
  const gctSize = 1 << ((packed & 0x07) + 1);
  let pos = 13;
  let gct: Uint8Array = new Uint8Array(0);
  if (hasGct) {
    gct = bytes.subarray(pos, pos + gctSize * 3);
    pos += gctSize * 3;
  }

  let transparentIdx = -1;
  let disposalMethod = 0;
  const targetPage = Math.max(0, options?.page ?? 0);
  let currentFrame = 0;
  const rgba = new Uint8Array(width * height * 4);

  while (pos < bytes.length) {
    const intro = bytes[pos++]!;
    if (intro === 0x3b) break; // trailer
    if (intro === 0x21) {
      const label = bytes[pos++]!;
      if (label === 0xf9) {
        const blockSize = bytes[pos++]!;
        const gceFlags = bytes[pos]!;
        disposalMethod = (gceFlags >>> 2) & 0x07;
        if (gceFlags & 0x01) {
          transparentIdx = bytes[pos + 3]!;
        } else {
          transparentIdx = -1;
        }
        pos += blockSize + 1;
      } else {
        while (pos < bytes.length) {
          const subLen = bytes[pos++]!;
          if (subLen === 0) break;
          pos += subLen;
        }
      }
    } else if (intro === 0x2c) {
      const left = bytes[pos]! | (bytes[pos + 1]! << 8);
      const top = bytes[pos + 2]! | (bytes[pos + 3]! << 8);
      const imgW = bytes[pos + 4]! | (bytes[pos + 5]! << 8);
      const imgH = bytes[pos + 6]! | (bytes[pos + 7]! << 8);
      const imgFlags = bytes[pos + 8]!;
      pos += 9;
      let palette: Uint8Array = gct;
      if (imgFlags & 0x80) {
        const lctSize = 1 << ((imgFlags & 0x07) + 1);
        palette = bytes.subarray(pos, pos + lctSize * 3);
        pos += lctSize * 3;
      }
      const minCodeSize = bytes[pos++]!;
      const blocks: Uint8Array[] = [];
      while (pos < bytes.length) {
        const subLen = bytes[pos++]!;
        if (subLen === 0) break;
        blocks.push(bytes.subarray(pos, pos + subLen));
        pos += subLen;
      }
      const totalLen = blocks.reduce((s, b) => s + b.length, 0);
      const lzwStream = new Uint8Array(totalLen);
      let off = 0;
      for (const b of blocks) {
        lzwStream.set(b, off);
        off += b.length;
      }
      const indices = lzwDecode(minCodeSize, lzwStream, imgW * imgH);
      const isInterlaced = (imgFlags & 0x40) !== 0;
      const rowMap = new Int32Array(imgH);
      if (isInterlaced) {
        let srcRow = 0;
        const passes: [number, number][] = [[0, 8], [4, 8], [2, 4], [1, 2]];
        for (const [start, step] of passes) {
          for (let r = start; r < imgH; r += step) {
            rowMap[srcRow++] = r;
          }
        }
      } else {
        for (let r = 0; r < imgH; r++) rowMap[r] = r;
      }
      const prevCanvas = disposalMethod === 3 ? new Uint8Array(rgba) : undefined;
      for (let sy = 0; sy < imgH; sy++) {
        const y = rowMap[sy]!;
        for (let x = 0; x < imgW; x++) {
          const idx = indices[sy * imgW + x]!;
          const dstX = left + x;
          const dstY = top + y;
          if (dstX < width && dstY < height) {
            const outIdx = (dstY * width + dstX) * 4;
            if (idx === transparentIdx) {
              if (currentFrame === 0) rgba[outIdx + 3] = 0;
            } else {
              rgba[outIdx] = palette[idx * 3] ?? 0;
              rgba[outIdx + 1] = palette[idx * 3 + 1] ?? 0;
              rgba[outIdx + 2] = palette[idx * 3 + 2] ?? 0;
              rgba[outIdx + 3] = 255;
            }
          }
        }
      }
      if (currentFrame >= targetPage) {
        break;
      }
      if (disposalMethod === 2) {
        for (let sy = 0; sy < imgH; sy++) {
          const dstY = top + sy;
          if (dstY >= height) continue;
          for (let sx = 0; sx < imgW; sx++) {
            const dstX = left + sx;
            if (dstX >= width) continue;
            const outIdx = (dstY * width + dstX) * 4;
            rgba[outIdx] = 0;
            rgba[outIdx + 1] = 0;
            rgba[outIdx + 2] = 0;
            rgba[outIdx + 3] = 0;
          }
        }
      } else if (disposalMethod === 3 && prevCanvas) {
        rgba.set(prevCanvas);
      }
      currentFrame++;
      transparentIdx = -1;
      disposalMethod = 0;
    } else {
      break;
    }
  }

  let hasAlpha = transparentIdx !== -1;
  if (!hasAlpha) {
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i]! < 255) {
        hasAlpha = true;
        break;
      }
    }
  }

  return {
    width,
    height,
    data: rgba,
    format: "gif",
    space: "srgb",
    channels: 4,
    depth: "uchar",
    density: 72,
    hasAlpha
  };
}

export function encodeGifImage(img: RgbaImage): Uint8Array {
  const { width, height, data } = img;
  // Build 256-color RGB332 base palette (0..253), pure white at 254, 255 = transparent,
  // and place any non-exact colors (when <= 254 unique colors) into unused palette slots.
  const palette = new Uint8Array(256 * 3);
  const colorToIndex = new Map<number, number>();
  for (let i = 0; i < 254; i++) {
    const r = Math.round((((i >>> 5) & 0x07) * 255) / 7);
    const g = Math.round((((i >>> 2) & 0x07) * 255) / 7);
    const b = Math.round(((i & 0x03) * 255) / 3);
    palette[i * 3] = r;
    palette[i * 3 + 1] = g;
    palette[i * 3 + 2] = b;
    colorToIndex.set((r << 16) | (g << 8) | b, i);
  }
  palette[254 * 3] = 255;
  palette[254 * 3 + 1] = 255;
  palette[254 * 3 + 2] = 255;
  colorToIndex.set((255 << 16) | (255 << 8) | 255, 254);

  const usedSlots = new Set<number>();
  const missingColors: number[] = [];
  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3]! < 128) continue;
    const key = (data[i * 4]! << 16) | (data[i * 4 + 1]! << 8) | data[i * 4 + 2]!;
    const existing = colorToIndex.get(key);
    if (existing !== undefined) {
      usedSlots.add(existing);
    } else if (missingColors.length < 255 && !missingColors.includes(key)) {
      missingColors.push(key);
    }
  }

  if (usedSlots.size + missingColors.length <= 254) {
    let probe = 1;
    for (const key of missingColors) {
      while (probe < 254 && usedSlots.has(probe)) probe++;
      if (probe >= 254) break;
      usedSlots.add(probe);
      colorToIndex.set(key, probe);
      palette[probe * 3] = (key >>> 16) & 0xff;
      palette[probe * 3 + 1] = (key >>> 8) & 0xff;
      palette[probe * 3 + 2] = key & 0xff;
    }
  }

  const indices = new Uint8Array(width * height);
  let hasTransparency = false;
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3]!;
    if (a < 128) {
      indices[i] = 255;
      hasTransparency = true;
    } else {
      const key = (data[i * 4]! << 16) | (data[i * 4 + 1]! << 8) | data[i * 4 + 2]!;
      const exact = colorToIndex.get(key);
      if (exact !== undefined) {
        indices[i] = exact;
      } else {
        const r = data[i * 4]! >>> 5;
        const g = data[i * 4 + 1]! >>> 5;
        const b = data[i * 4 + 2]! >>> 6;
        const idx = (r << 5) | (g << 2) | b;
        indices[i] = idx === 255 ? 254 : idx;
      }
    }
  }

  // Encode LZW with frequent CLEAR codes (every 126 pixels) so codes stay 9-bit
  const minCodeSize = 8;
  const clearCode = 256;
  const eoiCode = 257;
  const bitBytes: number[] = [];
  let bitBuf = 0;
  let bitCount = 0;
  const writeCode9 = (code: number) => {
    bitBuf |= (code & 0x1ff) << bitCount;
    bitCount += 9;
    while (bitCount >= 8) {
      bitBytes.push(bitBuf & 0xff);
      bitBuf >>>= 8;
      bitCount -= 8;
    }
  };

  writeCode9(clearCode);
  for (let i = 0; i < indices.length; i++) {
    if (i > 0 && i % 120 === 0) {
      writeCode9(clearCode);
    }
    writeCode9(indices[i]!);
  }
  writeCode9(eoiCode);
  if (bitCount > 0) {
    bitBytes.push(bitBuf & 0xff);
  }

  const out: number[] = [
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    width & 0xff, (width >>> 8) & 0xff,
    height & 0xff, (height >>> 8) & 0xff,
    0xf7, // GCT present, 8-bit color, 256 entries
    0x00,
    0x00
  ];
  for (let i = 0; i < palette.length; i++) out.push(palette[i]!);

  if (hasTransparency) {
    out.push(0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 255, 0x00);
  }

  // Image descriptor
  out.push(
    0x2c,
    0x00, 0x00,
    0x00, 0x00,
    width & 0xff, (width >>> 8) & 0xff,
    height & 0xff, (height >>> 8) & 0xff,
    0x00,
    minCodeSize
  );

  let bPos = 0;
  while (bPos < bitBytes.length) {
    const chunkLen = Math.min(255, bitBytes.length - bPos);
    out.push(chunkLen);
    for (let i = 0; i < chunkLen; i++) out.push(bitBytes[bPos + i]!);
    bPos += chunkLen;
  }
  out.push(0x00, 0x3b);
  return new Uint8Array(out);
}
