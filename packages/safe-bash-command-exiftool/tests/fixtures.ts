import { pngChunk } from "../src/png.js";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function fixture(...titles: string[]): Uint8Array {
  // Original one-pixel image chunks: independent fixture bytes, not the writer.
  const base = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII="), character => character.charCodeAt(0));
  // Repair the fixture's supplied IDAT checksum.
  new DataView(base.buffer).setUint32(52, crc32(base.subarray(37, 52)));
  const texts = titles.map(title => pngChunk("tEXt", new TextEncoder().encode("Title\0" + title)));
  const chunks = [base.subarray(0,33), ...texts, base.subarray(33)];
  const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
