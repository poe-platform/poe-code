import { MermaidBudget, MermaidError } from "./contracts.js";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(typeBytes: Uint8Array, dataBytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < typeBytes.length; i++) {
    c = CRC_TABLE[(c ^ typeBytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  for (let i = 0; i < dataBytes.length; i++) {
    c = CRC_TABLE[(c ^ dataBytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(data: Uint8Array): number {
  let s1 = 1;
  let s2 = 0;
  const len = data.length;
  let i = 0;
  while (i < len) {
    const end = Math.min(i + 5552, len);
    while (i < end) {
      s1 += data[i++]!;
      s2 += s1;
    }
    s1 %= 65521;
    s2 %= 65521;
  }
  return ((s2 << 16) | s1) >>> 0;
}

class BitWriter {
  private buf: Uint8Array;
  private bytePos = 0;
  private bitBuf = 0;
  private bitCount = 0;

  constructor(initialCapacity: number) {
    this.buf = new Uint8Array(Math.max(256, initialCapacity));
  }

  private ensure(extraBytes: number): void {
    if (this.bytePos + extraBytes <= this.buf.length) return;
    let nextCap = this.buf.length * 2;
    while (nextCap < this.bytePos + extraBytes) nextCap *= 2;
    const grown = new Uint8Array(nextCap);
    grown.set(this.buf.subarray(0, this.bytePos));
    this.buf = grown;
  }

  writeBits(value: number, count: number): void {
    this.bitBuf |= (value & ((1 << count) - 1)) << this.bitCount;
    this.bitCount += count;
    this.ensure(4);
    while (this.bitCount >= 8) {
      this.buf[this.bytePos++] = this.bitBuf & 0xff;
      this.bitBuf >>>= 8;
      this.bitCount -= 8;
    }
  }

  writeBitsReversed(code: number, count: number): void {
    let rev = 0;
    for (let i = 0; i < count; i++) {
      rev = (rev << 1) | ((code >>> i) & 1);
    }
    this.writeBits(rev, count);
  }

  writeByteAligned(b: number): void {
    this.flushBits();
    this.ensure(1);
    this.buf[this.bytePos++] = b & 0xff;
  }

  flushBits(): void {
    if (this.bitCount > 0) {
      this.ensure(1);
      this.buf[this.bytePos++] = this.bitBuf & 0xff;
      this.bitBuf = 0;
      this.bitCount = 0;
    }
  }

  toUint8Array(): Uint8Array {
    this.flushBits();
    return this.buf.subarray(0, this.bytePos);
  }
}

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115,
  131, 163, 195, 227, 258
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0
];

function writeFixedLiteral(writer: BitWriter, symbol: number): void {
  if (symbol <= 143) {
    writer.writeBitsReversed(0x30 + symbol, 8);
  } else if (symbol <= 255) {
    writer.writeBitsReversed(0x190 + (symbol - 144), 9);
  } else if (symbol <= 279) {
    writer.writeBitsReversed(symbol - 256, 7);
  } else {
    writer.writeBitsReversed(0xc0 + (symbol - 280), 8);
  }
}

function writeFixedMatch(writer: BitWriter, length: number, distCode: number): void {
  let codeIdx = 0;
  for (let i = LENGTH_BASE.length - 1; i >= 0; i--) {
    if (length >= LENGTH_BASE[i]!) {
      codeIdx = i;
      break;
    }
  }
  const sym = 257 + codeIdx;
  writeFixedLiteral(writer, sym);
  const extraBits = LENGTH_EXTRA[codeIdx]!;
  if (extraBits > 0) {
    writer.writeBits(length - LENGTH_BASE[codeIdx]!, extraBits);
  }
  // Fixed distance code: 5 bits reversed
  writer.writeBitsReversed(distCode, 5);
}

// RFC 1950/1951 zlib + Fixed-Huffman RLE/LZ77 compressor
function compressZlibDeflate(raw: Uint8Array): Uint8Array {
  const writer = new BitWriter(Math.max(512, Math.floor(raw.length / 4)));
  // Zlib header: CMF=0x78 (deflate, 32K window), FLG=0x01 (check bits)
  writer.writeByteAligned(0x78);
  writer.writeByteAligned(0x01);

  // Final block (BFINAL=1), BTYPE=01 (Fixed Huffman)
  writer.writeBits(1, 1);
  writer.writeBits(1, 2);

  let i = 0;
  const n = raw.length;
  while (i < n) {
    // Check distance=1 match (repeated byte run, e.g. 0x00 runs after PNG Sub filter)
    if (i >= 1 && raw[i] === raw[i - 1]) {
      let runLen = 1;
      const maxLen = Math.min(258, n - i);
      const target = raw[i]!;
      while (runLen < maxLen && raw[i + runLen] === target) {
        runLen++;
      }
      if (runLen >= 3) {
        writeFixedMatch(writer, runLen, 0); // distCode 0 => distance 1
        i += runLen;
        continue;
      }
    }
    // Check distance=4 match (repeated RGBA pixel)
    if (i >= 4 && raw[i] === raw[i - 4] && raw[i + 1] === raw[i - 3] && raw[i + 2] === raw[i - 2]) {
      let runLen = 3;
      const maxLen = Math.min(258, n - i);
      while (runLen < maxLen && raw[i + runLen] === raw[i + runLen - 4]) {
        runLen++;
      }
      if (runLen >= 4) {
        writeFixedMatch(writer, runLen, 3); // distCode 3 => distance 4
        i += runLen;
        continue;
      }
    }
    writeFixedLiteral(writer, raw[i]!);
    i++;
  }

  // End-of-block symbol 256
  writeFixedLiteral(writer, 256);
  writer.flushBits();

  const adler = adler32(raw);
  writer.writeByteAligned((adler >>> 24) & 0xff);
  writer.writeByteAligned((adler >>> 16) & 0xff);
  writer.writeByteAligned((adler >>> 8) & 0xff);
  writer.writeByteAligned(adler & 0xff);

  return writer.toUint8Array();
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(typeBytes, data));
  return out;
}

export function encodeRgbaToPng(
  rgba: Uint8Array,
  width: number,
  height: number,
  budget?: MermaidBudget
): Uint8Array {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new MermaidError("E_ARGUMENT", "PNG dimensions must be positive integers");
  }
  if (rgba.byteLength !== width * height * 4) {
    throw new MermaidError("E_ARGUMENT", "RGBA buffer byteLength does not match width * height * 4");
  }

  const rowStride = width * 4;
  const filtered = new Uint8Array((rowStride + 1) * height);
  budget?.chargeMemoryBytes(filtered.byteLength);

  // Filter 1 (Sub) turns horizontal solid-color scanlines into zeros
  for (let y = 0; y < height; y++) {
    budget?.chargeWork(width);
    const srcRow = y * rowStride;
    const dstRow = y * (rowStride + 1);
    filtered[dstRow] = 1; // Filter type 1: Sub
    for (let x = 0; x < rowStride; x++) {
      const left = x >= 4 ? rgba[srcRow + x - 4]! : 0;
      filtered[dstRow + 1 + x] = (rgba[srcRow + x]! - left) & 0xff;
    }
  }

  const compressed = compressZlibDeflate(filtered);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 6; // color type 6 (RGBA)
  ihdr[10] = 0; // compression 0
  ihdr[11] = 0; // filter 0
  ihdr[12] = 0; // interlace 0

  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", compressed);
  const iendChunk = makeChunk("IEND", new Uint8Array(0));

  const totalLen = PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  budget?.chargeOutputBytes(totalLen);

  const png = new Uint8Array(totalLen);
  let offset = 0;
  png.set(PNG_SIGNATURE, offset);
  offset += PNG_SIGNATURE.length;
  png.set(ihdrChunk, offset);
  offset += ihdrChunk.length;
  png.set(idatChunk, offset);
  offset += idatChunk.length;
  png.set(iendChunk, offset);

  return png;
}

// Minimal RFC 1950/1951 inflate decoder for PNG verification in unit tests
function inflateZlibFixed(zlibData: Uint8Array, expectedLength: number): Uint8Array {
  const out = new Uint8Array(expectedLength);
  let outPos = 0;
  let bitPos = 16; // skip 2-byte zlib header

  const readBit = (): number => {
    const byteIdx = bitPos >>> 3;
    const bitIdx = bitPos & 7;
    bitPos++;
    return ((zlibData[byteIdx] ?? 0) >>> bitIdx) & 1;
  };

  const readBits = (count: number): number => {
    let val = 0;
    for (let i = 0; i < count; i++) {
      val |= readBit() << i;
    }
    return val;
  };

  const readBitsMsb = (count: number): number => {
    let val = 0;
    for (let i = 0; i < count; i++) {
      val = (val << 1) | readBit();
    }
    return val;
  };

  const DIST_BASE = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
    2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577
  ];
  const DIST_EXTRA = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
    13
  ];

  while (true) {
    const bfinal = readBit();
    const btype = readBits(2);
    if (btype === 0) {
      // Stored block
      bitPos = (bitPos + 7) & ~7;
      const byteIdx = bitPos >>> 3;
      const len = zlibData[byteIdx]! | (zlibData[byteIdx + 1]! << 8);
      bitPos += 32;
      for (let i = 0; i < len; i++) {
        out[outPos++] = zlibData[(bitPos >>> 3) + i]!;
      }
      bitPos += len * 8;
    } else if (btype === 1) {
      // Fixed Huffman block
      while (true) {
        let code7 = readBitsMsb(7);
        let sym: number;
        if (code7 <= 0x17) {
          sym = 256 + code7;
        } else {
          const code8 = (code7 << 1) | readBit();
          if (code8 <= 0xbf) {
            sym = code8 - 0x30;
          } else if (code8 <= 0xc7) {
            sym = 280 + (code8 - 0xc0);
          } else {
            const code9 = (code8 << 1) | readBit();
            sym = 144 + (code9 - 0x190);
          }
        }
        if (sym === 256) break;
        if (sym < 256) {
          out[outPos++] = sym;
        } else {
          const lenIdx = sym - 257;
          const length = LENGTH_BASE[lenIdx]! + readBits(LENGTH_EXTRA[lenIdx]!);
          const distCode = readBitsMsb(5);
          const distance = DIST_BASE[distCode]! + readBits(DIST_EXTRA[distCode]!);
          for (let k = 0; k < length; k++) {
            out[outPos] = out[outPos - distance]!;
            outPos++;
          }
        }
      }
    } else {
      throw new MermaidError("E_IO", `Unsupported DEFLATE block type ${btype}`);
    }
    if (bfinal === 1) break;
  }

  return out;
}

export function decodePngToRgba(png: Uint8Array): {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
} {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (png[i] !== PNG_SIGNATURE[i]) {
      throw new MermaidError("E_IO", "Invalid PNG signature");
    }
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idatParts: Uint8Array[] = [];
  let totalIdat = 0;

  while (offset + 12 <= png.length) {
    const length = view.getUint32(offset);
    const typeBytes = png.subarray(offset + 4, offset + 8);
    const type = String.fromCharCode(
      typeBytes[0]!,
      typeBytes[1]!,
      typeBytes[2]!,
      typeBytes[3]!
    );
    const data = png.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = view.getUint32(offset + 8 + length);
    if (crc32(typeBytes, data) !== expectedCrc) {
      throw new MermaidError("E_IO", `PNG chunk '${type}' failed CRC32 verification`);
    }
    if (type === "IHDR") {
      const ihdrView = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = ihdrView.getUint32(0);
      height = ihdrView.getUint32(4);
    } else if (type === "IDAT") {
      idatParts.push(data);
      totalIdat += data.length;
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  const zlibStream = new Uint8Array(totalIdat);
  let pos = 0;
  for (const part of idatParts) {
    zlibStream.set(part, pos);
    pos += part.length;
  }

  const rowStride = width * 4;
  const filtered = inflateZlibFixed(zlibStream, (rowStride + 1) * height);
  const rgba = new Uint8Array(rowStride * height);

  for (let y = 0; y < height; y++) {
    const filterType = filtered[y * (rowStride + 1)]!;
    const srcRow = y * (rowStride + 1) + 1;
    const dstRow = y * rowStride;
    for (let x = 0; x < rowStride; x++) {
      const rawByte = filtered[srcRow + x]!;
      const left = x >= 4 ? rgba[dstRow + x - 4]! : 0;
      const up = y > 0 ? rgba[(y - 1) * rowStride + x]! : 0;
      if (filterType === 0) rgba[dstRow + x] = rawByte;
      else if (filterType === 1) rgba[dstRow + x] = (rawByte + left) & 0xff;
      else if (filterType === 2) rgba[dstRow + x] = (rawByte + up) & 0xff;
      else throw new MermaidError("E_IO", `Unsupported PNG filter type ${filterType}`);
    }
  }

  return { width, height, rgba };
}
