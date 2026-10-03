import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { encodeJpeg } from "./raster.js";
import { encodeJpegChunks } from "./jpeg-stream.js";
const pixels = (length: number) => Uint8Array.from({ length }, (_, i) => i * 67 % 256);
it.each([1, 40, 90, 100])("preserves JPEG bytes at quality %i across fragmented and truncated input", async quality => {
  for (const missing of [0, 1, 51, 800]) {
    const data = pixels(17 * 13 * 4 - missing); const expected = encodeJpeg({ width: 17, height: 13, data }, quality);
    async function* input() { for (let i = 0; i < data.length; i += 7) yield data.subarray(i, i + 7); }
    const output: number[] = [];
    for await (const bytes of encodeJpegChunks(17, 13, input(), { quality, chunkBytes: 19 })) { expect(bytes.buffer.byteLength).toBeLessThanOrEqual(19); output.push(...bytes); }
    expect(new Uint8Array(output)).toEqual(expected);
  }
});
it("preserves a pre-refactor encoder digest", () => {
  expect(createHash("sha256").update(encodeJpeg({ width: 17, height: 13, data: pixels(884) }, 90)).digest("hex")).toBe("fa627ffae397d0ace7da26900205bdd98444e1e8ee9b9cedfb3a31c8d1691f3e");
});
it("admits working memory and dimensions before acquiring input", async () => {
  const acquire = vi.fn(() => ({ next: async () => ({ done: true as const, value: undefined }) })); const input = { [Symbol.asyncIterator]: acquire };
  await expect(async () => { for await (const ignored of encodeJpegChunks(512, 512, input, { maxWorkingBytes: 1 })) { /* Drain. */ } }).rejects.toThrow("limit");
  await expect(async () => { for await (const ignored of encodeJpegChunks(65536, 1, input)) { /* Drain. */ } }).rejects.toThrow("dimension");
  expect(acquire).not.toHaveBeenCalled();
});
it("owns emitted bytes and reads only one eight-row band under backpressure", async () => {
  const chunk = new Uint8Array(32 * 4).fill(255); let produced = 0; let closed = false;
  async function* input() { try { for (let y = 0; y < 1000; y++) { produced++; yield chunk; } } finally { closed = true; } }
  const output = encodeJpegChunks(32, 1000, input(), { chunkBytes: 64 }); const saved: { bytes: Uint8Array; copy: Uint8Array }[] = [];
  while (!produced) { const value = (await output.next()).value!; saved.push({ bytes: value, copy: value.slice() }); }
  expect(produced).toBe(8); const before = produced; await Promise.resolve(); expect(produced).toBe(before);
  chunk.fill(0); await output.next(); for (const { bytes, copy } of saved) expect(bytes).toEqual(copy);
  await output.return(); expect(closed).toBe(true);
});
it("closes stalled input when cancelled", async () => {
  const controller = new AbortController(); const reason = new Error("cancel jpeg encoding"); const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
  const input = { [Symbol.asyncIterator]() { return { next() { controller.abort(reason); return new Promise<IteratorResult<Uint8Array>>(() => {}); }, return: returned }; } };
  await expect(async () => { for await (const ignored of encodeJpegChunks(1, 1, input, { signal: controller.signal })) { /* Drain. */ } }).rejects.toBe(reason);
  expect(returned).toHaveBeenCalledOnce();
});
it.each([16, 512])("encodes %i generated rows with fixed owned working storage", async height => {
  const width = 64; const row = new Uint8Array(width * 4).fill(255); let rows = 0; let emitted = 0;
  async function* input() { for (let y = 0; y < height; y++) { rows++; yield row; } }
  for await (const bytes of encodeJpegChunks(width, height, input(), { chunkBytes: 127, maxWorkingBytes: 65536 + 127 + width * 8 * 4 })) {
    expect(bytes.buffer.byteLength).toBeLessThanOrEqual(127); emitted += bytes.length;
    const before = rows; await Promise.resolve(); expect(rows).toBe(before);
  }
  expect(rows).toBe(height); expect(emitted).toBeGreaterThan(328);
});
it("rejects an output budget overflow and closes the producer", async () => {
  let closed = false;
  async function* input() { try { for (let i = 0; i < 32; i++) yield pixels(64 * 4); } finally { closed = true; } }
  await expect(async () => { for await (const ignored of encodeJpegChunks(64, 32, input(), { maxOutputBytes: 500 })) { /* Drain. */ } }).rejects.toThrow("limit");
  expect(closed).toBe(true);
});
