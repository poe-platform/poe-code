import { crc32 } from "@poe-code/office-package";

export function joinBytes(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
export function pngChunk(name: string, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(payload.length + 12), view = new DataView(bytes.buffer);
  view.setUint32(0, payload.length); bytes.set(new TextEncoder().encode(name), 4); bytes.set(payload, 8);
  view.setUint32(bytes.length - 4, crc32(bytes.subarray(4, -4))); return bytes;
}
export function rasterPng(width = 1, height = 1, density?: readonly [number, number, number]): Uint8Array {
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header.set([8, 6], 8);
  const chunks = [pngChunk("IHDR", header)];
  if (density) { const bytes = new Uint8Array(9), v = new DataView(bytes.buffer); v.setUint32(0, density[0]); v.setUint32(4, density[1]); bytes[8] = density[2]; chunks.push(pngChunk("pHYs", bytes)); }
  // One transparent RGBA pixel, stored DEFLATE block and Adler-32.
  chunks.push(pngChunk("IDAT", Uint8Array.of(120, 1, 1, 5, 0, 250, 255, 0, 0, 0, 0, 0, 0, 5, 0, 1)), pngChunk("IEND", new Uint8Array()));
  return joinBytes(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), ...chunks);
}
export function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(payload.length + 4); bytes.set([255, marker]); new DataView(bytes.buffer).setUint16(2, payload.length + 2); bytes.set(payload, 4); return bytes;
}
export function rasterJpeg(width = 2, height = 3, density: readonly [number, number, number] = [0, 1, 1], exif?: Uint8Array): Uint8Array {
  const jfif = Uint8Array.of(74, 70, 73, 70, 0, 1, 2, density[0], 0, 0, 0, 0, 0, 0);
  const v = new DataView(jfif.buffer); v.setUint16(8, density[1]); v.setUint16(10, density[2]);
  const frame = Uint8Array.of(8, 0, 0, 0, 0, 1, 1, 17, 0), frameView = new DataView(frame.buffer);
  frameView.setUint16(1, height); frameView.setUint16(3, width);
  return joinBytes(Uint8Array.of(255, 216), jpegSegment(224, jfif), ...(exif ? [jpegSegment(225, joinBytes(Uint8Array.of(69, 120, 105, 102, 0, 0), exif))] : []), jpegSegment(192, frame), jpegSegment(218, Uint8Array.of(1, 1, 0, 0, 63, 0)), Uint8Array.of(0, 255, 217));
}
export function rasterGif(version = "89a"): Uint8Array {
  return joinBytes(new TextEncoder().encode("GIF" + version), Uint8Array.of(1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59));
}
export function rasterBmp(width = 1, height = -1, x = 0, y = 0): Uint8Array {
  const bytes = new Uint8Array(58), view = new DataView(bytes.buffer); bytes.set([66, 77]);
  view.setUint32(2, 58, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, width, true); view.setInt32(22, height, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true);
  view.setUint32(34, 4, true); view.setInt32(38, x, true); view.setInt32(42, y, true); bytes.set([30, 90, 120], 54); return bytes;
}
export function rasterTiff(little = true, unit = 2, x: readonly [number, number] = [144, 1], y: readonly [number, number] = [72, 1]): Uint8Array {
  const bytes = new Uint8Array(91), v = new DataView(bytes.buffer); bytes.set(little ? [73, 73] : [77, 77]); v.setUint16(2, 42, little); v.setUint32(4, 8, little); v.setUint16(8, 5, little);
  const entry = (index: number, tag: number, type: number, value: number) => { const offset = 10 + index * 12; v.setUint16(offset, tag, little); v.setUint16(offset + 2, type, little); v.setUint32(offset + 4, 1, little); if (type === 3) v.setUint16(offset + 8, value, little); else v.setUint32(offset + 8, value, little); };
  entry(0, 256, 4, 1); entry(1, 257, 4, 1); entry(2, 282, 5, 74); entry(3, 283, 5, 82); entry(4, 296, 3, unit);
  v.setUint32(74, x[0], little); v.setUint32(78, x[1], little); v.setUint32(82, y[0], little); v.setUint32(86, y[1], little); bytes[90] = 80; return bytes;
}
