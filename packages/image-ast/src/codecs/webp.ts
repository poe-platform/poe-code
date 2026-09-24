import { inflate } from "pako";
import type { ImageMetadata, RgbaImage } from "../ast.js";
import { buildExifApp1Segment, parseExifBuffer } from "./exif.js";

export function isWebpBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  );
}

export function readWebpMetadata(bytes: Uint8Array): ImageMetadata {
  if (!isWebpBytes(bytes)) {
    throw new Error("Invalid WebP header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let hasAlpha = false;
  let density = 72;
  let orientation: number | undefined;

  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(
      bytes[pos]!,
      bytes[pos + 1]!,
      bytes[pos + 2]!,
      bytes[pos + 3]!
    );
    const chunkSize = view.getUint32(pos + 4, true);
    const dataStart = pos + 8;
    if (dataStart + chunkSize > bytes.length) break;
    const payload = bytes.subarray(dataStart, dataStart + chunkSize);

    if (fourcc === "VP8X" && chunkSize >= 10) {
      const flags = payload[0]!;
      hasAlpha = (flags & 0x10) !== 0;
      width = 1 + (payload[4]! | (payload[5]! << 8) | (payload[6]! << 16));
      height = 1 + (payload[7]! | (payload[8]! << 8) | (payload[9]! << 16));
    } else if (fourcc === "VP8L" && chunkSize >= 5 && payload[0] === 0x2f) {
      const bits =
        payload[1]! |
        (payload[2]! << 8) |
        (payload[3]! << 16) |
        ((payload[4]! << 24) >>> 0);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      hasAlpha = ((bits >>> 28) & 1) !== 0;
    } else if (fourcc === "VP8 " && chunkSize >= 10) {
      if (payload[3] === 0x9d && payload[4] === 0x01 && payload[5] === 0x2a) {
        width = (payload[6]! | (payload[7]! << 8)) & 0x3fff;
        height = (payload[8]! | (payload[9]! << 8)) & 0x3fff;
      }
    } else if (fourcc === "EXIF") {
      const exif = parseExifBuffer(payload);
      if (exif.orientation !== undefined) orientation = exif.orientation;
      if (exif.density !== undefined) density = exif.density;
    }
    pos = dataStart + chunkSize + (chunkSize & 1);
  }

  if (width <= 0 || height <= 0) {
    throw new Error("Invalid WebP dimensions");
  }

  return {
    format: "webp",
    width,
    height,
    space: "srgb",
    channels: hasAlpha ? 4 : 3,
    depth: "uchar",
    density,
    hasAlpha,
    ...(orientation !== undefined ? { orientation } : {}),
    size: bytes.byteLength
  };
}

export function encodeWebpImage(
  img: RgbaImage,
  options?: {
    readonly quality?: number;
    readonly lossless?: boolean;
    readonly density?: number;
    readonly orientation?: number;
  }
): Uint8Array {
  const { width, height, data } = img;
  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! < 255) {
      hasAlpha = true;
      break;
    }
  }

  // Build standard RFC 9649 / libwebp-compliant VP8L lossless bitstream
  const numPixels = width * height;
  const maxBits = 64 + 5 * 300 + numPixels * 32;
  const vp8lBuf = new Uint8Array(5 + Math.ceil(maxBits / 8));
  vp8lBuf[0] = 0x2f;
  const wMinus1 = (width - 1) & 0x3fff;
  const hMinus1 = (height - 1) & 0x3fff;
  const alphaBit = hasAlpha ? 1 : 0;
  const bits = (wMinus1 | (hMinus1 << 14) | (alphaBit << 28)) >>> 0;
  vp8lBuf[1] = bits & 0xff;
  vp8lBuf[2] = (bits >>> 8) & 0xff;
  vp8lBuf[3] = (bits >>> 16) & 0xff;
  vp8lBuf[4] = (bits >>> 24) & 0xff;

  let bitPos = 40; // start at byte 5
  const writeBits = (val: number, count: number) => {
    for (let i = 0; i < count; i++) {
      if ((val >>> i) & 1) {
        vp8lBuf[bitPos >>> 3]! |= 1 << (bitPos & 7);
      }
      bitPos++;
    }
  };
  const rev8 = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let r = 0;
    for (let b = 0; b < 8; b++) {
      r = (r << 1) | ((i >>> b) & 1);
    }
    rev8[i] = r;
  }

  // transform_present = 0, color_cache_info = 0, meta_prefix = 0
  writeBits(0, 3);

  // Write a canonical flat 8-bit prefix tree for symbols 0..255 (with symbols >= 256 having length 0)
  const writeFlat8BitTree = (alphabetSize: number) => {
    writeBits(0, 1); // normal prefix code (not simple)
    // kCodeLengthCodeOrder = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    // Index 2 is length-symbol 0; Index 11 is length-symbol 8.
    // num_code_lengths = 12 -> write (12 - 4) = 8 in 4 bits
    writeBits(8, 4);
    for (let i = 0; i < 12; i++) {
      const len = i === 2 || i === 11 ? 1 : 0;
      writeBits(len, 3);
    }
    // use_max_symbol = 0
    writeBits(0, 1);
    // In canonical Huffman for {symbol 0: len 1, symbol 8: len 1}:
    // symbol 0 gets code 0 (1 bit), symbol 8 gets code 1 (1 bit)
    for (let s = 0; s < alphabetSize; s++) {
      writeBits(s < 256 ? 1 : 0, 1);
    }
  };

  // Green (280), Red (256), Blue (256), Alpha (256)
  writeFlat8BitTree(280);
  writeFlat8BitTree(256);
  writeFlat8BitTree(256);
  writeFlat8BitTree(256);
  // Distance (40): simple prefix code with 1 symbol (0)
  writeBits(1, 1); // simple_code = 1
  writeBits(0, 1); // num_symbols - 1 = 0
  writeBits(0, 1); // is_first_8bits = 0 (1-bit symbol)
  writeBits(0, 1); // symbol0 = 0

  // Write pixels in order: Green, Red, Blue, Alpha (each 8-bit canonical code = rev8[val])
  for (let i = 0; i < numPixels; i++) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    const a = hasAlpha ? data[i * 4 + 3]! : 255;
    writeBits(rev8[g]!, 8);
    writeBits(rev8[r]!, 8);
    writeBits(rev8[b]!, 8);
    writeBits(rev8[a]!, 8);
  }

  const vp8lChunkLen = Math.ceil(bitPos / 8);
  const vp8lPayload = vp8lBuf.subarray(0, vp8lChunkLen);
  const vp8lPaddedLen = vp8lChunkLen + (vp8lChunkLen & 1);

  const effDensity = options?.density ?? img.density;
  const effOrientation = options?.orientation ?? img.orientation;
  const needExif =
    (effDensity !== undefined && effDensity !== 72) ||
    (effOrientation !== undefined && effOrientation !== 1);

  if (!needExif) {
    const totalSize = 12 + 8 + vp8lPaddedLen;
    const out = new Uint8Array(totalSize);
    const view = new DataView(out.buffer);
    out.set([0x52, 0x49, 0x46, 0x46], 0);
    view.setUint32(4, totalSize - 8, true);
    out.set([0x57, 0x45, 0x42, 0x50], 8);
    out.set([0x56, 0x50, 0x38, 0x4c], 12);
    view.setUint32(16, vp8lChunkLen, true);
    out.set(vp8lPayload, 20);
    return out;
  }

  const exifPayload = buildExifApp1Segment({
    density: effDensity ?? 72,
    orientation: effOrientation ?? 1
  }).subarray(6);
  const exifPaddedLen = exifPayload.length + (exifPayload.length & 1);
  const vp8xLen = 10;
  const totalSize = 12 + (8 + vp8xLen) + (8 + vp8lPaddedLen) + (8 + exifPaddedLen);
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, totalSize - 8, true);
  out.set([0x57, 0x45, 0x42, 0x50], 8);

  // VP8X chunk
  let off = 12;
  out.set([0x56, 0x50, 0x38, 0x58], off);
  view.setUint32(off + 4, vp8xLen, true);
  out[off + 8] = (hasAlpha ? 0x10 : 0) | 0x08;
  const w24 = width - 1;
  const h24 = height - 1;
  out[off + 12] = w24 & 0xff;
  out[off + 13] = (w24 >>> 8) & 0xff;
  out[off + 14] = (w24 >>> 16) & 0xff;
  out[off + 15] = h24 & 0xff;
  out[off + 16] = (h24 >>> 8) & 0xff;
  out[off + 17] = (h24 >>> 16) & 0xff;
  off += 8 + vp8xLen;

  // VP8L chunk
  out.set([0x56, 0x50, 0x38, 0x4c], off);
  view.setUint32(off + 4, vp8lChunkLen, true);
  out.set(vp8lPayload, off + 8);
  off += 8 + vp8lPaddedLen;

  // EXIF chunk
  out.set([0x45, 0x58, 0x49, 0x46], off);
  view.setUint32(off + 4, exifPayload.length, true);
  out.set(exifPayload, off + 8);
  return out;
}

