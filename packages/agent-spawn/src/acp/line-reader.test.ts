import { describe, it, expect } from "bun:test";
import { PassThrough, Readable } from "node:stream";

import { readLines } from "./line-reader.js";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe("acp/readLines", () => {
  it("yields nothing for an empty stream", async () => {
    const stream = Readable.from([]);
    await expect(collect(readLines(stream))).resolves.toEqual([]);
  });

  it("finishes when iteration starts after the stream already ended", async () => {
    const stream = new PassThrough();
    stream.end();

    await expect(collect(readLines(stream))).resolves.toEqual([]);
  });

  it("yields a single line at end when there are no newlines", async () => {
    const stream = Readable.from(["hello"]);
    await expect(collect(readLines(stream))).resolves.toEqual(["hello"]);
  });

  it("buffers chunks and yields complete lines split on \\n", async () => {
    const stream = Readable.from(["hel", "lo\nwor", "ld\nx"]);
    await expect(collect(readLines(stream))).resolves.toEqual(["hello", "world", "x"]);
  });

  it("throws if the stream errors", async () => {
    const stream = new PassThrough();
    const collected = collect(readLines(stream));

    stream.write("ok\n");
    stream.destroy(new Error("boom"));

    await expect(collected).rejects.toThrow("boom");
  });

  it("throws if iteration starts after the stream already errored", async () => {
    const stream = new PassThrough();
    stream.write("ok\n");
    stream.destroy(new Error("boom"));

    await expect(collect(readLines(stream))).rejects.toThrow("boom");
  });
});
