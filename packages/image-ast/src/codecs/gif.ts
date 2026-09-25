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

function parseGifAnimationInfo(bytes: Uint8Array): {
  readonly frames: number;
  readonly delays: number[];
  readonly loop: number | undefined;
} {
  const packed = bytes[10]!;
  const hasGct = (packed & 0x80) !== 0;
  const gctSize = 1 << ((packed & 0x07) + 1);
  let pos = 13 + (hasGct ? gctSize * 3 : 0);
  let frames = 0;
  const delays: number[] = [];
  let pendingDelayMs = 100;
  let loop: number | undefined;
  while (pos < bytes.length) {
    const intro = bytes[pos++]!;
    if (intro === 0x3b) break;
    if (intro === 0x21) {
      const label = bytes[pos++]!;
      if (label === 0xf9) {
        const blockSize = bytes[pos++] ?? 0;
        if (blockSize >= 4 && pos + blockSize <= bytes.length) {
          const delayCs = (bytes[pos + 1] ?? 0) | ((bytes[pos + 2] ?? 0) << 8);
          pendingDelayMs = delayCs * 10;
        }
        pos += blockSize;
        while (pos < bytes.length) {
          const subLen = bytes[pos++]!;
          if (subLen === 0) break;
          pos += subLen;
        }
      } else if (label === 0xff) {
        const appLen = bytes[pos++] ?? 0;
        const appName =
          pos + appLen <= bytes.length
            ? String.fromCharCode(...bytes.subarray(pos, pos + appLen))
            : "";
        pos += appLen;
        while (pos < bytes.length) {
          const subLen = bytes[pos++]!;
          if (subLen === 0) break;
          if (
            (appName.startsWith("NETSCAPE") || appName.startsWith("ANIMEXTS")) &&
            subLen >= 3 &&
            bytes[pos] === 0x01
          ) {
            const rawLoop = (bytes[pos + 1] ?? 0) | ((bytes[pos + 2] ?? 0) << 8);
            loop = rawLoop === 0 ? 0 : rawLoop + 1;
          }
          pos += subLen;
        }
      } else {
        while (pos < bytes.length) {
          const subLen = bytes[pos++]!;
          if (subLen === 0) break;
          pos += subLen;
        }
      }
    } else if (intro === 0x2c) {
      if (pos + 9 > bytes.length) break;
      frames++;
      delays.push(pendingDelayMs);
      pendingDelayMs = 100;
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
  return { frames: Math.max(1, frames), delays, loop };
}

export function readGifMetadata(
  bytes: Uint8Array,
  options?: { readonly animated?: boolean; readonly page?: number; readonly pages?: number }
): ImageMetadata {
  if (!isGifBytes(bytes) || bytes.length < 13) {
    throw new Error("Invalid GIF header");
  }
  const width = bytes[6]! | (bytes[7]! << 8);
  const height = bytes[8]! | (bytes[9]! << 8);
  const anim = parseGifAnimationInfo(bytes);
  const totalPages = anim.frames;
  const isMulti =
    options?.animated === true ||
    options?.pages === -1 ||
    (options?.pages !== undefined && options.pages > 1);
  const startPage = Math.max(0, options?.page ?? 0);
  const numPages = isMulti
    ? options?.pages !== undefined && options.pages > 0
      ? Math.min(options.pages, Math.max(1, totalPages - startPage))
      : Math.max(1, totalPages - startPage)
    : 1;
  return {
    format: "gif",
    width,
    height: height * numPages,
    space: "srgb",
    channels: 4,
    depth: "uchar",
    density: 72,
    hasAlpha: true,
    pages: totalPages,
    ...(isMulti && totalPages > 1 ? { pageHeight: height } : {}),
    ...(anim.delays.length > 0 ? { delay: anim.delays } : {}),
    ...(anim.loop !== undefined ? { loop: anim.loop } : totalPages > 1 ? { loop: 0 } : {}),
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

export function decodeGifImage(
  bytes: Uint8Array,
  options?: { readonly page?: number; readonly pages?: number; readonly animated?: boolean }
): RgbaImage {
  const meta = readGifMetadata(bytes);
  const { width, height } = meta;
  const totalPages = meta.pages ?? 1;
  const isMulti =
    options?.animated === true ||
    options?.pages === -1 ||
    (options?.pages !== undefined && options.pages > 1);
  const startPage = Math.max(0, options?.page ?? 0);
  const numPages = isMulti
    ? options?.pages !== undefined && options.pages > 0
      ? Math.min(options.pages, Math.max(1, totalPages - startPage))
      : Math.max(1, totalPages - startPage)
    : 1;
  const endPage = startPage + numPages - 1;

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
  let currentFrame = 0;
  const framePixels = width * height * 4;
  const rgba = new Uint8Array(framePixels);
  const stackedRgba = numPages > 1 ? new Uint8Array(framePixels * numPages) : rgba;
  let hasAnyAlpha = false;

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
      if (transparentIdx !== -1) hasAnyAlpha = true;
      if (currentFrame >= startPage && currentFrame <= endPage) {
        if (numPages > 1) {
          stackedRgba.set(rgba, (currentFrame - startPage) * framePixels);
        }
      }
      if (currentFrame >= endPage) {
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

  const outData = numPages > 1 ? stackedRgba : rgba;
  let hasAlpha = hasAnyAlpha;
  if (!hasAlpha) {
    for (let i = 3; i < outData.length; i += 4) {
      if (outData[i]! < 255) {
        hasAlpha = true;
        break;
      }
    }
  }

  return {
    width,
    height: height * numPages,
    data: outData,
    format: "gif",
    space: "srgb",
    channels: 4,
    depth: "uchar",
    density: 72,
    hasAlpha,
    pages: numPages > 1 ? numPages : totalPages,
    ...(numPages > 1 ? { pageHeight: height } : {}),
    ...(meta.delay !== undefined ? { delay: meta.delay } : {}),
    ...(meta.loop !== undefined ? { loop: meta.loop } : {})
  };
}

export function encodeGifImage(
  img: RgbaImage,
  options?: {
    readonly pageHeight?: number;
    readonly delay?: number | readonly number[];
    readonly loop?: number;
  }
): Uint8Array {
  const { width, height, data } = img;
  const rawPageHeight = options?.pageHeight ?? img.pageHeight;
  const numFrames =
    rawPageHeight !== undefined &&
    rawPageHeight > 0 &&
    rawPageHeight < height &&
    height % rawPageHeight === 0
      ? height / rawPageHeight
      : 1;
  const frameHeight = numFrames > 1 ? rawPageHeight! : height;
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

  const out: number[] = [
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    width & 0xff, (width >>> 8) & 0xff,
    frameHeight & 0xff, (frameHeight >>> 8) & 0xff,
    0xf7, // GCT present, 8-bit color, 256 entries
    0x00,
    0x00
  ];
  for (let i = 0; i < palette.length; i++) out.push(palette[i]!);

  const loopVal = options?.loop ?? img.loop ?? (numFrames > 1 ? 0 : undefined);
  if (loopVal !== undefined) {
    const netscapeLoop = loopVal === 0 ? 0 : Math.max(0, loopVal - 1);
    out.push(
      0x21, 0xff, 0x0b,
      0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, // NETSCAPE2.0
      0x03, 0x01,
      netscapeLoop & 0xff, (netscapeLoop >>> 8) & 0xff,
      0x00
    );
  }

  const framePixelCount = width * frameHeight;
  for (let f = 0; f < numFrames; f++) {
    const frameSlice = indices.subarray(f * framePixelCount, (f + 1) * framePixelCount);
    let frameTransparent = false;
    for (let i = 0; i < frameSlice.length; i++) {
      if (frameSlice[i] === 255) {
        frameTransparent = true;
        break;
      }
    }
    const delayMs = Array.isArray(options?.delay)
      ? (options.delay[f] ?? options.delay[options.delay.length - 1] ?? 100)
      : typeof options?.delay === "number"
        ? options.delay
        : (img.delay?.[f] ?? (numFrames > 1 ? 100 : 0));
    const delayCs = Math.max(0, Math.round(delayMs / 10));
    if (numFrames > 1 || frameTransparent || options?.delay !== undefined) {
      const gceFlags = (numFrames > 1 ? 0x04 : 0x00) | 0x01;
      out.push(
        0x21, 0xf9, 0x04,
        gceFlags,
        delayCs & 0xff, (delayCs >>> 8) & 0xff,
        255,
        0x00
      );
    }
    out.push(
      0x2c,
      0x00, 0x00,
      0x00, 0x00,
      width & 0xff, (width >>> 8) & 0xff,
      frameHeight & 0xff, (frameHeight >>> 8) & 0xff,
      0x00,
      minCodeSize
    );
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
    for (let i = 0; i < frameSlice.length; i++) {
      if (i > 0 && i % 120 === 0) {
        writeCode9(clearCode);
      }
      writeCode9(frameSlice[i]!);
    }
    writeCode9(eoiCode);
    if (bitCount > 0) {
      bitBytes.push(bitBuf & 0xff);
    }
    let bPos = 0;
    while (bPos < bitBytes.length) {
      const chunkLen = Math.min(255, bitBytes.length - bPos);
      out.push(chunkLen);
      for (let i = 0; i < chunkLen; i++) out.push(bitBytes[bPos + i]!);
      bPos += chunkLen;
    }
    out.push(0x00);
  }
  out.push(0x3b);
  return new Uint8Array(out);
}