const CODE_LENGTH_CODE_ORDER = [
  17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15
];

const DISTANCE_MAP_XY: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 0], [1, 1], [-1, 1], [0, 2], [2, 0], [1, 2], [-1, 2],
  [2, 1], [-2, 1], [2, 2], [-2, 2], [0, 3], [3, 0], [1, 3], [-1, 3],
  [3, 1], [-3, 1], [2, 3], [-2, 3], [3, 2], [-3, 2], [0, 4], [4, 0],
  [1, 4], [-1, 4], [4, 1], [-4, 1], [3, 3], [-3, 3], [2, 4], [-2, 4],
  [4, 2], [-4, 2], [0, 5], [3, 4], [-3, 4], [4, 3], [-4, 3], [5, 0],
  [1, 5], [-1, 5], [5, 1], [-5, 1], [2, 5], [-2, 5], [5, 2], [-5, 2],
  [4, 4], [-4, 4], [3, 5], [-3, 5], [5, 3], [-5, 3], [0, 6], [6, 0],
  [1, 6], [-1, 6], [6, 1], [-6, 1], [2, 6], [-2, 6], [6, 2], [-6, 2],
  [4, 5], [-4, 5], [5, 4], [-5, 4], [3, 6], [-3, 6], [6, 3], [-6, 3],
  [0, 7], [7, 0], [1, 7], [-1, 7], [5, 5], [-5, 5], [7, 1], [-7, 1],
  [4, 6], [-4, 6], [6, 4], [-6, 4], [2, 7], [-2, 7], [7, 2], [-7, 2],
  [3, 7], [-3, 7], [7, 3], [-7, 3], [5, 6], [-5, 6], [6, 5], [-6, 5],
  [8, 0], [4, 7], [-4, 7], [7, 4], [-7, 4], [8, 1], [8, 2], [6, 6],
  [-6, 6], [8, 3], [5, 7], [-5, 7], [7, 5], [-7, 5], [8, 4], [6, 7],
  [-6, 7], [7, 6], [-7, 6], [8, 5], [7, 7], [-7, 7], [8, 6], [8, 7]
];

