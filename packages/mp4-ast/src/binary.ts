const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });
const TEXT_ENCODER = new TextEncoder();

export function encodeUtf8(text: string): Uint8Array {
  return TEXT_ENCODER.encode(text);
}

export function decodeUtf8(bytes: Uint8Array): string {
  return TEXT_DECODER.decode(bytes);
}

export function decodeLatin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

export function encodeFourCC(fourcc: string): Uint8Array {
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    out[i] = i < fourcc.length ? fourcc.charCodeAt(i) & 0xff : 0x20;
  }
  return out;
}

export function decodeFourCC(bytes: Uint8Array, offset = 0): string {
  return String.fromCharCode(
    bytes[offset] ?? 0x20,
    bytes[offset + 1] ?? 0x20,
    bytes[offset + 2] ?? 0x20,
    bytes[offset + 3] ?? 0x20
  );
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export class BinaryReader {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  offset: number;

  constructor(bytes: Uint8Array, offset = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = offset;
  }

  get remaining(): number {
    return Math.max(0, this.bytes.byteLength - this.offset);
  }

  get eof(): boolean {
    return this.offset >= this.bytes.byteLength;
  }

  seek(offset: number): void {
    this.offset = Math.max(0, Math.min(this.bytes.byteLength, offset));
  }

  skip(count: number): void {
    this.seek(this.offset + count);
  }

  readU8(): number {
    if (this.offset >= this.bytes.byteLength) return 0;
    return this.bytes[this.offset++]!;
  }

  readI8(): number {
    if (this.offset >= this.bytes.byteLength) return 0;
    const v = this.view.getInt8(this.offset);
    this.offset += 1;
    return v;
  }

  readU16BE(): number {
    if (this.offset + 2 > this.bytes.byteLength) {
      this.offset = this.bytes.byteLength;
      return 0;
    }
    const v = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return v;
  }

  readI16BE(): number {
    if (this.offset + 2 > this.bytes.byteLength) {
      this.offset = this.bytes.byteLength;
      return 0;
    }
    const v = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return v;
  }

  readU16LE(): number {
    if (this.offset + 2 > this.bytes.byteLength) {
      this.offset = this.bytes.byteLength;
      return 0;
    }
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readU24BE(): number {
    const b0 = this.readU8();
    const b1 = this.readU8();
    const b2 = this.readU8();
    return (b0 << 16) | (b1 << 8) | b2;
  }

  readU32BE(): number {
    if (this.offset + 4 > this.bytes.byteLength) {
      this.offset = this.bytes.byteLength;
      return 0;
    }
    const v = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return v;
  }

  readI32BE(): number {
    if (this.offset + 4 > this.bytes.byteLength) {
      this.offset = this.bytes.byteLength;
      return 0;
    }
    const v = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return v;
  }

  readU32LE(): number {
    if (this.offset + 4 > this.bytes.byteLength) {
      this.offset = this.bytes.byteLength;
      return 0;
    }
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readI32LE(): number {
    if (this.offset + 4 > this.bytes.byteLength) {
      this.offset = this.bytes.byteLength;
      return 0;
    }
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readU64BE(): number {
    const hi = this.readU32BE();
    const lo = this.readU32BE();
    return hi * 4294967296 + lo;
  }

  readI64BE(): number {
    const hi = this.readI32BE();
    const lo = this.readU32BE();
    return hi * 4294967296 + lo;
  }

  readF64BE(): number {
    if (this.offset + 8 > this.bytes.byteLength) {
      this.offset = this.bytes.byteLength;
      return 0;
    }
    const v = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return v;
  }

  readF32BE(): number {
    if (this.offset + 4 > this.bytes.byteLength) {
      this.offset = this.bytes.byteLength;
      return 0;
    }
    const v = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return v;
  }

  readFixed16_16(): number {
    return this.readI32BE() / 65536;
  }

  readFixed8_8(): number {
    return this.readI16BE() / 256;
  }

  readFourCC(): string {
    const s = decodeFourCC(this.bytes, this.offset);
    this.offset = Math.min(this.bytes.byteLength, this.offset + 4);
    return s;
  }

  readSlice(length: number): Uint8Array {
    const end = Math.min(this.bytes.byteLength, this.offset + Math.max(0, length));
    const slice = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return slice;
  }

  readNullTerminatedString(maxBytes = this.remaining): string {
    const start = this.offset;
    const limit = Math.min(this.bytes.byteLength, start + maxBytes);
    let end = start;
    while (end < limit && this.bytes[end] !== 0) {
      end++;
    }
    const text = decodeUtf8(this.bytes.subarray(start, end));
    this.offset = end < limit && this.bytes[end] === 0 ? end + 1 : end;
    return text;
  }
}

export class BinaryWriter {
  private buffer: Uint8Array;
  private view: DataView;
  length = 0;

  constructor(initialCapacity = 1024) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
  }

  private ensure(additional: number): void {
    const needed = this.length + additional;
    if (needed <= this.buffer.byteLength) return;
    let nextCap = this.buffer.byteLength * 2;
    while (nextCap < needed) nextCap *= 2;
    const next = new Uint8Array(nextCap);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
    this.view = new DataView(this.buffer.buffer);
  }

  writeU8(v: number): void {
    this.ensure(1);
    this.buffer[this.length++] = v & 0xff;
  }

  writeI8(v: number): void {
    this.ensure(1);
    this.view.setInt8(this.length, v);
    this.length += 1;
  }

  writeU16BE(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.length, v & 0xffff, false);
    this.length += 2;
  }

  writeI16BE(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.length, v, false);
    this.length += 2;
  }

  writeU16LE(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.length, v & 0xffff, true);
    this.length += 2;
  }

  writeU24BE(v: number): void {
    this.ensure(3);
    this.buffer[this.length++] = (v >>> 16) & 0xff;
    this.buffer[this.length++] = (v >>> 8) & 0xff;
    this.buffer[this.length++] = v & 0xff;
  }

  writeU32BE(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.length, v >>> 0, false);
    this.length += 4;
  }

  writeI32BE(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.length, v | 0, false);
    this.length += 4;
  }

  writeU32LE(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.length, v >>> 0, true);
    this.length += 4;
  }

  writeI32LE(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.length, v | 0, true);
    this.length += 4;
  }

  writeU64BE(v: number): void {
    this.ensure(8);
    const hi = Math.floor(v / 4294967296) >>> 0;
    const lo = (v - hi * 4294967296) >>> 0;
    this.view.setUint32(this.length, hi, false);
    this.view.setUint32(this.length + 4, lo, false);
    this.length += 8;
  }

  writeI64BE(v: number): void {
    this.ensure(8);
    const big = BigInt(Math.round(v));
    this.view.setBigInt64(this.length, big, false);
    this.length += 8;
  }

  writeF64BE(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.length, v, false);
    this.length += 8;
  }

  writeFixed16_16(v: number): void {
    this.writeI32BE(Math.round(v * 65536));
  }

  writeFixed8_8(v: number): void {
    this.writeI16BE(Math.round(v * 256));
  }

  writeFourCC(fourcc: string): void {
    this.ensure(4);
    for (let i = 0; i < 4; i++) {
      this.buffer[this.length++] = i < fourcc.length ? fourcc.charCodeAt(i) & 0xff : 0x20;
    }
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensure(bytes.byteLength);
    this.buffer.set(bytes, this.length);
    this.length += bytes.byteLength;
  }

  writeZeros(count: number): void {
    this.ensure(count);
    this.buffer.fill(0, this.length, this.length + count);
    this.length += count;
  }

  writeNullTerminatedString(text: string): void {
    const bytes = encodeUtf8(text);
    this.writeBytes(bytes);
    this.writeU8(0);
  }

  toUint8Array(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

export function makeBox(type: string, payload: Uint8Array): Uint8Array {
  const total = 8 + payload.byteLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, total >>> 0, false);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = i < type.length ? type.charCodeAt(i) & 0xff : 0x20;
  }
  out.set(payload, 8);
  return out;
}

