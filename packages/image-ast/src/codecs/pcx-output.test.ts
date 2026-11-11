import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp, { encodeImage } from "../index.js";
import { encodeStoredImage } from "../image-encode.js";
import type { RgbaImage } from "../ast.js";
import type { ImageByteStorage } from "./png-storage.js";

const image: RgbaImage = { width: 3, height: 2, data: new Uint8Array(24), format: "raw", space: "srgb", channels: 4, hasAlpha: true, depth: "uchar", density: 72 };

for (const width of [1, 2, 3, 63, 64, 1023, 1024, 1025]) {
  it(`preserves PCX RGB planes, runs and padding at width ${width}`, async () => {
    const height = 2;
    const data = Uint8Array.from({ length: width * height * 4 }, (_, index) => index < width * 4 ? 255 : index % 256);
    const frame = { ...image, width, height, data };
    const sync = encodeImage(frame, { format: "pcx" });
    const storage: ImageByteStorage = {
      allocate() { throw new Error("unexpected allocation"); },
      async write() { throw new Error("unexpected write"); },
      async read(position, length) {
        expect(length).toBeLessThanOrEqual(4096);
        return data.subarray(position - 31, position - 31 + length);
      }
    };
    const chunks: Uint8Array[] = [];
    const stream = encodeStoredImage({ ...frame, position: 31 }, storage, new AbortController().signal, { format: "pcx" });
    let step = await stream.next();
    while (!step.done) {
      expect(step.value.length).toBeLessThanOrEqual(4096);
      chunks.push(step.value);
      step = await stream.next();
    }
    expect(step.value).toMatchObject({ format: "pcx", width, height, channels: 3, size: sync.data.length });
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(sync.data);
    const header = new DataView(sync.data.buffer, sync.data.byteOffset, sync.data.byteLength);
    expect([...sync.data.subarray(0, 4)]).toEqual([10, 5, 1, 8]);
    expect(header.getUint16(8, true)).toBe(width - 1);
    expect(header.getUint16(10, true)).toBe(height - 1);
    expect(sync.data[65]).toBe(3);
    const stride = header.getUint16(66, true);
    expect(stride).toBe(width + width % 2);
    const planar: number[] = [];
    for (let offset = 128; offset < sync.data.length;) {
      const code = sync.data[offset++]!;
      if (code < 192) planar.push(code);
      else {
        expect(code & 63).toBeGreaterThan(0);
        planar.push(...Array<number>(code & 63).fill(sync.data[offset++]!));
      }
    }
    expect(planar).toHaveLength(stride * 3 * height);
    for (let y = 0; y < height; y++) for (let channel = 0; channel < 3; channel++) {
      const start = (y * 3 + channel) * stride;
      expect(planar.slice(start, start + width)).toEqual([...data.subarray(y * width * 4, (y + 1) * width * 4).filter((_, index) => index % 4 === channel)]);
      expect(planar.slice(start + width, start + stride).every(value => value === 0)).toBe(true);
    }
    const sdk = await sharp(data, { raw: { width, height, channels: 4 } }).toFormat("pcx").toBuffer();
    expect(new Uint8Array(sdk)).toEqual(sync.data);
  });
}

it("writes inch resolution and converts centimeter resolution", () => {
  for (const [unit, x, y] of [["inch", 10, 20], ["cm", 25, 51], ["meter", 0, 1]] as const) {
    const result = encodeImage({ ...image, resolution: { x: 10, y: 20, unit } }, { format: "pcx" });
    const header = new DataView(result.data.buffer);
    expect([header.getUint16(12, true), header.getUint16(14, true)]).toEqual([x, y]);
  }
});

it("rejects unrepresentable dimensions instead of wrapping header fields", () => {
  for (const [width, height] of [[0, 1], [65535, 1], [1, 65537], [1.5, 1]]) {
    expect(() => encodeImage({ ...image, width: width!, height: height! }, { format: "pcx" })).toThrow("Invalid PCX dimensions");
  }
});

it("propagates short reads, storage errors and cancellation", async () => {
  const read = vi.fn(async () => new Uint8Array(1));
  const storage: ImageByteStorage = { read, allocate: () => 0, async write() {} };
  const frame = { ...image, position: 0 };
  const controller = new AbortController();
  const stream = encodeStoredImage(frame, storage, controller.signal, { format: "pcx" });
  await stream.next();
  await expect(stream.next()).rejects.toThrow("Truncated PCX pixel storage");
  const reason = new Error("storage failure");
  read.mockRejectedValueOnce(reason);
  const failed = encodeStoredImage(frame, storage, controller.signal, { format: "pcx" });
  await failed.next();
  await expect(failed.next()).rejects.toBe(reason);
  read.mockClear();
  controller.abort(reason);
  await expect(encodeStoredImage(frame, storage, controller.signal, { format: "pcx" }).next()).rejects.toBe(reason);
  expect(read).not.toHaveBeenCalled();
  const duringRead = new AbortController();
  read.mockImplementationOnce(async () => { duringRead.abort(reason); return image.data; });
  const cancelled = encodeStoredImage(frame, storage, duringRead.signal, { format: "pcx" });
  await cancelled.next();
  await expect(cancelled.next()).rejects.toBe(reason);
});

it("infers PCX from an SDK output filename", async () => {
  const filesystem = new MemoryFileSystem();
  const pipeline = sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 }, filesystem });
  const info = await pipeline.toFile("/image.pcx");
  expect(info).toMatchObject({ format: "pcx", width: 3, height: 2, channels: 3 });
  expect([...(await filesystem.readFile("/image.pcx")).subarray(0, 4)]).toEqual([10, 5, 1, 8]);
});
