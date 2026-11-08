import { expect, it, vi } from "vitest";
import { encodePpm, encodePgm, encodePbm } from "./raster.js";
import { encodePortableBitmapChunks } from "./portable-bitmap-stream.js";

it.each(["ppm", "pgm", "pbm"] as const)("streams %s with legacy pixel, padding and row-boundary parity", async format => {
  const width = 13, height = 7;
  for (const missing of [0, 1, 7, width * 4 + 2]) {
    const data = Uint8Array.from({ length: width * height * 4 - missing }, (_, i) => i * 67 % 256);
    const bitmap = { width, height, data };
    const expected = ({ ppm: encodePpm, pgm: encodePgm, pbm: encodePbm })[format](bitmap);
    async function* input() { for (let at = 0; at < data.length; at += 3) yield data.subarray(at, at + 3); }
    const result = [];
    for await (const bytes of encodePortableBitmapChunks(format, width, height, input(), { chunkBytes: 7 })) { expect(bytes.buffer.byteLength).toBeLessThanOrEqual(7); result.push(...bytes); }
    expect(new Uint8Array(result)).toEqual(expected);
  }
});

it("admits output before acquiring input", async () => {
  const acquire = vi.fn(() => ({ next: async () => ({ done: true as const, value: undefined }) }));
  const input = { [Symbol.asyncIterator]: acquire };
  await expect(async () => { for await (const ignored of encodePortableBitmapChunks("ppm", 100, 100, input, { maxOutputBytes: 100 })) { /* Drain until admission fails. */ } }).rejects.toThrow("limit");
  expect(acquire).not.toHaveBeenCalled();
});

it("requests stalled input cleanup on cancellation", async () => {
  const controller = new AbortController(); const reason = new Error("cancel pixels");
  const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
  const input = { [Symbol.asyncIterator]() { return { next() { controller.abort(reason); return new Promise<IteratorResult<Uint8Array>>(() => {}); }, return: returned }; } };
  await expect(async () => { for await (const ignored of encodePortableBitmapChunks("ppm", 2, 2, input, { signal: controller.signal })) { /* Drain until cancellation. */ } }).rejects.toBe(reason);
  expect(returned).toHaveBeenCalledOnce();
});

it("honors backpressure and owns output from reusable input", async () => {
  let produced = 0; const chunk = new Uint8Array(64); chunk.fill(255);
  async function* input() { for (let i = 0; i < 100; i++) { produced++; yield chunk; } }
  const output = encodePortableBitmapChunks("ppm", 16, 100, input(), { chunkBytes: 32 });
  const first = await output.next(); expect(produced).toBe(0);
  const second = await output.next(); const saved = second.value!.slice();
  expect(produced).toBe(1); chunk.fill(0);
  await output.next(); expect(second.value).toEqual(saved);
  await output.return(); expect(first.done).toBe(false);
});

it("matches fixed Netpbm headers, luminance and packed row padding", async () => {
  const rgba = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  const cases = [
    ["ppm", "P6\n3 2\n255\n", [0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]],
    ["pgm", "P5\n3 2\n255\n", [0, 255, 76, 150, 29, 255]],
    ["pbm", "P4\n3 2\n", [160, 64]],
  ] as const;
  for (const [format, header, pixels] of cases) {
    async function* input() { yield rgba; }
    const actual = []; for await (const bytes of encodePortableBitmapChunks(format, 3, 2, input())) actual.push(...bytes);
    expect(actual).toEqual([...new TextEncoder().encode(header), ...pixels]);
  }
});

it.each([16, 512])("encodes %i generated rows with fixed source and output buffers", async height => {
  const width = 256; const chunk = new Uint8Array(4096); chunk.fill(255);
  let produced = 0; let consumed = 0; let pulls = 0;
  async function* input() {
    for (let at = 0; at < width * height * 4; at += chunk.length) { produced += chunk.length; pulls++; yield chunk; }
  }
  let first = true;
  for await (const bytes of encodePortableBitmapChunks("ppm", width, height, input(), { chunkBytes: 4096 })) {
    expect(bytes.buffer.byteLength).toBeLessThanOrEqual(4096);
    if (first) { first = false; expect(produced).toBe(0); continue; }
    expect(bytes.every(value => value === 255)).toBe(true);
    consumed += bytes.length;
    expect(produced - consumed * 4 / 3).toBeLessThanOrEqual(4096);
    const before = pulls; await Promise.resolve(); expect(pulls).toBe(before);
  }
  expect(consumed).toBe(width * height * 3);
});

it("stops even a split header when the consumer cancels", async () => {
  const controller = new AbortController();
  async function* input() { yield new Uint8Array(4); }
  const output = encodePortableBitmapChunks("ppm", 1, 1, input(), { chunkBytes: 1, signal: controller.signal });
  expect((await output.next()).value).toEqual(new Uint8Array([80]));
  const reason = new Error("cancel header"); controller.abort(reason);
  await expect(output.next()).rejects.toBe(reason);
});
