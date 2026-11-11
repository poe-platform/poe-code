import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { decodeImage, readImageMetadata, decodeImageToStorage, readImageMetadataFromSource } from "./index.js";
import fixture from "../../../tests/fixtures/media/sixel-fixture.json" with { type: "json" };

const native = new TextEncoder().encode(fixture.sixel);
const sixel = (body: string) => new TextEncoder().encode(`\x1bP0;1;0q${body}\x1b\\`);
const source = (bytes: Uint8Array) => ({ size: bytes.length, read: vi.fn(async (position: number, length: number) => bytes.subarray(position, position + length)) });

it("reads native SIXEL metadata through buffered and retained sources", async () => {
  const metadata = readImageMetadata(native);
  expect(metadata).toMatchObject({ format: "sixel", width: 256, height: 128, hasAlpha: true, size: native.length });
  expect(await readImageMetadataFromSource(source(native), new AbortController().signal)).toEqual(metadata);
});

for (const retained of [false, true]) {
  async function decode(bytes: Uint8Array) {
    if (!retained) return decodeImage(bytes);
    const signal = new AbortController().signal, storage = new PagedStorage({ fs: new MemoryFileSystem(), cwd: "/", env: {}, signal });
    try {
      const image = await decodeImageToStorage(source(bytes), storage, signal);
      const data = new Uint8Array(image.width * image.height * 4);
      for (let offset = 0; offset < data.length; offset += 4096) data.set(await storage.read(image.position + offset, Math.min(4096, data.length - offset)), offset);
      return { ...image, data };
    } finally { await storage.close(); }
  }

  it(`matches every native SIXEL RGBA sample (${retained ? "retained" : "buffered"})`, async () => {
    expect(createHash("sha256").update((await decode(native)).data).digest("hex")).toBe(fixture.rgbaSha256);
  });

  it(`handles repeats, overlays, bands, and a partial last band (${retained ? "retained" : "buffered"})`, async () => {
    const image = await decode(sixel('"1;1;3;8#1;2;100;0;0!3~$#2;2;0;100;0?@-#1!3B'));
    expect([image.width, image.height]).toEqual([3, 8]);
    const expected = new Uint8Array(3 * 8 * 4);
    for (let i = 0; i < expected.length; i += 4) expected.set([255, 0, 0, 255], i);
    expected.set([0, 255, 0, 255], 4);
    expect(image.data).toEqual(expected);
  });

  it(`uses final palette definitions and fills unpainted pixels (${retained ? "retained" : "buffered"})`, async () => {
    const image = await decode(sixel('"1;1;3;1#900@#900;2;100;0;0#0;2;0;0;100'));
    expect(Array.from(image.data)).toEqual([255,0,0,255, 0,0,255,255, 0,0,255,255]);
    const hls = await decode(sixel('#1;1;120;50;100@'));
    expect(Array.from(hls.data)).toEqual([255,0,0,255]);
  });

  it(`accepts eight-bit DCS/ST and derives dimensions from painted pixels (${retained ? "retained" : "buffered"})`, async () => {
    const bytes = Uint8Array.from([0x90, ...new TextEncoder().encode('q#1;2;100;0;0!3@-?B'), 0x9c]);
    const image = await decode(bytes);
    expect([image.width, image.height]).toEqual([3, 8]);
    expect(Array.from(image.data.slice(-8, -4))).toEqual([255,0,0,255]);
  });

  it(`rejects malformed and truncated SIXEL streams (${retained ? "retained" : "buffered"})`, async () => {
    for (const body of ['!0~', '!12', '#1024@', '#1;3;0;0;0@', '"1', '!999999999999~', '"1;1;2147483647;2']) {
      await expect(decode(sixel(body))).rejects.toThrow("SIXEL");
    }
    await expect(decode(native.subarray(0, -2))).rejects.toThrow("SIXEL");
  });
}

it("checks SIXEL pixel limits before allocation and honors cancellation and short reads", async () => {
  const signal = new AbortController().signal;
  const storage = { allocate: vi.fn(() => 0), write: vi.fn(async () => {}), read: vi.fn(async () => new Uint8Array()) };
  for (const bytes of [native, sixel('!1024~')]) {
    expect(() => decodeImage(bytes, { limitInputPixels: 100 })).toThrow("pixel limit");
    await expect(decodeImageToStorage(source(bytes), storage, signal, { limitInputPixels: 100 })).rejects.toThrow("pixel limit");
  }
  expect(storage.allocate).not.toHaveBeenCalled();
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await expect(decodeImageToStorage(source(native), storage, controller.signal)).rejects.toThrow("cancelled");
  const short = source(native);
  short.read.mockImplementation(async (position, length) => native.subarray(position, position + length - Number(length > 138)));
  await expect(decodeImageToStorage(short, storage, signal)).rejects.toThrow("Truncated SIXEL");
});

it("keeps retained reads and writes bounded with borrowed pages and wide repeats", async () => {
  const bytes = sixel('"1;1;3001;6#1;2;100;0;0!3001~' + '\n'.repeat(5000));
  const signal = new AbortController().signal, retained = source(bytes), scratch = new Uint8Array(4096);
  retained.read.mockImplementation(async (position, length) => {
    scratch.fill(0); scratch.set(bytes.subarray(position, position + length));
    return scratch.subarray(0, length);
  });
  const storage = new PagedStorage({ fs: new MemoryFileSystem(), cwd: "/", env: {}, signal });
  const write = vi.spyOn(storage, "write");
  try {
    const image = await decodeImageToStorage(retained, storage, signal);
    const expected = decodeImage(bytes).data;
    for (let offset = 0; offset < expected.length; offset += 4096) {
      const length = Math.min(4096, expected.length - offset);
      expect(await storage.read(image.position + offset, length)).toEqual(expected.subarray(offset, offset + length));
    }
    expect(Math.max(...retained.read.mock.calls.map(([, length]) => length))).toBeLessThanOrEqual(4096);
    expect(Math.max(...write.mock.calls.map(([, chunk]) => chunk.length))).toBeLessThanOrEqual(4096);
  } finally { await storage.close(); }
});
