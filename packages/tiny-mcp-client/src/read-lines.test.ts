import { Readable } from "node:stream";
import { describe, expect, it } from "bun:test";
import { readLines } from "./internal.js";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

describe("readLines", () => {
  it("yields complete lines from a single chunk with multiple lines", async () => {
    const stream = Readable.from(["alpha\nbeta\ngamma\n"]);

    await expect(collect(readLines(stream))).resolves.toEqual(["alpha", "beta", "gamma"]);
  });

  it("handles lines split across multiple chunks", async () => {
    const stream = Readable.from(["al", "pha\nbe", "ta\ngam", "ma"]);

    await expect(collect(readLines(stream))).resolves.toEqual(["alpha", "beta", "gamma"]);
  });

  it("strips carriage returns for CR+LF line endings", async () => {
    const stream = Readable.from(["alpha\r", "\nbeta\r\n", "gamma\r\n"]);

    await expect(collect(readLines(stream))).resolves.toEqual(["alpha", "beta", "gamma"]);
  });

  it("yields remaining buffered content when stream closes without trailing newline", async () => {
    const stream = Readable.from(["alpha\nbeta"]);

    await expect(collect(readLines(stream))).resolves.toEqual(["alpha", "beta"]);
  });

  it("yields empty lines between delimiters", async () => {
    const stream = Readable.from(["alpha\n\nbeta\n"]);

    await expect(collect(readLines(stream))).resolves.toEqual(["alpha", "", "beta"]);
  });
});
