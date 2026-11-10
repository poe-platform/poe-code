import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { decodeImage, readImageMetadata, decodeImageToStorage, readImageMetadataFromSource } from "./index.js";
import fixtures from "../../../tests/fixtures/media/xwd-fixtures.json" with { type: "json" };

const input = () => new Uint8Array(Buffer.from(fixtures.true, "base64"));
const source = (bytes: Uint8Array) => ({ size: bytes.length, read: vi.fn(async (position: number, length: number) => bytes.subarray(position, position + length)) });

for (const [name, encoded] of Object.entries(fixtures)) {
  it(`reads ${name} XWD metadata without reading pixels`, async () => {
    const bytes = new Uint8Array(Buffer.from(encoded, "base64")), retained = source(bytes);
    const metadata = readImageMetadata(bytes);
    expect(metadata).toMatchObject({ format: "xwd", width: 7, height: 3, channels: 3, hasAlpha: false, size: bytes.length });
    expect(await readImageMetadataFromSource(retained, new AbortController().signal)).toEqual(metadata);
    expect(retained.read.mock.calls.every(([position, length]) => position === 0 && length <= 138)).toBe(true);
  });
}

it.each([
  [0, 99], [0, 999], [8, 1], [12, 0], [16, 0], [20, 0], [24, 1], [28, 2],
  [44, 16], [48, 20], [52, 9], [56, 0], [56, 0xff00], [56, 0xf50000], [76, 1000]
])("rejects invalid or unsupported XWD header field %s=%s", async (offset, value) => {
  const bytes = input();
  new DataView(bytes.buffer).setUint32(offset, value);
  expect(() => decodeImage(bytes)).toThrow(/XWD/);
  await expect(readImageMetadataFromSource(source(bytes), new AbortController().signal)).rejects.toThrow(/XWD/);
});

it("rejects truncated pixels and missing palette entries", () => {
  expect(() => decodeImage(input().subarray(0, -1))).toThrow(/XWD/);
  const indexed = new Uint8Array(Buffer.from(fixtures.indexed, "base64"));
  indexed[149] = 4;
  expect(() => decodeImage(indexed)).toThrow(/XWD palette/);
});

it("uses palette pixel IDs rather than record order", () => {
  const indexed = new Uint8Array(Buffer.from(fixtures.indexed, "base64"));
  const first = indexed.slice(101, 113);
  indexed.copyWithin(101, 137, 149);
  indexed.set(first, 137);
  expect(decodeImage(indexed).data).toEqual(decodeImage(input()).data);
});

it("checks pixel limits before allocating backing and honors cancellation and short reads", async () => {
  const bytes = input(), signal = new AbortController().signal;
  const storage = { allocate: vi.fn(() => 0), write: vi.fn(async () => {}), read: vi.fn(async () => new Uint8Array()) };
  expect(() => decodeImage(bytes, { limitInputPixels: 20 })).toThrow("pixel limit");
  await expect(decodeImageToStorage(source(bytes), storage, signal, { limitInputPixels: 20 })).rejects.toThrow("pixel limit");
  expect(storage.allocate).not.toHaveBeenCalled();
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await expect(decodeImageToStorage(source(bytes), storage, controller.signal)).rejects.toThrow("cancelled");
  const short = source(bytes);
  short.read.mockImplementation(async (position, length) => bytes.subarray(position, position + length - Number(position > 0)));
  await expect(decodeImageToStorage(short, storage, signal)).rejects.toThrow(/Truncated XWD/);
});

it("decodes wide padded rows using bounded source and backing chunks", async () => {
  const width = 3001, stride = width * 3 + 1, bytes = new Uint8Array(101 + stride * 2);
  bytes.set(input().subarray(0, 101));
  const header = new DataView(bytes.buffer);
  header.setUint32(16, width); header.setUint32(20, 2); header.setUint32(48, stride);
  for (let y = 0; y < 2; y++) for (let x = 0; x < width; x++) bytes.set([x % 256, y * 123, 17], 101 + y * stride + x * 3);
  const retained = source(bytes), signal = new AbortController().signal;
  const storage = new PagedStorage({ fs: new MemoryFileSystem(), cwd: "/", env: {}, signal });
  const write = vi.spyOn(storage, "write");
  try {
    const decoded = await decodeImageToStorage(retained, storage, signal);
    const expected = decodeImage(bytes).data;
    for (let offset = 0; offset < expected.length; offset += 4096) {
      const length = Math.min(4096, expected.length - offset);
      expect(await storage.read(decoded.position + offset, length)).toEqual(expected.subarray(offset, offset + length));
    }
    expect(Math.max(...retained.read.mock.calls.map(([, length]) => length))).toBeLessThanOrEqual(4096);
    expect(Math.max(...write.mock.calls.map(([, chunk]) => chunk.length))).toBeLessThanOrEqual(4096);
  } finally { await storage.close(); }
});