export function makeFullBox(
  type: string,
  version: number,
  flags: number,
  payload: Uint8Array
): Uint8Array {
  const total = 12 + payload.byteLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, total >>> 0, false);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = i < type.length ? type.charCodeAt(i) & 0xff : 0x20;
  }
  out[8] = version & 0xff;
  out[9] = (flags >>> 16) & 0xff;
  out[10] = (flags >>> 8) & 0xff;
  out[11] = flags & 0xff;
  out.set(payload, 12);
  return out;
}

/**
 * Unescape H.264/HEVC RBSP emulation prevention bytes (`0x00 0x00 0x03` -> `0x00 0x00`).
 */
export function unescapeRbsp(nalu: Uint8Array): Uint8Array {
  const out = new Uint8Array(nalu.byteLength);
  let j = 0;
  for (let i = 0; i < nalu.byteLength; i++) {
    if (
      i >= 2 &&
      nalu[i] === 0x03 &&
      nalu[i - 1] === 0x00 &&
      nalu[i - 2] === 0x00
    ) {
      continue;
    }
    out[j++] = nalu[i]!;
  }
  return out.subarray(0, j);
}

/**
 * Escape H.264/HEVC RBSP emulation prevention bytes (`0x00 0x00 0x00..0x03` -> `0x00 0x00 0x03 ...`).
 */
