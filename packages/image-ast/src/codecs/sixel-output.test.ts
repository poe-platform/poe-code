import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp, { encodeImage } from "../index.js";
import { encodeStoredImage } from "../image-encode.js";
import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage } from "./png-storage.js";

for (const width of [1, 7, 1023, 1024, 1025]) {
  it(`packs six-row bands and horizontal tiles at width ${width}`, async () => {
    const height = 7, data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i += 4) data.set([255, 0, 0, 255], i);
    const image: RgbaImage = { width, height, data, format: "raw", space: "srgb", channels: 3, hasAlpha: false, depth: "uchar", density: 72 };
    const sync = encodeImage(image, { format: "sixel" });
    const storage: ImageByteStorage = {
      allocate() { throw new Error("unexpected allocation"); },
      async write() { throw new Error("unexpected write"); },
      async read(position, length) {
        expect(length).toBeLessThanOrEqual(4096);
        return data.subarray(position - 31, position - 31 + length);
      }
    };
    const stream = encodeStoredImage({ ...image, position: 31 }, storage, new AbortController().signal, { format: "sixel" });
    const chunks: Uint8Array[] = [];
    let step = await stream.next();
    while (!step.done) {
      expect(step.value.length).toBeLessThanOrEqual(4096);
      chunks.push(step.value);
      step = await stream.next();
    }
    expect(step.value).toMatchObject({ format: "sixel", channels: 3, width, height, size: sync.data.length });
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(sync.data);
    const run = (symbol: string) => width === 1 ? symbol : width <= 1024 ? `!${width}${symbol}` : `!1024${symbol}$#0!1024?${symbol}`;
    expect(new TextDecoder().decode(sync.data)).toBe(`\x1bP0;1;0q"1;1;${width};7#0;2;100;0;0$#0${run("~") }-$#0${run("@")}\x1b\\`);
    expect(new Uint8Array(await sharp(data, { raw: { width, height, channels: 4 } }).toFormat("sixel").toBuffer())).toEqual(sync.data);
  });
}

it("omits transparent pixels and preserves the vertical bit order", () => {
  const data = new Uint8Array(2 * 7 * 4);
  data.set([0, 255, 0, 255], (2 * 5 + 1) * 4);
  const image: RgbaImage = { width: 2, height: 7, data, format: "raw", space: "srgb", channels: 4, hasAlpha: true, depth: "uchar", density: 72 };
  const text = new TextDecoder().decode(encodeImage(image, { format: "sixel" }).data);
  expect(text).toContain("#0;2;0;100;0");
  expect(text.endsWith("$#0?_-\x1b\\")).toBe(true); // Bit 5 is '_'; the first column stays transparent.
});

it("rejects truncated storage and honors cancellation before reading", async () => {
  const image = { position: 0, width: 1, height: 1, format: "raw" as const, space: "srgb" as const, channels: 3 as const, hasAlpha: false, depth: "uchar" as const, density: 72 };
  const read = vi.fn(async () => new Uint8Array(3));
  const storage: ImageByteStorage = { read, allocate: () => 0, async write() {} };
  const controller = new AbortController();
  await expect(encodeStoredImage(image, storage, controller.signal, { format: "sixel" }).next()).rejects.toThrow("Truncated SIXEL pixel storage");
  read.mockClear();
  const failure = new Error("cancelled");
  controller.abort(failure);
  await expect(encodeStoredImage(image, storage, controller.signal, { format: "sixel" }).next()).rejects.toBe(failure);
  expect(read).not.toHaveBeenCalled();
});

it("infers SIXEL from the SDK output filename", async () => {
  const filesystem = new MemoryFileSystem();
  const input = await sharp({ create: { width: 32, height: 16, channels: 3, background: "red" } }).png().toBuffer();
  const info = await sharp(input, { filesystem }).toFile("/image.sixel");
  expect(info).toMatchObject({ format: "sixel", width: 32, height: 16, channels: 3 });
  expect(new TextDecoder().decode(await filesystem.readFile("/image.sixel")).startsWith('\x1bP0;1;0q"1;1;32;16')).toBe(true);
});
