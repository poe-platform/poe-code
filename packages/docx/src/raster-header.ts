import { crc32 } from "@poe-code/office-package";
import { archiveSettings, InputTypeError, ResourceLimitError, type ArchiveContext } from "./archive.js";
import { UnsupportedEditError } from "./xml-write.js";
import type { DocumentBudget } from "./budget.js";

export interface RasterHeader {
  readonly mime: "image/png" | "image/jpeg" | "image/gif" | "image/bmp" | "image/tiff";
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly horizontalDpi: number | null;
  readonly verticalDpi: number | null;
}
type Density = { horizontalDpi: number | null; verticalDpi: number | null };
function unsupported(): never { throw new UnsupportedEditError("Raster header or density metadata is invalid or unsupported."); }

class HeaderReader {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array, readonly budget: DocumentBudget) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  interval(offset: number, length: number): void {
    this.budget.charge("work", 1);
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > this.bytes.length || length > this.bytes.length - offset) unsupported();
  }
  u16(offset: number, little = false): number { this.interval(offset, 2); return this.view.getUint16(offset, little); }
  u32(offset: number, little = false): number { this.interval(offset, 4); return this.view.getUint32(offset, little); }
  i32(offset: number): number { this.interval(offset, 4); return this.view.getInt32(offset, true); }
  text(offset: number, length: number): string { this.interval(offset, length); let text = ""; for (let i = offset; i < offset + length; i++) text += String.fromCharCode(this.bytes[i]!); return text; }
}
function dimensions(width: number, height: number, maximum = 0xffffffff): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > maximum || height > maximum) unsupported();
}
function density(x: number | null, y: number | null, factor: number): Density {
  const axis = (value: number | null): number | null => { if (value === null || value === 0) return null; const dpi = value * factor; if (value < 0 || !Number.isFinite(dpi) || dpi <= 0) unsupported(); return dpi; };
  return { horizontalDpi: axis(x), verticalDpi: axis(y) };
}
function mergeDensity(before: Density, after: Density): Density {
  const merge = (a: number | null, b: number | null) => { if (a !== null && b !== null && a !== b) unsupported(); return b ?? a; };
  return { horizontalDpi: merge(before.horizontalDpi, after.horizontalDpi), verticalDpi: merge(before.verticalDpi, after.verticalDpi) };
}

function png(reader: HeaderReader): RasterHeader {
  let offset = 8, width = 0, height = 0, color = 0, depth = 0, sawData = false, dataLength = 0, closedData = false, sawPalette = false, sawDensity = false, ended = false;
  let dpi: Density = { horizontalDpi: null, verticalDpi: null };
  while (offset < reader.bytes.length) {
    reader.interval(offset, 12); const length = reader.u32(offset); reader.interval(offset + 8, length + 4);
    const name = reader.text(offset + 4, 4), start = offset + 8;
    if ([...name].some(c => !(c >= "A" && c <= "Z") && !(c >= "a" && c <= "z")) || name[2]! >= "a") unsupported();
    reader.budget.charge("work", length + 4);
    if (crc32(reader.bytes.subarray(offset + 4, start + length)) !== reader.u32(start + length)) unsupported();
    if (name === "IHDR") {
      if (offset !== 8 || length !== 13) unsupported(); width = reader.u32(start); height = reader.u32(start + 4); dimensions(width, height, 0x7fffffff);
      depth = reader.bytes[start + 8]!; color = reader.bytes[start + 9]!;
      const depths: Readonly<Record<number, readonly number[]>> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color!]?.includes(depth!) || reader.bytes[start + 10] !== 0 || reader.bytes[start + 11] !== 0 || ![0, 1].includes(reader.bytes[start + 12]!)) unsupported();
    } else if (!width) unsupported();
    else if (name === "PLTE") {
      if (sawPalette || sawData || color === 0 || color === 4 || length === 0 || length > 768 || length % 3 !== 0 || color === 3 && length / 3 > 2 ** depth) unsupported();
      sawPalette = true;
    }
    else if (name === "pHYs") {
      if (length !== 9 || sawData || sawDensity) unsupported(); sawDensity = true;
      const unit = reader.bytes[start + 8]; if (unit !== 0 && unit !== 1) unsupported();
      if (unit === 1) dpi = density(reader.u32(start), reader.u32(start + 4), 0.0254);
    } else if (name === "IDAT") { if (closedData || color === 3 && !sawPalette) unsupported(); sawData = true; dataLength += length; }
    else if (name === "IEND") { if (length !== 0 || !sawData || dataLength === 0 || start + 4 !== reader.bytes.length) unsupported(); ended = true; }
    else if (name[0]! >= "A" && name[0]! <= "Z") unsupported();
    if (sawData && name !== "IDAT") closedData = true;
    offset = start + length + 4;
  }
  if (!ended) unsupported(); return { mime: "image/png", pixelWidth: width, pixelHeight: height, ...dpi };
}