export function escapeRbsp(rbsp: Uint8Array): Uint8Array {
  const out = new BinaryWriter(rbsp.byteLength + 16);
  let zeroCount = 0;
  for (let i = 0; i < rbsp.byteLength; i++) {
    const b = rbsp[i]!;
    if (zeroCount === 2 && b <= 0x03) {
      out.writeU8(0x03);
      zeroCount = 0;
    }
    out.writeU8(b);
    if (b === 0x00) {
      zeroCount++;
    } else {
      zeroCount = 0;
    }
  }
  return out.toUint8Array();
}

export class BitReader {
  readonly bytes: Uint8Array;
  bitOffset = 0;

  constructor(bytes: Uint8Array, bitOffset = 0) {
    this.bytes = bytes;
    this.bitOffset = bitOffset;
  }

  get bitsRemaining(): number {
    return Math.max(0, this.bytes.byteLength * 8 - this.bitOffset);
  }

  readBit(): number {
    if (this.bitOffset >= this.bytes.byteLength * 8) return 0;
    const byteIdx = this.bitOffset >>> 3;
    const bitIdx = 7 - (this.bitOffset & 7);
    this.bitOffset++;
    return (this.bytes[byteIdx]! >>> bitIdx) & 1;
  }

  readBits(n: number): number {
    let val = 0;
    for (let i = 0; i < n; i++) {
      val = (val * 2) + this.readBit();
    }
    return val;
  }

  readUE(): number {
    let leadingZeros = 0;
    while (this.readBit() === 0 && leadingZeros < 32 && this.bitsRemaining > 0) {
      leadingZeros++;
    }
    if (leadingZeros === 0) return 0;
    return (1 << leadingZeros) - 1 + this.readBits(leadingZeros);
  }

  readSE(): number {
    const ue = this.readUE();
    const sign = ue & 1 ? 1 : -1;
    return sign * ((ue + 1) >>> 1);
  }

  alignToByte(): void {
    const mod = this.bitOffset & 7;
    if (mod !== 0) {
      this.bitOffset += 8 - mod;
    }
  }
}

export class BitWriter {
  private readonly bytes: number[] = [];
  private currentByte = 0;
  private bitPos = 0; // 0..7

  writeBit(bit: number): void {
    this.currentByte = (this.currentByte << 1) | (bit & 1);
    this.bitPos++;
    if (this.bitPos === 8) {
      this.bytes.push(this.currentByte);
      this.currentByte = 0;
      this.bitPos = 0;
    }
  }

  writeBits(val: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) {
      this.writeBit((val >>> i) & 1);
    }
  }

  writeUE(val: number): void {
    const code = Math.max(0, Math.floor(val)) + 1;
    const bits = 31 - Math.clz32(code);
    for (let i = 0; i < bits; i++) {
      this.writeBit(0);
    }
    this.writeBits(code, bits + 1);
  }

  writeSE(val: number): void {
    const v = Math.floor(val);
    const ue = v <= 0 ? -2 * v : 2 * v - 1;
    this.writeUE(ue);
  }

  alignWithZeroBits(): void {
    while (this.bitPos !== 0) {
      this.writeBit(0);
    }
  }

  writeRbspTrailingBits(): void {
    this.writeBit(1);
    this.alignWithZeroBits();
  }

  toUint8Array(): Uint8Array {
    if (this.bitPos !== 0) {
      const padded = this.currentByte << (8 - this.bitPos);
      return new Uint8Array([...this.bytes, padded]);
    }
    return new Uint8Array(this.bytes);
  }
}

export const IDENTITY_MATRIX: readonly number[] = [
  0x00010000, 0, 0,
  0, 0x00010000, 0,
  0, 0, 0x40000000
];

export function matrixForRotation(degrees: number): readonly number[] {
  const norm = ((degrees % 360) + 360) % 360;
  if (norm === 90) {
    return [0, 0x00010000, 0, -0x00010000, 0, 0, 0, 0, 0x40000000];
  }
  if (norm === 180) {
    return [-0x00010000, 0, 0, 0, -0x00010000, 0, 0, 0, 0x40000000];
  }
  if (norm === 270) {
    return [0, -0x00010000, 0, 0x00010000, 0, 0, 0, 0, 0x40000000];
  }
  return IDENTITY_MATRIX;
}

