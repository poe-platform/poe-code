import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "./index.js";
import { readXpmFromSource } from "./xpm.js";

it("retains mixed XPM palette precision and transparency across storage chunks", async () => {
  const row = "ABCDE".repeat(211);
  const lines = [`${row.length} 1 5 1`, "A c #123456789abc", "B c #12345a789", "C c #123456", "D c red", "E c None", row];
  const input = new TextEncoder().encode(`/* XPM */\nstatic char *tile[] = {${lines.map(line => JSON.stringify(line)).join(",")}};`);
  const expected = Uint16Array.from(Array.from({ length: 211 }, () => [
    0x1234, 0x5678, 0x9abc, 65535,
    0x1231, 0x45a4, 0x7897, 65535,
    0x1212, 0x3434, 0x5656, 65535,
    65535, 0, 0, 65535,
    0, 0, 0, 0
  ]).flat());
  const metadata = { format: "xpm", width: row.length, height: 1, hasAlpha: true, depth: "ushort" };
  expect(readImageMetadata(input)).toMatchObject(metadata);
  const decoded = decodeImage(input);
  expect(decoded).toMatchObject(metadata);
  expect(decoded.data16).toEqual(expected);
  expect(decoded.data).toEqual(Uint8Array.from(expected, value => Math.round(value / 257)));

  const source = { size: input.length, async read(position: number, length: number) { return input.slice(position, position + length); } };
  const signal = new AbortController().signal;
  expect(await readXpmFromSource(source, undefined, signal)).toMatchObject(metadata);
  const backing = new Uint8Array(row.length * 12);
  let end = 0;
  const stored = await readXpmFromSource(source, {
    allocate(length) { const position = end; end += length; return position; },
    async write(position, bytes) { expect(bytes.length).toBeLessThanOrEqual(4096); backing.set(bytes, position); },
    async read(position, length) { return backing.slice(position, position + length); }
  }, signal);
  expect(stored).toMatchObject(metadata);
  expect(backing.slice(stored.position, stored.position + decoded.data.length)).toEqual(decoded.data);
  expect(new Uint16Array(backing.buffer, stored.storedData16!.position, stored.storedData16!.length)).toEqual(expected);
});
