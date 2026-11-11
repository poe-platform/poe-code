import { expect, it } from "vitest";
import { decodeImage } from "./codecs/index.js";
import { readTxtFromSource } from "./codecs/txt.js";

it.each([255, 65535, 4294967295])("preserves two independent extra planes across reordered storage chunks at maximum %s", async maximum => {
  const count = 1025, range = maximum;
  const rows = Array.from({ length: count }, (_, y) => `0,${y}: (1,2,3,${range},${y % 251},${250 - y % 251})\n`);
  const bytes = new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,${count},2,${maximum},srgba\n` + rows.reverse().join(""));
  const decoded = decodeImage(bytes);
  expect(decoded.metaChannels).toHaveLength(2);
  const memory = new Uint8Array(count * 132);
  let allocated = 0;
  const stored = await readTxtFromSource({ size: bytes.length, async read(position, length) { return bytes.slice(position, position + length); } }, {
    allocate(length) { const position = allocated; allocated += length; return position; },
    async write(position, bytes) { memory.set(bytes, position); },
    async read(position, length) { return memory.slice(position, position + length); },
  }, new AbortController().signal);
  expect(stored.storedMetaChannels).toHaveLength(2);
  for (let channel = 0; channel < 2; channel++) {
    const plane = decoded.metaChannels![channel]!, retained = stored.storedMetaChannels![channel]!;
    expect(memory.slice(retained.position, retained.position + count * 4)).toEqual(plane.data);
    if (plane.data16) expect(new Uint16Array(memory.slice(retained.storedData16!.position, retained.storedData16!.position + count * 8).buffer)).toEqual(plane.data16);
    if (plane.evaluateSamples) expect(new Float64Array(memory.slice(retained.storedEvaluateSamples!, retained.storedEvaluateSamples! + count * 32).buffer)).toEqual(plane.evaluateSamples);
    for (let y = 0; y < count; y++) {
      const value = channel === 0 ? y % 251 : 250 - y % 251;
      const quantum = Math.fround(65535 * value / range);
      expect(plane.data[y * 4]).toBe(Math.round(quantum / 257));
      if (plane.data16) expect(plane.data16[y * 4]).toBe(Math.round(quantum));
      if (plane.evaluateSamples) expect(plane.evaluateSamples[y * 4]).toBe(quantum / 257);
      expect(decoded.data[y * 4 + 3]).toBe(255);
    }
  }
});

it.each(["-1", "1.5", "NaN", "55", "9007199254740991"])("rejects invalid extra channel count %s before allocation", count => {
  expect(() => decodeImage(new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,1,${count},255,srgb\n0,0: (1,2,3)\n`))).toThrow("Invalid TXT extra channels");
});

it.each(["1,2,3", "1,2,3,4,5"])("rejects mismatched extra sample tuples %s", tuple => {
  expect(() => decodeImage(new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,1,1,255,srgb\n0,0: (${tuple})\n`))).toThrow("Invalid TXT pixel");
});
