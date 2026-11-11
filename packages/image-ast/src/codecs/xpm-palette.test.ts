import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./index.js";
import { readXpmFromSource } from "./xpm.js";

it.each([1, 2])("retains opaque XPM symbol indices across storage chunks (cpp=%s)", async cpp => {
  const symbols = ["A", "B", "C", "D", "E"].map(symbol => symbol.repeat(cpp));
  const row = [2, 0, 1, 0, 2];
  const indices = Uint8Array.from({ length: 1055 }, (_, i) => row[i % row.length]!);
  const colors = ["red", "blue", "red", "green", "magenta"];
  const lines = [`${indices.length} 1 5 ${cpp}`, ...symbols.map((symbol, i) => `${symbol} c ${colors[i]}`), Array.from(indices, i => symbols[i]).join("")];
  const input = new TextEncoder().encode(`/* XPM */\nstatic char *tile[] = {${lines.map(line => JSON.stringify(line)).join(",")}};`);
  const decoded = decodeImage(input);
  expect(decoded.isPalette).toBe(true);
  expect(decoded.indexedColors).toEqual([0xffff0000, 0xff0000ff, 0xffff0000, 0xff00ff00, 0xffff00ff]);
  expect(decoded.pngIndices).toEqual(indices);
  expect(readImageMetadata(input).isPalette).toBe(true);
  const source = { size: input.length, async read(position: number, length: number) { return input.slice(position, position + length); } };
  const signal = new AbortController().signal;
  expect(await readXpmFromSource(source, undefined, signal)).toMatchObject({ isPalette: true });
  const backing = new Uint8Array(indices.length * 5);
  let end = 0;
  const stored = await readXpmFromSource(source, {
    allocate(length) { const position = end; end += length; return position; },
    async write(position, bytes) { expect(bytes.length).toBeLessThanOrEqual(2048); backing.set(bytes, position); },
    async read(position, length) { return backing.slice(position, position + length); }
  }, signal);
  expect(stored.indexedColors).toEqual(decoded.indexedColors);
  expect(backing.slice(stored.position, stored.position + decoded.data.length)).toEqual(decoded.data);
  expect(backing.slice(stored.storedPngIndices!.position, stored.storedPngIndices!.position + indices.length)).toEqual(indices);
});
