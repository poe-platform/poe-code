import {Inflate} from "pako";
import {PdfError} from "./errors.js";
const invalid = (message: string): never => {throw new PdfError("E_CAPABILITY", message);};
function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {value ^= byte; for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;}
  return (value ^ 0xffffffff) >>> 0;
}
/** Static noninterlaced 8-bit PNG only; caller admits buffers before entering. */
export function decodePng(bytes: Uint8Array, work: (amount: number) => void): {width: number; height: number; rgb: Uint8Array; alpha?: Uint8Array} {
  work(bytes.length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b)) invalid("Invalid PNG signature");
  let width = 0; let height = 0; let channels = 0; let color = -1;
  let palette: Uint8Array | undefined; let transparency: Uint8Array | undefined;
  const data: Uint8Array[] = []; let ended = false; let afterData = false;
  for (let offset = 8; offset < bytes.length;) {
    work(1);
    if (offset + 12 > bytes.length) invalid("Truncated PNG chunk");
    const length = view.getUint32(offset); const end = offset + 12 + length;
    if (end > bytes.length) invalid("Invalid PNG chunk length");
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (crc(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) invalid("Invalid PNG CRC");
    const chunk = bytes.subarray(offset + 8, end - 4);
    if (offset === 8 && name !== "IHDR") invalid("PNG header must be first");
    if (name === "IHDR") {
      if (offset !== 8 || length !== 13) invalid("Invalid PNG header");
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12); color = chunk[9]!;
      channels = color === 0 || color === 3 ? 1 : color === 2 ? 3 : color === 4 ? 2 : color === 6 ? 4 : 0;
      if (!width || !height || !channels || chunk[8] !== 8 || chunk[10] !== 0 || chunk[11] !== 0 || chunk[12] !== 0) invalid("Only noninterlaced static 8-bit PNG is supported");
    } else if (name === "PLTE") {
      if (palette || data.length || !length || length > 768 || length % 3) invalid("Invalid PNG palette"); palette = chunk;
    } else if (name === "tRNS") {
      if (transparency || data.length || color === 4 || color === 6 || (color === 0 && length !== 2) || (color === 2 && length !== 6) || (color === 3 && (!palette || length > palette.length / 3))) invalid("Invalid PNG transparency"); transparency = chunk;
    } else if (name === "IDAT") {
      if (afterData) invalid("Noncontiguous PNG data"); data.push(chunk);
    } else if (name === "IEND") {
      if (length || !data.length || end !== bytes.length) invalid("Invalid PNG end"); ended = true;
    } else {
      if (["acTL", "fcTL", "fdAT"].includes(name) || name[0]! >= "A" && name[0]! <= "Z") invalid("Unsupported PNG chunk");
      if (data.length) afterData = true;
    }
    offset = end;
  }
  if (!ended || color === 3 && !palette) invalid("Incomplete PNG");
  const stride = width * channels; const expected = (stride + 1) * height;
  if (!Number.isSafeInteger(expected) || expected > 20_000_000) throw new PdfError("E_LIMIT", "PNG scanline limit exceeded");
  work(expected);
  const raw = new Uint8Array(expected); let used = 0;
  const inflater = new Inflate({chunkSize: Math.min(16384, expected + 1), windowBits: 15});
  inflater.onData = chunk => {
    if (chunk.length > expected - used) throw new PdfError("E_LIMIT", "PNG inflation exceeds declared scanlines");
    raw.set(chunk, used); used += chunk.length;
  };
  for (let i = 0; i < data.length; i++) {
    if (inflater.ended && data[i]!.length) invalid("Trailing PNG compressed data");
    if (!inflater.push(data[i]!, i + 1 === data.length)) invalid("Invalid PNG compression");
  }
  if (!inflater.ended || inflater.err || used !== expected) invalid("Truncated PNG scanlines");
  for (let row = 0; row < height; row++) {
    const at = row * (stride + 1); const filter = raw[at]!; if (filter > 4) invalid("Invalid PNG row filter");
    for (let i = 0; i < stride; i++) {
      const index = at + 1 + i;
      const left = i >= channels ? raw[index - channels]! : 0;
      const up = row ? raw[index - stride - 1]! : 0;
      const corner = row && i >= channels ? raw[index - stride - 1 - channels]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - corner; const a = Math.abs(p - left); const b = Math.abs(p - up); const c = Math.abs(p - corner);
        predictor = a <= b && a <= c ? left : b <= c ? up : corner;
      }
      raw[index] = (raw[index]! + predictor) & 255;
    }
  }
  const pixels = width * height; const rgb = new Uint8Array(pixels * 3);
  const alpha = color === 4 || color === 6 || transparency ? new Uint8Array(pixels) : undefined;
  const transparent = transparency ? new DataView(transparency.buffer, transparency.byteOffset, transparency.byteLength) : undefined;
  for (let i = 0; i < pixels; i++) {
    const at = Math.floor(i / width) * (stride + 1) + 1 + i % width * channels;
    const r = raw[at]!; const g = raw[at + 1]!; const b = raw[at + 2]!;
    if (color === 3) {
      if (r >= palette!.length / 3) invalid("Invalid PNG palette index"); rgb.set(palette!.subarray(r * 3, r * 3 + 3), i * 3);
    } else {rgb[i * 3] = r; rgb[i * 3 + 1] = color === 0 || color === 4 ? r : g; rgb[i * 3 + 2] = color === 0 || color === 4 ? r : b;}
    if (alpha) alpha[i] = color === 4 ? g : color === 6 ? raw[at + 3]! : color === 3 ? transparency![r] ?? 255 : color === 0 ? r === transparent!.getUint16(0) ? 0 : 255 : r === transparent!.getUint16(0) && g === transparent!.getUint16(2) && b === transparent!.getUint16(4) ? 0 : 255;
  }
  return {width, height, rgb, ...(alpha === undefined ? {} : {alpha})};
}
