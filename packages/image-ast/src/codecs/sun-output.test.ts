import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp, { encodeImage } from "../index.js";
import { encodeStoredImage } from "../image-encode.js";
import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage } from "./png-storage.js";

for (const width of [1, 2, 3, 4, 7, 1023, 1024, 1025]) {
  it(`preserves RGB and row padding across storage chunks at width ${width}`, async () => {
    const height = 3, data = Uint8Array.from({ length: width * height * 4 }, (_, index) => index % 251);
    const image: RgbaImage = { width, height, data, format: "raw", space: "srgb", channels: 4, hasAlpha: true, depth: "uchar", density: 72 };
    const sync = encodeImage(image, { format: "sun" });
    const storage: ImageByteStorage = {
      allocate() { throw new Error("unexpected allocation"); },
      async write() { throw new Error("unexpected write"); },
      async read(position, length) {
        expect(length).toBeLessThanOrEqual(4096);
        return data.subarray(position - 31, position - 31 + length);
      }
    };
    const stream = encodeStoredImage({ ...image, position: 31 }, storage, new AbortController().signal, { format: "sun" });
    const chunks: Uint8Array[] = [];
    let step = await stream.next();
    while (!step.done) {
      expect(step.value.length).toBeLessThanOrEqual(4096);
      chunks.push(step.value);
      step = await stream.next();
    }
    expect(step.value).toMatchObject({ format: "sun", channels: 3, width, height, size: sync.data.length });
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(sync.data);
    const header = new DataView(sync.data.buffer), start = 32, rowBytes = header.getUint32(16) / height;
    expect(header.getUint32(0)).toBe(0x59a66a95);
    expect(rowBytes % 2).toBe(0);
    for (let y = 0; y < height; y++) {
      const row = sync.data.subarray(start + y * rowBytes, start + (y + 1) * rowBytes);
      expect(row.subarray(0, width * 3)).toEqual(data.subarray(y * width * 4, (y + 1) * width * 4).filter((_, index) => index % 4 !== 3));
      expect(row.subarray(width * 3).every(value => value === 0)).toBe(true);
    }
    const sdk = await sharp(data, { raw: { width, height, channels: 4 } }).toFormat("sun").toBuffer();
    expect(new Uint8Array(sdk)).toEqual(sync.data);
  });
}

it("rejects truncated pixel storage and honors cancellation before reading", async () => {
  const image = { position: 0, width: 1, height: 1, format: "raw" as const, space: "srgb" as const, channels: 4 as const, hasAlpha: true, depth: "uchar" as const, density: 72 };
  const read = vi.fn(async () => new Uint8Array(3));
  const storage: ImageByteStorage = { read, allocate: () => 0, async write() {} };
  const controller = new AbortController();
  const stream = encodeStoredImage(image, storage, controller.signal, { format: "sun" });
  await stream.next(); // Header.
  await expect(stream.next()).rejects.toThrow("Truncated Sun raster pixel storage");
  read.mockClear();
  const failure = new Error("cancelled");
  controller.abort(failure);
  await expect(encodeStoredImage(image, storage, controller.signal, { format: "sun" }).next()).rejects.toBe(failure);
  expect(read).not.toHaveBeenCalled();
});

it("infers Sun raster from the SDK output filename", async () => {
  const filesystem = new MemoryFileSystem();
  const input = await sharp({ create: { width: 7, height: 3, channels: 3, background: "red" } }).png().toBuffer();
  const pipeline = sharp(input, { filesystem });
  const info = await pipeline.toFile("/image.sun");
  expect(info).toMatchObject({ format: "sun", width: 7, height: 3, channels: 3 });
  const bytes = await filesystem.readFile("/image.sun");
  expect(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)).toBe(0x59a66a95);
});
