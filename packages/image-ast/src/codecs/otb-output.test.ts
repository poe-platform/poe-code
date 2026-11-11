import { expect, it, vi } from "vitest";
import sharp, { encodeImage } from "../index.js";
import { encodeStoredImage } from "../image-encode.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage } from "./png-storage.js";

const image: RgbaImage = { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]), format: "raw", space: "srgb", channels: 4, hasAlpha: true, depth: "uchar", density: 72 };

for (const [width, height] of [[1, 1], [255, 2], [256, 2], [1, 256], [1025, 3], [65535, 1]]) {
  it(`packs OTB scanlines and dimensions (${width}x${height})`, async () => {
    const data = Uint8Array.from({ length: width! * height! * 4 }, (_, i) => i % 4 === 3 || Math.floor(i / 4) % 3 === 1 ? 255 : 0);
    const frame = { ...image, width: width!, height: height!, data };
    const sync = encodeImage(frame, { format: "otb" });
    expect(sync).toMatchObject({ format: "otb", channels: 1 });
    const extended = width! > 255 || height! > 255;
    const header = extended ? [16, width! >> 8, width! & 255, height! >> 8, height! & 255, 1] : [0, width!, height!, 1];
    expect([...sync.data.subarray(0, header.length)]).toEqual(header);
    const stride = Math.ceil(width! / 8);
    expect(sync.data).toHaveLength(header.length + stride * height!);
    for (let y = 0; y < height!; y++) for (let x = 0; x < stride * 8; x++) {
      const bit = (sync.data[header.length + y * stride + Math.floor(x / 8)]! >> (7 - x % 8)) & 1;
      expect(bit).toBe(x < width! && (y * width! + x) % 3 !== 1 ? 1 : 0);
    }
    const storage: ImageByteStorage = {
      allocate() { throw new Error("unexpected allocation"); }, async write() { throw new Error("unexpected write"); },
      async read(position, length) {
        expect(length).toBeLessThanOrEqual(4096);
        return data.subarray(position - 17, position - 17 + length);
      }
    };
    const chunks: Uint8Array[] = [];
    const stream = encodeStoredImage({ ...frame, position: 17 }, storage, new AbortController().signal, { format: "otb" });
    let step = await stream.next();
    while (!step.done) { chunks.push(step.value); step = await stream.next(); }
    expect(step.value).toMatchObject({ format: "otb", width, height, channels: 1, size: sync.data.length });
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(sync.data);
    expect(new Uint8Array(await sharp(data, { raw: { width: width!, height: height!, channels: 4 } }).toFormat("otb").toBuffer())).toEqual(sync.data);
  });
}

it("infers OTB from the SDK output filename", async () => {
  const filesystem = new MemoryFileSystem();
  const info = await sharp(image.data, { raw: { width: 1, height: 1, channels: 4 }, filesystem }).toFile("/out.otb");
  expect(info).toMatchObject({ format: "otb", channels: 1 });
  expect([...(await filesystem.readFile("/out.otb"))]).toEqual([0, 1, 1, 1, 128]);
});

it("rejects dimensions that cannot fit in an OTB header", () => {
  for (const [width, height] of [[0, 1], [65536, 1], [1, 65536], [1, 0], [1.5, 1]]) {
    expect(() => encodeImage({ ...image, width: width!, height: height! }, { format: "otb" })).toThrow("Invalid OTB dimensions");
  }
});

it("propagates truncated storage, read errors, and cancellation", async () => {
  const read = vi.fn(async () => new Uint8Array(1));
  const storage: ImageByteStorage = { read, allocate: () => 0, async write() {} };
  const frame = { ...image, position: 0 }, controller = new AbortController();
  const stream = encodeStoredImage(frame, storage, controller.signal, { format: "otb" });
  await stream.next();
  await expect(stream.next()).rejects.toThrow("Truncated OTB pixel storage");
  const reason = new Error("storage failure");
  read.mockRejectedValueOnce(reason);
  const failed = encodeStoredImage(frame, storage, controller.signal, { format: "otb" });
  await failed.next();
  await expect(failed.next()).rejects.toBe(reason);
  read.mockClear();
  controller.abort(reason);
  await expect(encodeStoredImage(frame, storage, controller.signal, { format: "otb" }).next()).rejects.toBe(reason);
  expect(read).not.toHaveBeenCalled();
  const duringRead = new AbortController();
  read.mockImplementationOnce(async () => { duringRead.abort(reason); return image.data; });
  const cancelled = encodeStoredImage(frame, storage, duringRead.signal, { format: "otb" });
  await cancelled.next();
  await expect(cancelled.next()).rejects.toBe(reason);
});
