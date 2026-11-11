import type { MediaBudgetTracker } from "@poe-code/mp4-ast";

/** Find one encoded packet without mistaking signatures inside pixel data for frames. */
export function imagePipeFrameEnd(bytes: Uint8Array, start: number, decoder: string | undefined, budget: MediaBudgetTracker): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const codec = decoder ?? (bytes[start] === 137 ? "png" : bytes[start] === 66 ? "bmp"
    : bytes[start] === 113 ? "qoi" : bytes[start] === 255 ? "mjpeg"
    : bytes[start + 1] === 53 || bytes[start + 1] === 50 ? "pgm" : "ppm");
  const invalid = () => new Error(`Invalid or truncated image2pipe ${codec} frame`);
  const requireBytes = (offset: number, length: number) => {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) throw invalid();
  };
  let offset = start;
  if (codec === "png") {
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[start + i] === byte)) throw invalid();
    offset += 8;
    for (;;) {
      budget.checkCpu();
      requireBytes(offset, 12);
      const length = view.getUint32(offset);
      const end = view.getUint32(offset + 4) === 0x49454e44;
      requireBytes(offset, length + 12);
      offset += length + 12;
      if (end) {
        if (length !== 0) throw invalid();
        return offset;
      }
    }
  }
  if (codec === "bmp") {
    requireBytes(start, 14);
    if (bytes[start] !== 66 || bytes[start + 1] !== 77) throw invalid();
    const length = view.getUint32(start + 2, true);
    if (length < 14) throw invalid();
    requireBytes(start, length);
    return start + length;
  }
  if (codec === "ppm" || codec === "pgm") {
    const magic = bytes[start + 1];
    if (bytes[start] !== 80 || !(codec === "ppm" ? [51, 54] : [50, 53]).includes(magic!)) throw invalid();
    offset += 2;
    const whitespace = (byte: number | undefined) => byte === 32 || byte !== undefined && byte >= 9 && byte <= 13;
    const number = () => {
      while (offset < bytes.length) {
        budget.checkCpu();
        if (bytes[offset] === 35) {
          while (offset < bytes.length && bytes[offset] !== 10 && bytes[offset] !== 13) { budget.checkCpu(); offset++; }
        } else if (whitespace(bytes[offset])) offset++;
        else break;
      }
      const begin = offset;
      let value = 0;
      while (offset < bytes.length && bytes[offset]! >= 48 && bytes[offset]! <= 57) {
        budget.checkCpu();
        value = value * 10 + bytes[offset++]! - 48;
        if (!Number.isSafeInteger(value)) throw invalid();
      }
      if (offset === begin || offset < bytes.length && !whitespace(bytes[offset]) && bytes[offset] !== 35) throw invalid();
      return value;
    };
    const width = number(), height = number(), max = number();
    const samples = width * height * (codec === "ppm" ? 3 : 1);
    if (!width || !height || !Number.isSafeInteger(samples) || max < 1 || max > 65535) throw invalid();
    if (magic === 53 || magic === 54) {
      if (!whitespace(bytes[offset])) throw invalid();
      offset += bytes[offset] === 13 && bytes[offset + 1] === 10 ? 2 : 1;
      const length = samples * (max > 255 ? 2 : 1);
      requireBytes(offset, length);
      return offset + length;
    }
    for (let i = 0; i < samples; i++) {
      budget.checkCpu();
      if (number() > max) throw invalid();
    }
    while (whitespace(bytes[offset])) { budget.checkCpu(); offset++; }
    return offset;
  }
  if (codec === "qoi") {
    requireBytes(start, 14);
    if (view.getUint32(start) !== 0x716f6966) throw invalid();
    const width = view.getUint32(start + 4), height = view.getUint32(start + 8);
    const pixels = width * height;
    if (!width || !height || !Number.isSafeInteger(pixels) || ![3, 4].includes(bytes[start + 12]!) || bytes[start + 13]! > 1) throw invalid();
    offset += 14;
    for (let count = 0; count < pixels;) {
      budget.checkCpu();
      requireBytes(offset, 1);
      const op = bytes[offset++]!;
      const length = op === 254 ? 3 : op === 255 ? 4 : (op & 192) === 128 ? 1 : 0;
      requireBytes(offset, length);
      offset += length;
      count += op < 254 && (op & 192) === 192 ? (op & 63) + 1 : 1;
      if (count > pixels) throw invalid();
    }
    requireBytes(offset, 8);
    for (let i = 0; i < 8; i++) if (bytes[offset + i] !== (i === 7 ? 1 : 0)) throw invalid();
    return offset + 8;
  }
  if (codec === "mjpeg") {
    if (bytes[start] !== 255 || bytes[start + 1] !== 216) throw invalid();
    offset += 2;
    let scan = false;
    for (;;) {
      budget.checkCpu();
      requireBytes(offset, 2);
      if (bytes[offset++] !== 255) {
        if (scan) continue;
        throw invalid();
      }
      while (bytes[offset] === 255) { budget.checkCpu(); offset++; }
      requireBytes(offset, 1);
      const marker = bytes[offset++]!;
      if (scan && (marker === 0 || marker >= 208 && marker <= 215)) continue;
      if (marker === 217) return offset;
      if (marker === 216 || marker === 0) throw invalid();
      if (marker === 1) continue;
      requireBytes(offset, 2);
      const length = view.getUint16(offset);
      if (length < 2) throw invalid();
      requireBytes(offset, length);
      offset += length;
      scan = marker === 218;
    }
  }
  throw new Error(`Unsupported image2pipe decoder '${codec}'`);
}