interface TiffMetadata extends Density { width: number | null; height: number | null; }
function tiff(reader: HeaderReader, base = 0, length = reader.bytes.length): TiffMetadata {
  reader.interval(base, length); if (length < 8) unsupported();
  const byteOrder = reader.text(base, 2), little = byteOrder === "II";
  if (byteOrder !== "II" && byteOrder !== "MM" || reader.u16(base + 2, little) !== 42) unsupported();
  const check = (offset: number, size: number) => { if (offset < 0 || offset > length || size > length - offset) unsupported(); reader.interval(base + offset, size); };
  const u16 = (offset: number) => { check(offset, 2); return reader.u16(base + offset, little); };
  const u32 = (offset: number) => { check(offset, 4); return reader.u32(base + offset, little); };
  const pending = [u32(4)], visited = new Set<number>(), values = new Map<number, number | readonly [number, number]>();
  const sizes: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  while (pending.length) {
    const offset = pending.pop()!; if (!offset) continue; if (offset < 8) unsupported();
    if (visited.has(offset)) unsupported(); reader.budget.charge("retainedBytes", 32); visited.add(offset);
    const count = u16(offset); check(offset + 2, count * 12 + 4);
    for (let i = 0; i < count; i++) {
      reader.budget.charge("work", 12); const start = offset + 2 + i * 12;
      const tag = u16(start), type = u16(start + 2), items = u32(start + 4), size = sizes[type];
      if (!size || items === 0) unsupported(); const total = items * size; if (!Number.isSafeInteger(total)) unsupported();
      const address = total <= 4 ? start + 8 : u32(start + 8); if (total > 4 && address < 8) unsupported(); check(address, total);
      if (![256, 257, 282, 283, 296, 34665].includes(tag)) continue;
      if (items !== 1) unsupported(); let value: number | readonly [number, number];
      if (tag === 282 || tag === 283) { if (type !== 5) unsupported(); value = [u32(address), u32(address + 4)]; }
      else { if (type !== 3 && type !== 4 || tag === 34665 && type !== 4 || tag === 296 && type !== 3) unsupported(); value = type === 3 ? u16(address) : u32(address); }
      const before = values.get(tag); if (before !== undefined && JSON.stringify(before) !== JSON.stringify(value)) unsupported();
      reader.budget.charge("retainedBytes", 32); values.set(tag, value);
      if (tag === 34665) { if (!value) unsupported(); reader.budget.charge("retainedBytes", 8); pending.push(value as number); }
    }
    const next = u32(offset + 2 + count * 12); if (next) { reader.budget.charge("retainedBytes", 8); pending.push(next); }
  }
  const unit = values.get(296) ?? 2; if (unit !== 1 && unit !== 2 && unit !== 3) unsupported();
  const resolution = (tag: number): number | null => {
    const value = values.get(tag); if (!value) return null; if (!Array.isArray(value) || value[1] === 0) unsupported();
    if (unit === 1) return null; const result = value[0] / value[1] * (unit === 3 ? 2.54 : 1);
    if (value[0] === 0 || !Number.isFinite(result) || result <= 0) unsupported(); return result;
  };
  return { width: values.get(256) as number ?? null, height: values.get(257) as number ?? null, horizontalDpi: resolution(282), verticalDpi: resolution(283) };
}