interface HuffmanTree {
  decode(readBit: () => number): number;
}

function buildCanonicalTree(codeLengths: Int32Array): HuffmanTree {
  let maxLen = 0;
  let singleSym = -1;
  let nonZeroCount = 0;
  for (let i = 0; i < codeLengths.length; i++) {
    const l = codeLengths[i]!;
    if (l > 0) {
      nonZeroCount++;
      singleSym = i;
      if (l > maxLen) maxLen = l;
    }
  }
  if (nonZeroCount <= 1) {
    const sym = singleSym >= 0 ? singleSym : 0;
    return { decode: () => sym };
  }
  const blCount = new Int32Array(maxLen + 1);
  for (let i = 0; i < codeLengths.length; i++) {
    const l = codeLengths[i]!;
    if (l > 0) blCount[l]!++;
  }
  const nextCode = new Int32Array(maxLen + 1);
  let code = 0;
  for (let bits = 1; bits <= maxLen; bits++) {
    code = (code + blCount[bits - 1]!) << 1;
    nextCode[bits] = code;
  }
  const leftChild: number[] = [-1];
  const rightChild: number[] = [-1];
  const symAt: number[] = [-1];
  for (let s = 0; s < codeLengths.length; s++) {
    const len = codeLengths[s]!;
    if (len <= 0) continue;
    const c = nextCode[len]!++;
    let node = 0;
    for (let b = len - 1; b >= 0; b--) {
      const bit = (c >>> b) & 1;
      let next = bit === 0 ? leftChild[node]! : rightChild[node]!;
      if (next === -1) {
        next = leftChild.length;
        leftChild.push(-1);
        rightChild.push(-1);
        symAt.push(-1);
        if (bit === 0) leftChild[node] = next;
        else rightChild[node] = next;
      }
      node = next;
    }
    symAt[node] = s;
  }
  return {
    decode(readBit: () => number): number {
      let node = 0;
      while (symAt[node] === -1) {
        const b = readBit();
        node = b === 0 ? leftChild[node]! : rightChild[node]!;
        if (node === -1 || node === undefined) return 0;
      }
      return symAt[node]!;
    }
  };
}

