import { crc32 } from "node:zlib";
import { pngChunk } from "./png.js";
export function fixture(...titles: string[]): Uint8Array {
  // Original one-pixel image chunks: independent fixture bytes, not the writer.
  const base = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=", "base64");
  // Repair the fixture's supplied IDAT checksum using an independent oracle.
  base.writeUInt32BE(crc32(base.subarray(37, 52)), 52);
  const texts = titles.map(title => pngChunk("tEXt", new TextEncoder().encode("Title\0" + title)));
  return new Uint8Array(Buffer.concat([base.subarray(0,33), ...texts, base.subarray(33)]));
}