function jpeg(reader: HeaderReader): RasterHeader {
  let offset = 2, width = 0, height = 0, sawScan = false;
  let dpi: Density = { horizontalDpi: null, verticalDpi: null };
  const frames = new Set([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207]);
  while (offset < reader.bytes.length) {
    reader.interval(offset, 2); if (reader.bytes[offset] !== 255) unsupported();
    while (reader.bytes[offset] === 255) { reader.interval(offset, 1); offset++; }
    reader.interval(offset, 1); const marker = reader.bytes[offset++]!;
    if (marker === 217) break;
    if (marker === 216 || marker === 0 || marker >= 208 && marker <= 215) unsupported();
    if (marker === 1) continue;
    const length = reader.u16(offset); if (length < 2) unsupported(); reader.interval(offset, length); const start = offset + 2, payload = length - 2;
    if (marker === 224 && payload >= 5 && reader.text(start, 5) === "JFIF\0") {
      if (payload < 14) unsupported(); const unit = reader.bytes[start + 7]; if (unit !== 0 && unit !== 1 && unit !== 2) unsupported();
      const thumbnail = reader.bytes[start + 12]! * reader.bytes[start + 13]! * 3; if (thumbnail > payload - 14) unsupported();
      if (unit) dpi = mergeDensity(dpi, density(reader.u16(start + 8), reader.u16(start + 10), unit === 2 ? 2.54 : 1));
    } else if (marker === 225 && payload >= 6 && reader.text(start, 6) === "Exif\0\0") {
      dpi = mergeDensity(dpi, tiff(reader, start + 6, payload - 6));
    } else if (frames.has(marker)) {
      if (payload < 6 || reader.bytes[start] !== 8 || !reader.bytes[start + 5] || payload !== 6 + reader.bytes[start + 5]! * 3) unsupported();
      const h = reader.u16(start + 1), w = reader.u16(start + 3); dimensions(w, h, 65535);
      if (width && (width !== w || height !== h)) unsupported(); width = w; height = h;
    } else if (marker === 218) {
      if (!width || payload < 4 || !reader.bytes[start] || payload !== 4 + reader.bytes[start]! * 2) unsupported();
      sawScan = true; break;
    }
    offset += length;
  }
  if (!width || !sawScan || reader.bytes.length < 2 || reader.u16(reader.bytes.length - 2) !== 0xffd9) unsupported();
  return { mime: "image/jpeg", pixelWidth: width, pixelHeight: height, ...dpi };
}

export function characterizeRasterHeader(input: Uint8Array, context: ArchiveContext): RasterHeader {
  const { limits, budget } = archiveSettings(context);
  if (!(input instanceof Uint8Array)) throw new InputTypeError("Expected raster bytes.");
  budget.check("embeddedMediaBytes", input.length);
  if (input.length > limits.maxEntryBytes) throw new ResourceLimitError("Raster entry byte limit exceeded.");
  budget.charge("work", input.length); budget.charge("retainedBytes", 128);
  const reader = new HeaderReader(input, budget), begins = (...bytes: number[]) => input.length >= bytes.length && bytes.every((value, index) => input[index] === value);
  if (begins(137, 80, 78, 71, 13, 10, 26, 10)) return png(reader);
  if (begins(255, 216)) return jpeg(reader);
  if (begins(71, 73, 70, 56, 55, 97) || begins(71, 73, 70, 56, 57, 97)) {
    reader.interval(0, 13); const width = reader.u16(6, true), height = reader.u16(8, true); dimensions(width, height, 65535);
    const packed = input[10]!; if (packed & 128) reader.interval(13, 3 * 2 ** ((packed & 7) + 1));
    return { mime: "image/gif", pixelWidth: width, pixelHeight: height, horizontalDpi: null, verticalDpi: null };
  }
  if (begins(66, 77)) {
    reader.interval(0, 18); const size = reader.u32(14, true); if (size < 40) unsupported(); reader.interval(14, size);
    const width = reader.i32(18), height = reader.i32(22); if (width <= 0 || height === 0 || reader.u16(26, true) !== 1) unsupported(); dimensions(width, Math.abs(height));
    const pixelOffset = reader.u32(10, true); if (pixelOffset < 14 + size || pixelOffset > input.length) unsupported();
    return { mime: "image/bmp", pixelWidth: width, pixelHeight: Math.abs(height), ...density(reader.i32(38), reader.i32(42), 0.0254) };
  }
  if (begins(73, 73, 42, 0) || begins(77, 77, 0, 42)) {
    const metadata = tiff(reader); if (metadata.width === null || metadata.height === null) unsupported(); dimensions(metadata.width, metadata.height);
    return { mime: "image/tiff", pixelWidth: metadata.width, pixelHeight: metadata.height, horizontalDpi: metadata.horizontalDpi, verticalDpi: metadata.verticalDpi };
  }
  unsupported();
}
