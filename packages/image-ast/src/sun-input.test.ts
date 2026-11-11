import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { decodeImage, readImageMetadata, decodeImageToStorage, readImageMetadataFromSource } from "./index.js";

// Three distinct pixels per row, with nonzero word-alignment padding.
const input = () => Buffer.from("59a66a9500000003000000020000001800000014000000030000000000000000ff000000ff000000ffab123456789abcdef012cd", "hex");
const expected = Buffer.from("ff0000ff00ff00ff0000ffff123456ff789abcffdef012ff", "hex");
const source = (bytes: Uint8Array) => ({ size: bytes.length, read: vi.fn(async (position: number, length: number) => bytes.subarray(position, position + length)) });

it("reports Sun RGB metadata through buffered and retained readers", async () => {
  const bytes = input(), metadata = readImageMetadata(bytes);
  expect(metadata).toMatchObject({ format: "sun", width: 3, height: 2, channels: 3, space: "srgb", bitsPerSample: 8, hasAlpha: false, size: bytes.length });
  expect(await readImageMetadataFromSource(source(bytes), new AbortController().signal)).toEqual(metadata);
});

for (const retained of [false, true]) {
  async function decode(bytes: Uint8Array) {
    if (!retained) return decodeImage(bytes);
    const signal = new AbortController().signal, storage = new PagedStorage({ fs: new MemoryFileSystem(), cwd: "/", env: {}, signal });
    try {
      const image = await decodeImageToStorage(source(bytes), storage, signal);
      return { ...image, data: await storage.read(image.position, image.width * image.height * 4) };
    } finally { await storage.close(); }
  }

  it(`preserves RGB samples and row order while ignoring padding (${retained})`, async () => {
    expect(Buffer.from((await decode(input())).data)).toEqual(expected);
  });

  it(`rejects unsupported layouts, invalid dimensions, and truncated rasters (${retained})`, async () => {
    for (const [offset, value] of [[4, 0], [8, 0], [12, 8], [20, 2], [24, 1], [28, 3]] as const) {
      const bytes = input(); bytes.writeUInt32BE(value, offset);
      await expect(decode(bytes)).rejects.toThrow();
    }
    for (const length of [4, 31, 32, 51]) await expect(decode(input().subarray(0, length))).rejects.toThrow();
  });
}

it("checks limits before allocation and honors cancellation", async () => {
  const bytes = input(), signal = new AbortController().signal;
  const storage = { allocate: vi.fn(() => 0), write: vi.fn(async () => {}), read: vi.fn(async () => new Uint8Array()) };
  expect(() => decodeImage(bytes, { limitInputPixels: 5 })).toThrow("pixel limit");
  await expect(decodeImageToStorage(source(bytes), storage, signal, { limitInputPixels: 5 })).rejects.toThrow("pixel limit");
  await expect(readImageMetadataFromSource(source(bytes), signal, { limitInputPixels: 5 })).rejects.toThrow("pixel limit");
  await expect(decodeImageToStorage(source(bytes.subarray(0, -1)), storage, signal)).rejects.toThrow("Truncated SUN");
  expect(storage.allocate).not.toHaveBeenCalled();
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await expect(decodeImageToStorage(source(bytes), storage, controller.signal)).rejects.toThrow("cancelled");
});

it("decodes wide rows in bounded chunks and rejects short source reads", async () => {
  const width = 2051, height = 3, stride = width * 3 + 1, bytes = Buffer.alloc(32 + stride * height);
  input().copy(bytes, 0, 0, 32);
  bytes.writeUInt32BE(width, 4); bytes.writeUInt32BE(height, 8); bytes.writeUInt32BE(stride * height, 16);
  for (let i = 32; i < bytes.length; i++) bytes[i] = i % 256;
  const signal = new AbortController().signal, retained = source(bytes), scratch = new Uint8Array(4096);
  retained.read.mockImplementation(async (position, length) => {
    scratch.fill(0); scratch.set(bytes.subarray(position, position + length));
    return scratch.subarray(0, length);
  });
  const storage = new PagedStorage({ fs: new MemoryFileSystem(), cwd: "/", env: {}, signal });
  const write = vi.spyOn(storage, "write");
  try {
    const image = await decodeImageToStorage(retained, storage, signal), pixels = decodeImage(bytes).data;
    for (let offset = 0; offset < pixels.length; offset += 4096) {
      const length = Math.min(4096, pixels.length - offset);
      expect(await storage.read(image.position + offset, length)).toEqual(pixels.subarray(offset, offset + length));
    }
    expect(Math.max(...retained.read.mock.calls.map(([, length]) => length))).toBeLessThanOrEqual(4096);
    expect(Math.max(...write.mock.calls.map(([, chunk]) => chunk.length))).toBeLessThanOrEqual(4096);
    retained.read.mockImplementation(async (position, length) => bytes.subarray(position, position + length - Number(position > 0)));
    await expect(decodeImageToStorage(retained, storage, signal)).rejects.toThrow("Truncated SUN");
  } finally { await storage.close(); }
});