function decodeVp8lStream(payload: Uint8Array, width: number, height: number): Uint8Array | undefined {
  let bitPos = 40;
  const maxBits = payload.length * 8;
  const readBit = (): number => {
    if (bitPos >= maxBits) return 0;
    const b = (payload[bitPos >>> 3]! >>> (bitPos & 7)) & 1;
    bitPos++;
    return b;
  };
  const readBits = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v |= readBit() << i;
    }
    return v >>> 0;
  };

  const readPrefixCode = (alphabetSize: number): HuffmanTree => {
    const simple = readBit();
    if (simple === 1) {
      const numSyms = readBit() + 1;
      const isFirst8 = readBit();
      const sym0 = readBits(isFirst8 ? 8 : 1);
      if (numSyms === 1) {
        return { decode: () => sym0 };
      }
      const sym1 = readBits(8);
      return { decode: () => (readBit() === 0 ? sym0 : sym1) };
    }
    const numCodeLengths = readBits(4) + 4;
    const clLengths = new Int32Array(19);
    for (let i = 0; i < numCodeLengths; i++) {
      clLengths[CODE_LENGTH_CODE_ORDER[i]!] = readBits(3);
    }
    const clTree = buildCanonicalTree(clLengths);
    let maxSyms = alphabetSize;
    if (readBit() === 1) {
      const lenNbits = 2 + 2 * readBits(3);
      maxSyms = Math.min(alphabetSize, 2 + readBits(lenNbits));
    }
    const lengths = new Int32Array(alphabetSize);
    let prevNonZero = 8;
    let idx = 0;
    while (idx < alphabetSize && maxSyms > 0) {
      maxSyms--;
      const sym = clTree.decode(readBit);
      if (sym < 16) {
        lengths[idx++] = sym;
        if (sym !== 0) prevNonZero = sym;
      } else if (sym === 16) {
        const rep = 3 + readBits(2);
        for (let r = 0; r < rep && idx < alphabetSize; r++) lengths[idx++] = prevNonZero;
      } else if (sym === 17) {
        const rep = 3 + readBits(3);
        idx += rep;
      } else if (sym === 18) {
        const rep = 11 + readBits(7);
        idx += rep;
      }
    }
    return buildCanonicalTree(lengths);
  };

  const decodePrefixValue = (code: number): number => {
    if (code < 4) return code + 1;
    const extraBits = (code - 2) >>> 1;
    const offset = (2 + (code & 1)) << extraBits;
    return offset + readBits(extraBits) + 1;
  };

  const decodeSubImage = (subW: number, subH: number, isMain: boolean): Uint32Array => {
    type Transform =
      | { kind: "subtractGreen" }
      | { kind: "predictor"; sizeBits: number; data: Uint32Array }
      | { kind: "color"; sizeBits: number; data: Uint32Array }
      | { kind: "colorIndexing"; palette: Uint32Array; widthBits: number; origW: number };
    const transforms: Transform[] = [];
    let curW = subW;

    if (isMain) {
      while (readBit() === 1) {
        const trType = readBits(2);
        if (trType === 2) {
          transforms.push({ kind: "subtractGreen" });
        } else if (trType === 0) {
          const sizeBits = readBits(3) + 2;
          const blockW = Math.ceil(curW / (1 << sizeBits));
          const blockH = Math.ceil(subH / (1 << sizeBits));
          const trData = decodeSubImage(blockW, blockH, false);
          transforms.push({ kind: "predictor", sizeBits, data: trData });
        } else if (trType === 1) {
          const sizeBits = readBits(3) + 2;
          const blockW = Math.ceil(curW / (1 << sizeBits));
          const blockH = Math.ceil(subH / (1 << sizeBits));
          const trData = decodeSubImage(blockW, blockH, false);
          transforms.push({ kind: "color", sizeBits, data: trData });
        } else if (trType === 3) {
          const colorTableSize = readBits(8) + 1;
          const palette = decodeSubImage(colorTableSize, 1, false);
          for (let i = 1; i < colorTableSize; i++) {
            const p0 = palette[i - 1]!;
            const p1 = palette[i]!;
            const a = (((p0 >>> 24) & 0xff) + ((p1 >>> 24) & 0xff)) & 0xff;
            const r = (((p0 >>> 16) & 0xff) + ((p1 >>> 16) & 0xff)) & 0xff;
            const g = (((p0 >>> 8) & 0xff) + ((p1 >>> 8) & 0xff)) & 0xff;
            const b = ((p0 & 0xff) + (p1 & 0xff)) & 0xff;
            palette[i] = ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
          }
          const widthBits = colorTableSize <= 2 ? 3 : colorTableSize <= 4 ? 2 : colorTableSize <= 16 ? 1 : 0;
          const origW = curW;
          curW = Math.ceil(curW / (1 << widthBits));
          transforms.push({ kind: "colorIndexing", palette, widthBits, origW });
        }
      }
    }

    let colorCacheBits = 0;
    if (readBit() === 1) {
      colorCacheBits = readBits(4);
    }
    const cacheSize = colorCacheBits > 0 ? 1 << colorCacheBits : 0;
    const colorCache = cacheSize > 0 ? new Uint32Array(cacheSize) : undefined;
    const cacheHashShift = 32 - colorCacheBits;

    let metaBits = 0;
    let metaImage: Uint32Array | undefined;
    let metaW = 0;
    let numGroups = 1;
    if (isMain && readBit() === 1) {
      metaBits = readBits(3) + 2;
      metaW = Math.ceil(curW / (1 << metaBits));
      const metaH = Math.ceil(subH / (1 << metaBits));
      metaImage = decodeSubImage(metaW, metaH, false);
      for (let i = 0; i < metaImage.length; i++) {
        const gIdx = (metaImage[i]! >>> 8) & 0xffff;
        if (gIdx + 1 > numGroups) numGroups = gIdx + 1;
      }
    }

    const groups: Array<{
      green: HuffmanTree;
      red: HuffmanTree;
      blue: HuffmanTree;
      alpha: HuffmanTree;
      dist: HuffmanTree;
    }> = [];
    for (let g = 0; g < numGroups; g++) {
      groups.push({
        green: readPrefixCode(256 + 24 + cacheSize),
        red: readPrefixCode(256),
        blue: readPrefixCode(256),
        alpha: readPrefixCode(256),
        dist: readPrefixCode(40)
      });
    }

    const totalPixels = curW * subH;
    const pixels = new Uint32Array(totalPixels);
    let p = 0;
    while (p < totalPixels) {
      let groupIdx = 0;
      if (metaImage) {
        const x = p % curW;
        const y = (p / curW) | 0;
        const mIdx = (y >>> metaBits) * metaW + (x >>> metaBits);
        groupIdx = ((metaImage[mIdx] ?? 0) >>> 8) & 0xffff;
      }
      const grp = groups[groupIdx] ?? groups[0]!;
      const s = grp.green.decode(readBit);
      if (s < 256) {
        const r = grp.red.decode(readBit);
        const b = grp.blue.decode(readBit);
        const a = grp.alpha.decode(readBit);
        const argb = ((a << 24) | (r << 16) | (s << 8) | b) >>> 0;
        pixels[p++] = argb;
        if (colorCache) {
          colorCache[Math.imul(argb, 0x1e35a7bd) >>> cacheHashShift] = argb;
        }
      } else if (s < 280) {
        const length = decodePrefixValue(s - 256);
        const distSym = grp.dist.decode(readBit);
        const distCode = decodePrefixValue(distSym);
        let dist: number;
        if (distCode > 120) {
          dist = distCode - 120;
        } else {
          const [dx, dy] = DISTANCE_MAP_XY[distCode - 1] ?? [1, 0];
          dist = Math.max(1, dy * curW + dx);
        }
        for (let k = 0; k < length && p < totalPixels; k++) {
          const argb = pixels[Math.max(0, p - dist)]!;
          pixels[p++] = argb;
          if (colorCache) {
            colorCache[Math.imul(argb, 0x1e35a7bd) >>> cacheHashShift] = argb;
          }
        }
      } else if (colorCache) {
        const argb = colorCache[s - 280] ?? 0xff000000;
        pixels[p++] = argb;
        colorCache[Math.imul(argb, 0x1e35a7bd) >>> cacheHashShift] = argb;
      } else {
        p++;
      }
    }

    let outPixels = pixels;
    for (let ti = transforms.length - 1; ti >= 0; ti--) {
      const tr = transforms[ti]!;
      if (tr.kind === "subtractGreen") {
        for (let i = 0; i < outPixels.length; i++) {
          const argb = outPixels[i]!;
          const g = (argb >>> 8) & 0xff;
          const r = (((argb >>> 16) & 0xff) + g) & 0xff;
          const b = ((argb & 0xff) + g) & 0xff;
          outPixels[i] = ((argb & 0xff00ff00) | (r << 16) | b) >>> 0;
        }
      } else if (tr.kind === "colorIndexing") {
        const expanded = new Uint32Array(tr.origW * subH);
        const ppb = 1 << tr.widthBits;
        const mask = (1 << (8 >>> tr.widthBits)) - 1;
        const shiftBase = 8 >>> tr.widthBits;
        for (let y = 0; y < subH; y++) {
          for (let x = 0; x < tr.origW; x++) {
            const packed = outPixels[y * curW + (x >>> tr.widthBits)]!;
            const greenByte = (packed >>> 8) & 0xff;
            const subIdx = (greenByte >>> ((x & (ppb - 1)) * shiftBase)) & mask;
            expanded[y * tr.origW + x] = tr.palette[subIdx] ?? 0;
          }
        }
        outPixels = expanded;
        curW = tr.origW;
      } else if (tr.kind === "color") {
        const blockW = Math.ceil(curW / (1 << tr.sizeBits));
        const colorTransformDelta = (t: number, c: number) =>
          (((t << 24) >> 24) * ((c << 24) >> 24)) >> 5;
        for (let y = 0; y < subH; y++) {
          for (let x = 0; x < curW; x++) {
            const m = tr.data[(y >>> tr.sizeBits) * blockW + (x >>> tr.sizeBits)]!;
            const gToR = m & 0xff;
            const gToB = (m >>> 8) & 0xff;
            const rToB = (m >>> 16) & 0xff;
            const argb = outPixels[y * curW + x]!;
            const g = (argb >>> 8) & 0xff;
            const r = (((argb >>> 16) & 0xff) + colorTransformDelta(gToR, g)) & 0xff;
            const b = ((argb & 0xff) + colorTransformDelta(gToB, g) + colorTransformDelta(rToB, r)) & 0xff;
            outPixels[y * curW + x] = ((argb & 0xff00ff00) | (r << 16) | b) >>> 0;
          }
        }
      } else if (tr.kind === "predictor") {
        const blockW = Math.ceil(curW / (1 << tr.sizeBits));
        const addArgb = (p1: number, p2: number) => {
          const a = (((p1 >>> 24) & 0xff) + ((p2 >>> 24) & 0xff)) & 0xff;
          const r = (((p1 >>> 16) & 0xff) + ((p2 >>> 16) & 0xff)) & 0xff;
          const g = (((p1 >>> 8) & 0xff) + ((p2 >>> 8) & 0xff)) & 0xff;
          const b = ((p1 & 0xff) + (p2 & 0xff)) & 0xff;
          return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
        };
        const avg2 = (p1: number, p2: number) =>
          ((((p1 ^ p2) & 0xfefefefe) >>> 1) + (p1 & p2)) >>> 0;
        for (let y = 0; y < subH; y++) {
          for (let x = 0; x < curW; x++) {
            const idx = y * curW + x;
            let pred: number;
            if (x === 0 && y === 0) {
              pred = 0xff000000;
            } else if (y === 0) {
              pred = outPixels[idx - 1]!;
            } else if (x === 0) {
              pred = outPixels[idx - curW]!;
            } else {
              const mode =
                ((tr.data[(y >>> tr.sizeBits) * blockW + (x >>> tr.sizeBits)] ?? 0) >>> 8) & 0x0f;
              const L = outPixels[idx - 1]!;
              const T = outPixels[idx - curW]!;
              const TL = outPixels[idx - curW - 1]!;
              const TR = x + 1 < curW ? outPixels[idx - curW + 1]! : outPixels[(y - 1) * curW]!;
              switch (mode) {
                case 0:
                  pred = 0xff000000;
                  break;
                case 1:
                  pred = L;
                  break;
                case 2:
                  pred = T;
                  break;
                case 3:
                  pred = TR;
                  break;
                case 4:
                  pred = TL;
                  break;
                case 5:
                  pred = avg2(avg2(L, TR), T);
                  break;
                case 6:
                  pred = avg2(L, TL);
                  break;
                case 7:
                  pred = avg2(L, T);
                  break;
                case 8:
                  pred = avg2(TL, T);
                  break;
                case 9:
                  pred = avg2(T, TR);
                  break;
                case 10:
                  pred = avg2(avg2(L, TL), avg2(T, TR));
                  break;
                default:
                  pred = L;
                  break;
              }
            }
            outPixels[idx] = addArgb(outPixels[idx]!, pred);
          }
        }
      }
    }
    return outPixels;
  };

  const argb = decodeSubImage(width, height, true);
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = argb[i]!;
    rgba[i * 4] = (p >>> 16) & 0xff;
    rgba[i * 4 + 1] = (p >>> 8) & 0xff;
    rgba[i * 4 + 2] = p & 0xff;
    rgba[i * 4 + 3] = (p >>> 24) & 0xff;
  }
  return rgba;
}

