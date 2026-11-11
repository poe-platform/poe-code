import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { decodeImage, readImageMetadata, decodeImageToStorage, readImageMetadataFromSource } from "./index.js";
import fixtures from "../../../tests/fixtures/media/sgi-input-fixtures.json" with { type: "json" };

const input = () => new Uint8Array(Buffer.from(fixtures.rowssgi.input, "base64"));
const source = (bytes: Uint8Array) => ({ size: bytes.length, read: vi.fn(async (offset: number, length: number) => bytes.subarray(offset, offset + length)) });

it("reads native SGI metadata through both input paths", async () => {
  const bytes = input(), metadata = readImageMetadata(bytes);
  expect(metadata).toMatchObject({ format: "sgi", width: 3, height: 2, channels: 3, hasAlpha: false, size: bytes.length });
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

  it(`decodes native bottom-up SGI rows (${retained})`, async () => {
    expect((await decode(input())).data).toEqual(Uint8Array.from(Buffer.from("ff0000ff00ff00ff0000ffffffee00ff991177ff245384ff", "hex")));
  });

  it.each([1, 2, 3, 4])(`decodes verbatim SGI with %i channels (${retained})`, async channels => {
    const bytes = new Uint8Array(512 + 2 * channels); bytes.set(input().subarray(0, 512));
    const view = new DataView(bytes.buffer);
    bytes[2] = 0; view.setUint16(6, 1); view.setUint16(8, 2); view.setUint16(10, channels);
    bytes.set([10, 20, 30, 40, 50, 60, 70, 80].slice(0, channels * 2), 512);
    expect((await decode(bytes)).data).toEqual(Uint8Array.from([
      20, channels < 3 ? 20 : 40, channels < 3 ? 20 : 60, channels % 2 ? 255 : channels * 20,
      10, channels < 3 ? 10 : 30, channels < 3 ? 10 : 50, channels % 2 ? 255 : channels * 20 - 10
    ]));
  });

  it(`rejects invalid SGI row tables and RLE packets (${retained})`, async () => {
    for (const length of [100, 511, 550, input().length - 1]) await expect(decode(input().subarray(0, length))).rejects.toThrow("SGI");
    for (const [tableOffset, value] of [[512, 511], [512, 0xffffffff], [536, 0], [536, 0xffffffff]]) {
      const bytes = input(); new DataView(bytes.buffer).setUint32(tableOffset!, value!);
      await expect(decode(bytes)).rejects.toThrow("SGI");
    }
    for (const marker of [0, 4, 132]) {
      const bytes = input(), view = new DataView(bytes.buffer); bytes[view.getUint32(512)] = marker;
      await expect(decode(bytes)).rejects.toThrow("SGI");
    }
    const bytes = input(), view = new DataView(bytes.buffer);
    view.setUint32(536, view.getUint32(536) - 1);
    await expect(decode(bytes)).rejects.toThrow("SGI");
  });

  it.each([[2, 2], [3, 2], [5, 0], [7, 0], [11, 5], [107, 1]])(`rejects invalid SGI header field %i=%i (${retained})`, async (offset, value) => {
    const bytes = input(); bytes[offset] = value;
    await expect(decode(bytes)).rejects.toThrow("SGI");
  });
}

it("checks SGI pixel limits before allocation, cancellation and short reads", async () => {
  const bytes = input(), signal = new AbortController().signal;
  const storage = { allocate: vi.fn(() => 0), write: vi.fn(async () => {}), read: vi.fn(async () => new Uint8Array()) };
  expect(() => decodeImage(bytes, { limitInputPixels: 5 })).toThrow("pixel limit");
  await expect(decodeImageToStorage(source(bytes), storage, signal, { limitInputPixels: 5 })).rejects.toThrow("pixel limit");
  expect(storage.allocate).not.toHaveBeenCalled();
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await expect(decodeImageToStorage(source(bytes), storage, controller.signal)).rejects.toThrow("cancelled");
  const short = source(bytes);
  short.read.mockImplementation(async (offset, length) => bytes.subarray(offset, offset + length - Number(length > 108)));
  await expect(decodeImageToStorage(short, storage, signal)).rejects.toThrow("Truncated SGI");
});

it("decodes wide SGI rows with borrowed source pages and bounded output chunks", async () => {
  const width = 3001, bytes = new Uint8Array(512 + width * 2 * 3); bytes.set(input().subarray(0, 512));
  bytes[2] = 0; new DataView(bytes.buffer).setUint16(6, width);
  for (let i = 512; i < bytes.length; i++) bytes[i] = i % 256;
  const signal = new AbortController().signal, retained = source(bytes), scratch = new Uint8Array(4096);
  retained.read.mockImplementation(async (offset, length) => {
    scratch.fill(0); scratch.set(bytes.subarray(offset, offset + length)); return scratch.subarray(0, length);
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
  } finally { await storage.close(); }
});
