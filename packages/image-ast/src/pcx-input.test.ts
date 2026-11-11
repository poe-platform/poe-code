import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { decodeImage, readImageMetadata, decodeImageToStorage, readImageMetadataFromSource } from "./index.js";
import fixtures from "../../../tests/fixtures/media/pcx-fixtures.json" with { type: "json" };

const input = () => new Uint8Array(Buffer.from(fixtures.rgb, "base64"));
const source = (bytes: Uint8Array) => ({ size: bytes.length, read: vi.fn(async (position: number, length: number) => bytes.subarray(position, position + length)) });

it("reads native PCX dimensions and independent horizontal and vertical DPI", async () => {
  const bytes = input(), retained = source(bytes);
  const metadata = readImageMetadata(bytes);
  expect(metadata).toMatchObject({ format: "pcx", width: 3, height: 2, channels: 3, hasAlpha: false, size: bytes.length,
    density: 36, resolution: { x: 36, y: 72, unit: "inch" } });
  expect(await readImageMetadataFromSource(retained, new AbortController().signal)).toEqual(metadata);
  expect(retained.read.mock.calls.every(([position, length]) => position === 0 && length <= 138)).toBe(true);
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

  it(`decodes the native PCX fixture (${retained ? "retained" : "buffered"})`, async () => {
    const image = await decode(input());
    expect(Buffer.from(image.data).toString("hex")).toBe("ff0000ff00ff00ff0000ffffffee00ff991177ff245384ff");
    expect(image.resolution).toEqual({ x: 36, y: 72, unit: "inch" });
  });

  it.each([0, 1])(`discards per-plane padding with encoding %s (${retained ? "retained" : "buffered"})`, async encoding => {
    const header = input().slice(0, 128);
    header[2] = encoding; header[66] = 4;
    const raster = Uint8Array.of(255,0,0,197, 0,255,0,198, 0,0,255,199, 255,153,36,200, 238,17,83,201, 0,119,132,202);
    const payload = encoding ? Uint8Array.from(Array.from(raster).flatMap(value => value >= 192 ? [193, value] : [value])) : raster;
    const bytes = new Uint8Array(128 + payload.length);
    bytes.set(header); bytes.set(payload, 128);
    expect((await decode(bytes)).data).toEqual((await decode(input())).data);
  });

  it(`rejects truncated pixels, zero and overflowing runs (${retained ? "retained" : "buffered"})`, async () => {
    await expect(decode(input().subarray(0, -1))).rejects.toThrow("PCX");
    for (const marker of [192, 255]) {
      const bytes = input(); bytes[128] = marker;
      await expect(decode(bytes)).rejects.toThrow("PCX run");
    }
    await expect(decode(input().subarray(0, 129))).rejects.toThrow("PCX");
  });

  it.each([[2, 2], [3, 4], [65, 1], [66, 2], [4, 4], [8, 3]])(`rejects invalid PCX header field %s=%s (${retained ? "retained" : "buffered"})`, async (offset, value) => {
    const bytes = input(); bytes[offset] = value;
    await expect(decode(bytes)).rejects.toThrow("PCX");
  });
}

it("checks PCX pixel limits before allocation and honors cancellation and short reads", async () => {
  const bytes = input(), signal = new AbortController().signal;
  const storage = { allocate: vi.fn(() => 0), write: vi.fn(async () => {}), read: vi.fn(async () => new Uint8Array()) };
  expect(() => decodeImage(bytes, { limitInputPixels: 5 })).toThrow("pixel limit");
  await expect(decodeImageToStorage(source(bytes), storage, signal, { limitInputPixels: 5 })).rejects.toThrow("pixel limit");
  expect(storage.allocate).not.toHaveBeenCalled();
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await expect(decodeImageToStorage(source(bytes), storage, controller.signal)).rejects.toThrow("cancelled");
  const short = source(bytes);
  short.read.mockImplementation(async (position, length) => bytes.subarray(position, position + length - Number(length > 128)));
  await expect(decodeImageToStorage(short, storage, signal)).rejects.toThrow("Truncated PCX");
});

it("decodes wide PCX rows with bounded, borrowed source pages and output chunks", async () => {
  const width = 3001, stride = 3002, bytes = new Uint8Array(128 + stride * 3 * 2);
  bytes.set(input().subarray(0, 128)); bytes[2] = 0;
  const header = new DataView(bytes.buffer);
  header.setUint16(8, width - 1, true); header.setUint16(66, stride, true);
  for (let i = 128; i < bytes.length; i++) bytes[i] = i % 256;
  const signal = new AbortController().signal, retained = source(bytes), scratch = new Uint8Array(4096);
  retained.read.mockImplementation(async (position, length) => {
    scratch.fill(0); scratch.set(bytes.subarray(position, position + length));
    return scratch.subarray(0, length);
  });
  const storage = new PagedStorage({ fs: new MemoryFileSystem(), cwd: "/", env: {}, signal });
  const write = vi.spyOn(storage, "write");
  try {
    const image = await decodeImageToStorage(retained, storage, signal), expected = decodeImage(bytes).data;
    for (let offset = 0; offset < expected.length; offset += 4096) {
      const length = Math.min(4096, expected.length - offset);
      expect(await storage.read(image.position + offset, length)).toEqual(expected.subarray(offset, offset + length));
    }
    expect(Math.max(...retained.read.mock.calls.map(([, length]) => length))).toBeLessThanOrEqual(4096);
    expect(Math.max(...write.mock.calls.map(([, chunk]) => chunk.length))).toBeLessThanOrEqual(4096);
  } finally { await storage.close(); }
});
