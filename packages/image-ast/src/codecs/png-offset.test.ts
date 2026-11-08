import { expect, it } from "vitest";
import { canvasChunk, makeChunk } from "./png-chunks.js";
import { encodePngImage, readPngMetadata } from "./png.js";
import { readPngMetadataFromSource } from "./png-storage.js";

it.each([
  { x: 2, y: 3, unit: 0 },
  { x: -2, y: -3, unit: 0 },
  { x: 0, y: 0, unit: 0 },
  { x: 2, y: 3, unit: 1 },
])("reads signed pixel offsets without treating micrometers as pixels: %j", async ({ x, y, unit }) => {
  const png = encodePngImage({ width: 4, height: 1, data: new Uint8Array(16) });
  const payload = new Uint8Array(9), view = new DataView(payload.buffer);
  view.setInt32(0, x); view.setInt32(4, y); payload[8] = unit;
  for (const length of [8, 9, 10]) {
    const data = new Uint8Array(length); data.set(payload.subarray(0, length));
    const bytes = Uint8Array.from([...png.subarray(0, 33), ...makeChunk("oFFs", data), ...png.subarray(33)]);
    const expected = length === 9 && unit === 0 ? { width: 4, height: 1, x, y } : undefined;
    expect(readPngMetadata(bytes).virtualCanvas).toEqual(expected);
    const metadata = await readPngMetadataFromSource({ size: bytes.length, async read(position, count) { return bytes.subarray(position, position + count); } }, new AbortController().signal);
    expect(metadata.virtualCanvas).toEqual(expected);
  }
});

it.each([false, true])("uses pixel offsets with caNv dimensions regardless of chunk order: %s", offsetFirst => {
  const png = encodePngImage({ width: 4, height: 1, data: new Uint8Array(16) });
  const payload = new Uint8Array(9), view = new DataView(payload.buffer);
  view.setInt32(0, -2); view.setInt32(4, -3);
  const offset = makeChunk("oFFs", payload);
  const canvas = canvasChunk({ width: 20, height: 10, x: 7, y: 8 });
  const chunks = offsetFirst ? [...offset, ...canvas] : [...canvas, ...offset];
  const bytes = Uint8Array.from([...png.subarray(0, 33), ...chunks, ...png.subarray(33)]);
  expect(readPngMetadata(bytes).virtualCanvas).toEqual({ width: 20, height: 10, x: -2, y: -3 });
});
