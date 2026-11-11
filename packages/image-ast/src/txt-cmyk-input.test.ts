import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";
import { readTxtFromSource } from "./codecs/txt.js";

it.each([false, true])("preserves CMYK samples, alpha, and precision across storage chunks (reordered=%s)", async reordered => {
  const count = 1025;
  const rows = Array.from({ length: count }, (_, y) => `0,${y}: (12345,23456,34567,45678,${56789 + y})\n`);
  if (reordered) rows.reverse();
  const bytes = new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,${count},0,65535,cmyka\n` + rows.join(""));
  expect(readImageMetadata(bytes)).toMatchObject({ space: "cmyk", magickColorspace: "CMYK", channels: 5, hasAlpha: true, depth: "ushort" });
  const decoded = decodeImage(bytes);
  expect(Array.from(decoded.hueSamples!.slice(0, 4))).toEqual([12345,23456,34567,45678].map(value => value / 65535));
  expect(decoded.data16![3]).toBe(56789);
  expect(decoded.data16![count * 4 - 1]).toBe(56789 + count - 1);
  const memory = new Uint8Array(count * 44);
  let allocated = 0;
  const stored = await readTxtFromSource({ size: bytes.length, async read(position, length) { return bytes.slice(position, position + length); } }, {
    allocate(length) { const position = allocated; allocated += length; return position; },
    async write(position, bytes) { memory.set(bytes, position); },
    async read(position, length) { return memory.slice(position, position + length); },
  }, new AbortController().signal);
  expect(memory.slice(stored.position, stored.position + count * 4)).toEqual(decoded.data);
  expect(new Uint16Array(memory.slice(stored.storedData16!.position, stored.storedData16!.position + count * 8).buffer)).toEqual(decoded.data16);
  expect(new Float64Array(memory.slice(stored.storedHueSamples!, stored.storedHueSamples! + count * 32).buffer)).toEqual(decoded.hueSamples);
});

it.each(["1,2,3", "1,2,3,4,5", "1,2,3,Infinity"])("rejects invalid CMYK tuples: %s", tuple => {
  expect(() => decodeImage(new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,1,0,255,cmyk\n0,0: (${tuple})\n`))).toThrow("Invalid TXT pixel");
});