export function rotationFromMatrix(matrix: readonly number[]): number {
  if (matrix.length < 6) return 0;
  const a = (matrix[0] ?? 0x00010000) / 65536;
  const b = (matrix[1] ?? 0) / 65536;
  const c = (matrix[3] ?? 0) / 65536;
  const d = (matrix[4] ?? 0x00010000) / 65536;
  const angle = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  const norm = ((angle % 360) + 360) % 360;
  if (Math.abs(norm - 90) <= 5 || (a === 0 && b > 0 && c < 0 && d === 0)) return 90;
  if (Math.abs(norm - 180) <= 5) return 180;
  if (Math.abs(norm - 270) <= 5 || (a === 0 && b < 0 && c > 0 && d === 0)) return 270;
  return 0;
}

export function unpackIsoLanguage(packed: number): string {
  if (packed === 0) return "und";
  const c1 = ((packed >>> 10) & 0x1f) + 0x60;
  const c2 = ((packed >>> 5) & 0x1f) + 0x60;
  const c3 = (packed & 0x1f) + 0x60;
  if (c1 < 0x61 || c1 > 0x7a || c2 < 0x61 || c2 > 0x7a || c3 < 0x61 || c3 > 0x7a) {
    return "und";
  }
  return String.fromCharCode(c1, c2, c3);
}

export function packIsoLanguage(lang: string): number {
  const clean = (lang || "und").toLowerCase().padEnd(3, "u").slice(0, 3);
  const c1 = Math.max(1, Math.min(26, clean.charCodeAt(0) - 0x60));
  const c2 = Math.max(1, Math.min(26, clean.charCodeAt(1) - 0x60));
  const c3 = Math.max(1, Math.min(26, clean.charCodeAt(2) - 0x60));
  return (c1 << 10) | (c2 << 5) | c3;
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return Math.abs(Math.round((a / gcd(a, b)) * b));
}

/**
 * Convert RGBA buffer (`width * height * 4`) to planar YUV420p (`Y`, `U`, `V`).
 */
export function rgbaToYuv420p(
  rgba: Uint8Array,
  width: number,
  height: number
): { y: Uint8Array; u: Uint8Array; v: Uint8Array } {
  const yPlane = new Uint8Array(width * height);
  const uvWidth = (width + 1) >>> 1;
  const uvHeight = (height + 1) >>> 1;
  const uPlane = new Uint8Array(uvWidth * uvHeight);
  const vPlane = new Uint8Array(uvWidth * uvHeight);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = (row * width + col) * 4;
      const r = rgba[idx] ?? 0;
      const g = rgba[idx + 1] ?? 0;
      const b = rgba[idx + 2] ?? 0;
      const yVal = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
      yPlane[row * width + col] = Math.max(16, Math.min(235, yVal));
    }
  }

  for (let uRow = 0; uRow < uvHeight; uRow++) {
    for (let uCol = 0; uCol < uvWidth; uCol++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let count = 0;
      for (let dy = 0; dy < 2; dy++) {
        const py = uRow * 2 + dy;
        if (py >= height) continue;
        for (let dx = 0; dx < 2; dx++) {
          const px = uCol * 2 + dx;
          if (px >= width) continue;
          const idx = (py * width + px) * 4;
          rSum += rgba[idx] ?? 0;
          gSum += rgba[idx + 1] ?? 0;
          bSum += rgba[idx + 2] ?? 0;
          count++;
        }
      }
      const r = Math.round(rSum / (count || 1));
      const g = Math.round(gSum / (count || 1));
      const b = Math.round(bSum / (count || 1));
      const uVal = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
      const vVal = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
      uPlane[uRow * uvWidth + uCol] = Math.max(16, Math.min(240, uVal));
      vPlane[uRow * uvWidth + uCol] = Math.max(16, Math.min(240, vVal));
    }
  }

  return { y: yPlane, u: uPlane, v: vPlane };
}

/**
 * Convert planar YUV420p (`Y`, `U`, `V`) to RGBA (`width * height * 4`).
 */
export function yuv420pToRgba(
  yPlane: Uint8Array,
  uPlane: Uint8Array,
  vPlane: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  const uvWidth = (width + 1) >>> 1;

  for (let row = 0; row < height; row++) {
    const uRow = row >>> 1;
    for (let col = 0; col < width; col++) {
      const uCol = col >>> 1;
      const y = (yPlane[row * width + col] ?? 16) - 16;
      const u = (uPlane[uRow * uvWidth + uCol] ?? 128) - 128;
      const v = (vPlane[uRow * uvWidth + uCol] ?? 128) - 128;
      const c = Math.max(0, y) * 298;
      const r = Math.max(0, Math.min(255, (c + 409 * v + 128) >> 8));
      const g = Math.max(0, Math.min(255, (c - 100 * u - 208 * v + 128) >> 8));
      const b = Math.max(0, Math.min(255, (c + 516 * u + 128) >> 8));
      const idx = (row * width + col) * 4;
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = 255;
    }
  }

  return rgba;
}