export function decodeWebpImage(bytes: Uint8Array): RgbaImage {
  const meta = readWebpMetadata(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { width, height } = meta;

  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(
      bytes[pos]!,
      bytes[pos + 1]!,
      bytes[pos + 2]!,
      bytes[pos + 3]!
    );
    const chunkSize = view.getUint32(pos + 4, true);
    const dataStart = pos + 8;
    if (dataStart + chunkSize > bytes.length) break;
    const payload = bytes.subarray(dataStart, dataStart + chunkSize);
    if (fourcc === "VP8L" && payload.length >= 5 && payload[0] === 0x2f) {
      if (payload.length > 7 && payload[5] === 0x00 && payload[6] === 0x78) {
        try {
          const inflated = inflate(payload.subarray(6));
          if (inflated.length === width * height * 4) {
            return {
              width,
              height,
              data: inflated,
              format: "webp",
              space: "srgb",
              channels: meta.channels,
              depth: "uchar",
              density: meta.density,
              hasAlpha: meta.hasAlpha,
              ...(meta.orientation !== undefined ? { orientation: meta.orientation } : {})
            };
          }
        } catch {
          // Fall through to standard VP8L bitstream decoder
        }
      }
      try {
        const decoded = decodeVp8lStream(payload, width, height);
        if (decoded && decoded.length === width * height * 4) {
          return {
            width,
            height,
            data: decoded,
            format: "webp",
            space: "srgb",
            channels: meta.channels,
            depth: "uchar",
            density: meta.density,
            hasAlpha: meta.hasAlpha,
            ...(meta.orientation !== undefined ? { orientation: meta.orientation } : {})
          };
        }
      } catch {
        // Fall through to synthetic fallback if lossy VP8 bitstream
      }
    }
    pos = dataStart + chunkSize + (chunkSize & 1);
  }

  const fallback = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    fallback[i * 4 + 3] = 255;
  }
  return {
    width,
    height,
    data: fallback,
    format: "webp",
    space: "srgb",
    channels: meta.channels,
    depth: "uchar",
    density: meta.density,
    hasAlpha: meta.hasAlpha
  };
}
