import type {ImageMetadata} from "../ast.js";
import {ByteCodecError, createByteCodec, transformBytes} from "@poe-code/compression";
export const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function pngCrc32(data: Uint8Array, crc = 0): number {
  let c = crc ^ 0xffffffff;
  for (const byte of data) {
    c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}


export function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3)
  ]);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, pngCrc32(data, pngCrc32(typeBytes)), false);
  if (type === "IDAT" && data.byteOffset === 0 && typeof (data.buffer as any).transfer === "function") {
    try { (data.buffer as any).transfer(0); } catch { /* Buffer detachment is best-effort; ordinary garbage collection remains available. */ }
  }
  return out;
}

export function canvasChunk(canvas: { width: number; height: number; x: number; y: number }): Uint8Array {
  const bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
  view.setUint32(0, canvas.width); view.setUint32(4, canvas.height);
  view.setInt32(8, canvas.x); view.setInt32(12, canvas.y);
  return makeChunk("caNv", bytes);
}

export function* textChunks(properties: Readonly<Record<string, string>> | undefined): Generator<Uint8Array> {
  for (const [key, value] of Object.entries(properties ?? {})) {
    const keyword = Uint8Array.from(key, char => char.charCodeAt(0));
    if (!key.length || key.length > 79 || [...key].some(char => char.charCodeAt(0) > 255 || char === "\0")) continue;
    const text = new TextEncoder().encode(value), payload = new Uint8Array(keyword.length + 5 + text.length);
    payload.set(keyword); payload.set(text, keyword.length + 5);
    yield makeChunk("iTXt", payload);
  }
}

export function xmpChunk(xmp: Uint8Array): Uint8Array {
  const header = new TextEncoder().encode("XML:com.adobe.xmp\0\0\0\0\0");
  const payload = new Uint8Array(header.length + xmp.length);
  payload.set(header);
  payload.set(xmp, header.length);
  return makeChunk("iTXt", payload);
}

export function iccChunk(icc: Uint8Array): Uint8Array {
  const compressed = transformBytes(icc, {direction:"encode",format:"zlib"});
  const payload = new Uint8Array(5 + compressed.length);
  payload.set([73, 67, 67, 0, 0]);
  payload.set(compressed, 5);
  return makeChunk("iCCP", payload);
}

export function decodePngIcc(compressed: Uint8Array): Uint8Array {
  let format: "zlib" | "raw" = "zlib";
  while (true) {
    const codec = createByteCodec({direction:"decode",format});
    const parts: Uint8Array[] = []; let length = 0;
    try {
      for (const part of codec.push(compressed, true)) {
        length += part.length;
        if (length > 16 * 1024 * 1024) throw new Error("ICC profile exceeds 16 MiB");
        parts.push(part);
      }
      const icc = new Uint8Array(length); let offset = 0;
      for (const part of parts) { icc.set(part, offset); offset += part.length; }
      return icc;
    } catch (error) {
      if (format !== "zlib" || !(error instanceof ByteCodecError) || error.message !== "incorrect data check") throw error;
      // ImageMagick/libpng retains iCCP profiles with a bad Adler checksum.
      // Reaching this error validates the zlib header and complete DEFLATE stream.
      // Retry only that stream, with the same output limit; other codecs stay strict.
      compressed = compressed.subarray(2, codec.consumed - 4);
      format = "raw";
    } finally { codec.close(); }
  }
}

export function chromaticityChunk(chromaticity: NonNullable<ImageMetadata["chromaticity"]>): Uint8Array {
  const coordinates = [...(chromaticity["white-point"] ?? [0.3127, 0.329]), ...(chromaticity["red-primary"] ?? [0.64, 0.33]), ...(chromaticity["green-primary"] ?? [0.3, 0.6]), ...(chromaticity["blue-primary"] ?? [0.15, 0.06])];
  const bytes = new Uint8Array(32), view = new DataView(bytes.buffer);
  coordinates.forEach((value, index) => view.setUint32(index * 4, Math.round(value * 100000)));
  return makeChunk("cHRM", bytes);
}

export function gammaChunk(gamma: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, Math.round(gamma * 100000));
  return makeChunk("gAMA", bytes);
}

export function validPngTransparencyLength(colorType: number, length: number, paletteLength = 0): boolean {
  return colorType === 0 ? length === 2
    : colorType === 2 ? length === 6
    : colorType === 3 && length > 0 && length <= paletteLength / 3;
}
