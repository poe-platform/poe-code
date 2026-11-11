import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { decodeImage, readImageMetadata, decodeImageToStorage, readImageMetadataFromSource } from "./index.js";

const input = () => new Uint8Array(Buffer.from("00090002000240000100000000ff0000a5ff5a7f", "hex"));
const source = (bytes: Uint8Array) => ({ size: bytes.length, read: vi.fn(async (position: number, length: number) => bytes.subarray(position, position + length)) });

it("reports one-bit Palm metadata through both readers", async () => {
  const bytes = input(), metadata = readImageMetadata(bytes);
  expect(metadata).toMatchObject({ format: "palm", width: 9, height: 2, channels: 1, space: "b-w", bitsPerSample: 1, hasAlpha: false, size: bytes.length });
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

  it(`preserves Palm row order, MSB-first black bits, and word padding (${retained})`, async () => {
    const expected = Uint8Array.from([0,255,0,255,255,0,255,0,0, 255,0,255,0,0,255,0,255,255].flatMap(value => [value,value,value,255]));
    expect((await decode(input())).data).toEqual(expected);
    const padded = input(); padded[1] = 1;
    expect((await decode(padded)).data).toEqual(Uint8Array.of(0,0,0,255, 255,255,255,255));
  });

  it(`rejects truncated and unsupported Palm inputs (${retained})`, async () => {
    for (const length of [0, 8, 15, 19]) await expect(decode(input().subarray(0, length))).rejects.toThrow();
    for (const [offset, value] of [[1,0], [3,0], [5,1], [6,128], [8,2], [9,3], [13,1]] as const) {
      const bytes = input(); bytes[offset] = value;
      await expect(decode(bytes)).rejects.toThrow();
    }
  });

  it(`distinguishes tall Palm bitmaps from OTB headers (${retained})`, async () => {
    const bytes = new Uint8Array(16 + 2 * 257);
    bytes.set(input().subarray(0, 16)); bytes[2] = 1; bytes[3] = 1;
    const image = await decode(bytes);
    expect(image).toMatchObject({ format: "palm", width: 9, height: 257 });
    expect(image.data).toEqual(new Uint8Array(9 * 257 * 4).fill(255));
  });
}

it("checks Palm pixel limits and truncation before allocation and honors cancellation", async () => {
  const bytes = input(), signal = new AbortController().signal;
  const storage = { allocate: vi.fn(() => 0), write: vi.fn(async () => {}), read: vi.fn(async () => new Uint8Array()) };
  expect(() => decodeImage(bytes, { limitInputPixels: 17 })).toThrow("pixel limit");
  await expect(decodeImageToStorage(source(bytes), storage, signal, { limitInputPixels: 17 })).rejects.toThrow("pixel limit");
  await expect(readImageMetadataFromSource(source(bytes), signal, { limitInputPixels: 17 })).rejects.toThrow("pixel limit");
  await expect(decodeImageToStorage(source(bytes.subarray(0, -1)), storage, signal)).rejects.toThrow();
  expect(storage.allocate).not.toHaveBeenCalled();
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await expect(decodeImageToStorage(source(bytes), storage, controller.signal)).rejects.toThrow("cancelled");
});

it("decodes wide Palm rows in bounded chunks from borrowed source pages", async () => {
  const width = 4097, height = 9, stride = Math.ceil(width / 16) * 2, bytes = new Uint8Array(16 + stride * height);
  bytes.set(input().subarray(0, 16));
  const view = new DataView(bytes.buffer);
  view.setUint16(0, width); view.setUint16(2, height); view.setUint16(4, stride);
  for (let i = 16; i < bytes.length; i++) bytes[i] = i % 256;
  const signal = new AbortController().signal, retained = source(bytes), scratch = new Uint8Array(4096);
  retained.read.mockImplementation(async (position, length) => {
    scratch.fill(0); scratch.set(bytes.subarray(position, position + length));
    return scratch.subarray(0, length);
  });
  const storage = new PagedStorage({ fs: new MemoryFileSystem(), cwd: "/", env: {}, signal }), write = vi.spyOn(storage, "write");
  try {
    const image = await decodeImageToStorage(retained, storage, signal), expected = decodeImage(bytes).data;
    for (let offset = 0; offset < expected.length; offset += 4096) {
      const length = Math.min(4096, expected.length - offset);
      expect(await storage.read(image.position + offset, length)).toEqual(expected.subarray(offset, offset + length));
    }
    expect(Math.max(...retained.read.mock.calls.map(([, length]) => length))).toBeLessThanOrEqual(4096);
    expect(Math.max(...write.mock.calls.map(([, chunk]) => chunk.length))).toBeLessThanOrEqual(4096);
    retained.read.mockImplementation(async (position, length) => bytes.subarray(position, position + length - Number(position > 0)));
    await expect(decodeImageToStorage(retained, storage, signal)).rejects.toThrow("Truncated PALM");
  } finally { await storage.close(); }
});
