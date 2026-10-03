import { readFileSync } from "node:fs";
import { deflate, deflateRaw, gzip } from "pako";
import { describe, expect, it, vi } from "vitest";
import { PdfDocument } from "../document.js";
import { decodeFlate } from "./filters.js";
import { inflatePdfChunks } from "./flate-stream.js";

async function* chunks(bytes: Uint8Array, size = 13) {
  const scratch = new Uint8Array(size);
  for (let offset = 0; offset < bytes.length; offset += size) {
    const count = Math.min(size, bytes.length - offset);
    scratch.set(bytes.subarray(offset, offset + count));
    yield scratch.subarray(0, count);
  }
}
async function collect(input: AsyncIterable<Uint8Array>) {
  const output: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of input) { output.push(chunk); length += chunk.length; }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of output) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

describe("bounded PDF Flate inflation", () => {
  it.each([0, 1, 9])("matches zlib/raw/gzip decoding at compression level %i", async level => {
    const bytes = new TextEncoder().encode("Repeated PDF content and unicode. ".repeat(100));
    for (const encoded of [deflate(bytes, { level }), deflateRaw(bytes, { level }), gzip(bytes, { level })]) {
      expect(await collect(inflatePdfChunks(chunks(encoded, 1), { chunkBytes: 7, maxDecodedBytes: bytes.length }))).toEqual(bytes);
    }
  });

  it.each([
    "pdfjs-flate-issue11651.pdf-8.bin", "pdfjs-flate-issue11651.pdf-10.bin",
    "pdfjs-flate-issue3885.pdf-12.bin", "pdfjs-flate-bug1050040.pdf-2.bin",
  ])("preserves PDF.js recovery for %s", async file => {
    const bytes = readFileSync(new URL(`../fixtures/${file}`, import.meta.url));
    const expected = decodeFlate(bytes);
    expect(await collect(inflatePdfChunks(chunks(bytes), { chunkBytes: 113, maxDecodedBytes: expected.length }))).toEqual(expected);
    await expect(collect(inflatePdfChunks(chunks(bytes), { maxDecodedBytes: expected.length - 1 }))).rejects.toMatchObject({ code: "E_LIMIT" });
  });

  it.each(Array.from({ length: 12 }, (_, i) => i + 1))("preserves pypdf recovery with %i missing trailing bytes", async cut => {
    const printable = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~ \t\n\r\v\f";
    const bytes = deflate(new TextEncoder().encode(printable + [...printable].reverse().join(""))).slice(0, -cut);
    expect(await collect(inflatePdfChunks(chunks(bytes), { chunkBytes: 11 }))).toEqual(decodeFlate(bytes));
  });

  it("retains concatenated gzip members and gzip truncation", async () => {
    const first = gzip(new TextEncoder().encode("first"));
    const second = gzip(new TextEncoder().encode("second"));
    const bytes = new Uint8Array(first.length + second.length);
    bytes.set(first); bytes.set(second, first.length);
    expect(await collect(inflatePdfChunks(chunks(bytes)))).toEqual(new TextEncoder().encode("firstsecond"));
    expect(await collect(inflatePdfChunks(chunks(bytes.slice(0, -5))))).toEqual(decodeFlate(bytes.slice(0, -5)));
  });

  it("emits owned chunks under backpressure without payload-sized allocation", async () => {
    const encoded = deflate(new Uint8Array(1024 * 1024));
    let pulls = 0;
    let closed = false;
    async function* input() { try { for await (const chunk of chunks(encoded, 17)) { pulls++; yield chunk; } } finally { closed = true; } }
    const sizes: number[] = [];
    const original = Uint8Array;
    vi.stubGlobal("Uint8Array", new Proxy(original, { construct(target, args) {
      const value = Reflect.construct(target, args) as Uint8Array;
      sizes.push(value.byteLength); return value;
    } }));
    try {
      const iterator = inflatePdfChunks(input(), { chunkBytes: 31 });
      const first = await iterator.next();
      expect(first.value).toHaveLength(31);
      expect(pulls).toBeLessThan(Math.ceil(encoded.length / 17));
      const preserved = first.value!.slice();
      const next = await iterator.next();
      expect(next.value!.buffer).not.toBe(first.value!.buffer);
      expect(first.value).toEqual(preserved);
      await iterator.return(undefined);
      expect(closed).toBe(true);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(32768);
    } finally { vi.unstubAllGlobals(); }
  });

  it("rejects expansion at the budget and accepts empty output with zero budget", async () => {
    await expect(collect(inflatePdfChunks(chunks(deflate(new Uint8Array(10000))), { maxDecodedBytes: 17 }))).rejects.toMatchObject({ code: "E_LIMIT" });
    expect(await collect(inflatePdfChunks(chunks(deflate(new Uint8Array())), { maxDecodedBytes: 0 }))).toEqual(new Uint8Array());
  });

  it.each([new Uint8Array(), new Uint8Array([255, 255, 255]), new Uint8Array([120, 156, 7])])("rejects undecodable bytes", async bytes => {
    await expect(collect(inflatePdfChunks(chunks(bytes)))).rejects.toMatchObject({ code: "E_CAPABILITY" });
  });
  it("preserves the upstream truncated Unicode map", async () => {
    const doc = PdfDocument.load(new Uint8Array(readFileSync(new URL("../fixtures/pdfjs-issue11549_reduced.pdf", import.meta.url))));
    const object = doc.cos.getObject(37);
    if (object?.kind !== "stream") throw new Error("Missing fixture stream");
    expect(await collect(inflatePdfChunks(chunks(object.rawBytes), { chunkBytes: 31, maxDecodedBytes: 1430 }))).toEqual(decodeFlate(object.rawBytes));
  });

  it("cancels pending input and preserves the primary failure over cleanup", async () => {
    const controller = new AbortController();
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    let pulls = 0;
    const close = vi.fn(async () => { throw new Error("cleanup failure"); });
    const input = { [Symbol.asyncIterator]: () => ({
      next: async () => {
        if (pulls++ === 0) return { done: false as const, value: new Uint8Array([120, 156]) };
        ready(); return new Promise<IteratorResult<Uint8Array>>(() => {});
      }, return: close,
    }) };
    const pending = collect(inflatePdfChunks(input, { signal: controller.signal }));
    await started;
    controller.abort(new Error("cancel inflate"));
    await expect(pending).rejects.toThrow("cancel inflate");
    expect(close).toHaveBeenCalledOnce();
  });

  it("matches PDF.js zero-padding of truncated stored blocks", async () => {
    const bytes = new Uint8Array([120, 1, 1, 5, 0, 250, 255, 7, 9]);
    expect(await collect(inflatePdfChunks(chunks(bytes, 1), { chunkBytes: 2 }))).toEqual(decodeFlate(bytes));
  });

});
