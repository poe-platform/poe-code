import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp, { encodeImage, type RgbaImage } from "./index.js";
import { encodePalmFromStorage } from "./codecs/palm-output.js";

const image = (width: number, height: number, data: Uint8Array): RgbaImage => ({
  width, height, data, format: "png", space: "srgb", channels: 3, depth: "uchar", hasAlpha: false, density: 72
});

for (const [shades, raster] of [
  [[255, 0, 255], "4000"],
  [[255, 128, 0], "1c00"],
  [[255, 192, 128, 64, 0], "037bf000"]
] as const) it(`packs ${shades.length} grayscale samples with zero word padding`, async () => {
  const data = Uint8Array.from(shades.flatMap(value => [value, value, value, 255]));
  const source = image(shades.length, 1, data);
  const bytes = encodeImage(source, { format: "palm" }).data;
  expect(Buffer.from(bytes.subarray(16)).toString("hex")).toBe(raster);
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/in.png", encodeImage(source, { format: "png" }).data);
  const info = await sharp("/in.png", { filesystem }).toFile("/out.palm");
  expect(info).toMatchObject({ format: "palm", width: shades.length, height: 1, size: bytes.length });
  expect(await filesystem.readFile("/out.palm")).toEqual(bytes);
  expect(sharp(encodeImage(source, { format: "png" }).data).toFormat("palm").toBufferSync()).toEqual(bytes);
});

it("writes indexed RGB colors and an 8-bit palette", () => {
  const data = Uint8Array.from(Array.from({ length: 17 }, (_, i) => [i * 15, 0, 255 - i * 15, 255]).flat());
  const bytes = encodeImage(image(17, 1, data), { format: "palm" }).data;
  expect(Buffer.from(bytes.subarray(0, 18)).toString("hex")).toBe("00110001001240000801000000ff00000011");
  expect([...bytes.subarray(18, 26)]).toEqual([0, 0, 0, 255, 1, 15, 0, 240]);
  expect([...bytes.subarray(86)]).toEqual([...Array.from({ length: 17 }, (_, i) => i), 0]);
});

it("writes RGB565 direct color and transparent color components", () => {
  const data = Uint8Array.from(Array.from({ length: 257 }, (_, i) => [i % 256, i >> 8, 255, i === 256 ? 0 : 255]).flat());
  const bytes = encodeImage({ ...image(257, 1, data), hasAlpha: true, channels: 4 }, { format: "palm" }).data;
  expect(Buffer.from(bytes.subarray(0, 24)).toString("hex")).toBe("01010001020224001001000000ff0000050605000000001f");
  expect([...bytes.subarray(24, 26)]).toEqual([0, 31]);
  expect([...bytes.subarray(24 + 255 * 2, 24 + 256 * 2)]).toEqual([248, 31]);
});

for (const highDepth of [false, true]) it(`streams wide rows with bounded reads and preserves ${highDepth ? 16 : 8}-bit color distinctions`, async () => {
  const width = 4097, height = 2;
  const samples = Uint16Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 65535 : Math.floor(i / 4) % 2 ? 25701 : 25700);
  const data = Uint8Array.from(samples, value => Math.round(value / 257));
  const source = { ...image(width, height, data), ...(highDepth ? { data16: samples } : {}) };
  const stored = highDepth ? new Uint8Array(samples.buffer) : data, scratch = new Uint8Array(4096);
  const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async (position: number, length: number) => {
    expect(length).toBeLessThanOrEqual(4096);
    scratch.set(stored.subarray(position, position + length));
    return scratch.subarray(0, length);
  }) };
  const chunks: Uint8Array[] = [];
  for await (const bytes of encodePalmFromStorage({ ...image(width, height, data), position: 0, ...(highDepth ? { storedData16: { position: 0, length: samples.length } } : {}) }, storage, new AbortController().signal)) chunks.push(bytes);
  const result = Buffer.concat(chunks);
  expect(result).toEqual(Buffer.from(encodeImage(source, { format: "palm" }).data));
  expect(result[16]).toBe(highDepth ? 0xaa : 0);
  expect(result.length).toBe(16 + 514 * 2);
  expect(storage.allocate).not.toHaveBeenCalled();
  expect(storage.write).not.toHaveBeenCalled();
});

it("rejects unrepresentable dimensions, truncated pixels, and cancellation", async () => {
  expect(() => encodeImage(image(65536, 1, new Uint8Array(65536 * 4)), { format: "palm" })).toThrow("Invalid PALM dimensions");
  expect(() => encodeImage(image(2, 1, new Uint8Array(4)), { format: "palm" })).toThrow("Invalid PALM pixels");
  const source = { ...image(2, 1, new Uint8Array(8)), position: 0 };
  const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async () => new Uint8Array(7)) };
  await expect(encodePalmFromStorage(source, storage, new AbortController().signal).next()).rejects.toThrow("Truncated PALM pixel storage");
  storage.read.mockClear();
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await expect(encodePalmFromStorage(source, storage, controller.signal).next()).rejects.toThrow("cancelled");
  expect(storage.read).not.toHaveBeenCalled();
});

it("links differently sized bitmap records, padding only before the next record", async () => {
  const pages = [image(2, 1, new Uint8Array(8)), image(16, 2, new Uint8Array(128)), image(1, 1, new Uint8Array(4))];
  const expected = Buffer.from("00020001000240000100000500ff000000000000" + "00100002000240000100000500ff000000000000" + "00010001000240000100000000ff00000000", "hex");
  expect(encodeImage({ ...pages[0]!, palmPages: pages }, { format: "palm" }).data).toEqual(new Uint8Array(expected));
  const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async (_position: number, length: number) => new Uint8Array(length)) };
  const at = vi.fn(async (index: number) => ({ ...pages[index]!, position: 0 }));
  const chunks: Uint8Array[] = [];
  for await (const bytes of encodePalmFromStorage({ ...pages[0]!, position: 0, storedPalmPages: { length: pages.length, at } }, storage, new AbortController().signal)) chunks.push(bytes);
  expect(Buffer.concat(chunks)).toEqual(expected);
  expect(at.mock.calls).toEqual([[0], [1], [2]]);
  expect(storage.allocate).not.toHaveBeenCalled();
  expect(storage.write).not.toHaveBeenCalled();
});

it("rejects a next-record offset that cannot fit in the Palm header", async () => {
  const page = image(65535, 32, new Uint8Array(65535 * 32 * 4));
  expect(() => encodeImage({ ...page, palmPages: [page, page] }, { format: "palm" })).toThrow("PALM next bitmap offset exceeds 16 bits");
  const storage = { allocate: vi.fn(), write: vi.fn(), read: vi.fn(async (_position: number, length: number) => new Uint8Array(length)) };
  const output = encodePalmFromStorage({ ...page, position: 0, storedPalmPages: { length: 2, async at() { return { ...page, position: 0 }; } } }, storage, new AbortController().signal);
  await expect(output.next()).rejects.toThrow("PALM next bitmap offset exceeds 16 bits");
});
