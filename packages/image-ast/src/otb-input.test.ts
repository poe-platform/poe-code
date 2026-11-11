import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { isOtbBytes } from "./codecs/otb-input.js";
import { decodeImage, readImageMetadata, decodeImageToStorage, readImageMetadataFromSource } from "./index.js";

const input = () => Uint8Array.of(0, 9, 2, 1, 165, 128, 90, 0);
const source = (bytes: Uint8Array) => ({ size: bytes.length, read: vi.fn(async (position: number, length: number) => bytes.subarray(position, position + length)) });

it("reports OTB dimensions and bilevel metadata through both readers", async () => {
  const bytes = input(), metadata = readImageMetadata(bytes);
  expect(metadata).toMatchObject({ format: "otb", width: 9, height: 2, channels: 1, space: "b-w", bitsPerSample: 1, hasAlpha: false, size: bytes.length });
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

  it(`reads black bits first and discards row padding (${retained ? "retained" : "buffered"})`, async () => {
    const expected = Uint8Array.from([0,255,0,255,255,0,255,0,0, 255,0,255,0,0,255,0,255,255].flatMap(value => [value,value,value,255]));
    expect((await decode(input())).data).toEqual(expected);
    const padded = input(); padded[5] = 255; padded[7] = 127;
    expect((await decode(padded)).data).toEqual(expected);
  });

  it(`reads extended dimensions for tall images (${retained ? "retained" : "buffered"})`, async () => {
    const bytes = new Uint8Array(6 + 259);
    bytes.set([16, 0, 1, 1, 3, 1]); bytes.fill(128, 6);
    const image = await decode(bytes);
    expect(image).toMatchObject({ width: 1, height: 259 });
    expect(image.data).toEqual(Uint8Array.from({ length: 259 * 4 }, (_, i) => i % 4 === 3 ? 255 : 0));
  });

  it(`rejects invalid headers and truncated rasters (${retained ? "retained" : "buffered"})`, async () => {
    for (const [offset, value] of [[0, 128], [2, 0], [3, 2]] as const) {
      const bytes = input(); bytes[offset] = value;
      await expect(decode(bytes)).rejects.toThrow();
    }
    await expect(decode(Uint8Array.of(16, 0, 0, 0, 2, 1, 0, 0))).rejects.toThrow();
    for (const length of [0, 1, 3, 4, 7]) await expect(decode(input().subarray(0, length))).rejects.toThrow();
  });
}

it("checks pixel limits and truncation before allocating, and honors cancellation", async () => {
  const bytes = input(), signal = new AbortController().signal;
  const storage = { allocate: vi.fn(() => 0), write: vi.fn(async () => {}), read: vi.fn(async () => new Uint8Array()) };
  expect(() => decodeImage(bytes, { limitInputPixels: 17 })).toThrow("pixel limit");
  await expect(decodeImageToStorage(source(bytes), storage, signal, { limitInputPixels: 17 })).rejects.toThrow("pixel limit");
  await expect(readImageMetadataFromSource(source(bytes), signal, { limitInputPixels: 17 })).rejects.toThrow("pixel limit");
  await expect(decodeImageToStorage(source(bytes.subarray(0, -1)), storage, signal)).rejects.toThrow("Truncated OTB");
  expect(storage.allocate).not.toHaveBeenCalled();
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await expect(decodeImageToStorage(source(bytes), storage, controller.signal)).rejects.toThrow("cancelled");
});

it("decodes wide OTB rows in bounded chunks from borrowed source pages", async () => {
  const width = 4097, height = 9, bytes = new Uint8Array(6 + Math.ceil(width / 8) * height);
  bytes.set([16, 16, 1, 0, height, 1]);
  for (let i = 6; i < bytes.length; i++) bytes[i] = i % 256;
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
    retained.read.mockImplementation(async (position, length) => bytes.subarray(position, position + length - Number(position > 0)));
    await expect(decodeImageToStorage(retained, storage, signal)).rejects.toThrow("Truncated OTB");
  } finally { await storage.close(); }
});

it("does not misidentify a one-row WBMP header as OTB", () => {
  expect(isOtbBytes(Uint8Array.of(0, 0, 9, 1, 165, 128))).toBe(false);
});

it("recognizes the smallest OTB bitmap independently of WBMP", () => {
  expect(decodeImage(Uint8Array.of(0, 1, 1, 1, 128))).toMatchObject({ format: "otb", width: 1, height: 1, data: Uint8Array.of(0, 0, 0, 255) });
});
