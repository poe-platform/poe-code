import { expect, it } from "vitest";
import type { RgbaImage } from "../ast.js";
import { transformStoredImage } from "./storage.js";
import { extractChannelImage } from "./transform.js";

it.each([0, 1, 2, 3] as const)("extracts 16-bit channel %i across borrowed storage chunks without changing the input", async channel => {
  const data16 = Uint16Array.from({ length: 1031 * 4 }, (_, index) => (index * 7919) % 65536);
  const data = Uint8Array.from(data16, value => Math.round(value / 257));
  const image: RgbaImage = { width: 1031, height: 1, data, data16, format: "png", space: "srgb",
    channels: 4, depth: "ushort", hasAlpha: true };
  const expected = Uint16Array.from(data16, (_, index) => index % 4 === 3 ? 65535 : data16[index - index % 4 + channel]!);
  const result = extractChannelImage(image, channel);
  expect(result.data16).toEqual(expected);
  const memory = new Uint8Array(data.length * 6);
  memory.set(data);
  memory.set(new Uint8Array(data16.buffer), data.length);
  const original = memory.slice(0, data.length * 3);
  const borrowed = new Uint8Array(8192);
  let end = original.length;
  const storage = {
    allocate(length: number) { const position = end; end += length; return position; },
    async read(position: number, length: number) {
      borrowed.fill(0);
      borrowed.set(memory.subarray(position, position + length));
      return borrowed.subarray(0, length);
    },
    async write(position: number, bytes: Uint8Array) { memory.set(bytes, position); }
  };
  const { data: ignoredData, data16: ignoredData16, ...metadata } = image;
  const stored = await transformStoredImage({ ...metadata, position: 0,
    storedData16: { position: data.length, length: data16.length } }, storage,
    { kind: "extractChannel", channel }, new AbortController().signal);
  expect(stored.storedData16?.length).toBe(data16.length);
  expect(new Uint16Array(memory.slice(stored.storedData16!.position, stored.storedData16!.position + data16.byteLength).buffer)).toEqual(expected);
  expect(memory.slice(stored.position, stored.position + data.length)).toEqual(result.data);
  expect(memory.slice(0, original.length)).toEqual(original);
});
