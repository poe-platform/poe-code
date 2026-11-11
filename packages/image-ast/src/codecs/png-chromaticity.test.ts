import { expect, it } from "vitest";
import { makeChunk } from "./png-chunks.js";
import { encodePngImage, readPngMetadata } from "./png.js";
import { readPngMetadataFromSource } from "./png-storage.js";

it.each(["valid", "short", "long", "crc", "late", "duplicate"])("reads PNG chromaticity consistently: %s", async variant => {
  const png = encodePngImage({ width: 1, height: 1, data: Uint8Array.of(40, 80, 120, 255) });
  const payload = new Uint8Array(variant === "short" ? 31 : variant === "long" ? 33 : 32);
  const view = new DataView(payload.buffer);
  const coordinates = [31401, 35102, 68003, 32004, 26505, 69006, 15007, 6008];
  coordinates.forEach((value, index) => { if (index * 4 + 4 <= payload.length) view.setUint32(index * 4, value); });
  const chunk = makeChunk("cHRM", payload);
  if (variant === "crc") chunk[chunk.length - 1] = chunk[chunk.length - 1]! ^ 1;
  const position = variant === "late" ? png.length - 12 : 33;
  const duplicate = variant === "duplicate" ? makeChunk("cHRM", new Uint8Array(32)) : new Uint8Array();
  const bytes = Uint8Array.from([...png.subarray(0, position), ...chunk, ...duplicate, ...png.subarray(position)]);
  const expected = variant === "valid" || variant === "duplicate" ? {
    "white-point": [0.31401, 0.35102], "red-primary": [0.68003, 0.32004],
    "green-primary": [0.26505, 0.69006], "blue-primary": [0.15007, 0.06008]
  } : undefined;
  expect(readPngMetadata(bytes).chromaticity).toEqual(expected);
  const metadata = await readPngMetadataFromSource({ size: bytes.length, async read(position, length) { return bytes.subarray(position, position + length); } }, new AbortController().signal);
  expect(metadata.chromaticity).toEqual(expected);
});
