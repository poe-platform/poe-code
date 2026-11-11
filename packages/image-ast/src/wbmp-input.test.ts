import { expect, it, vi } from "vitest";
import { decodeImage, readImageMetadata } from "./codecs/index.js";
import { decodeImageToStorage } from "./codecs/source-decode.js";
import { readImageMetadataFromSource } from "./codecs/metadata-source.js";

const source = (bytes: Uint8Array) => ({ size: bytes.length, async read(offset: number, length: number) {
  expect(length).toBeLessThanOrEqual(4096);
  return bytes.subarray(offset, offset + length);
} });
const signal = () => new AbortController().signal;
const dimension = (n: number): number[] => n < 128 ? [n] : [...dimension(Math.floor(n / 128)).map(byte => byte | 128), n % 128];

it.each([[1, 2], [7, 2], [8, 2], [9, 2], [1, 259], [259, 2], [2051, 17]])("decodes padded WBMP rows %sx%s through buffered and retained APIs", async (width, height) => {
  const stride = Math.ceil(width / 8);
  const input = Uint8Array.from([0, 0, ...dimension(width), ...dimension(height), ...Array.from({ length: stride * height }, (_, i) => Math.floor(i / stride) % 2 ? 0x55 : 0xaa)]);
  const image = decodeImage(input), data = new Uint8Array(width * height * 4);
  const metadata = readImageMetadata(input);
  expect(metadata).toMatchObject({ format: "wbmp", width, height, channels: 1, hasAlpha: false, bitsPerSample: 1, size: input.length });
  expect(await readImageMetadataFromSource(source(input), signal())).toEqual(metadata);
  const retained = await decodeImageToStorage(source(input), {
    allocate(length) { expect(length).toBe(data.length); return 0; },
    async read(offset, length) { return data.subarray(offset, offset + length); },
    async write(offset, bytes) { expect(bytes.length).toBeLessThanOrEqual(4096); data.set(bytes, offset); }
  }, signal());
  expect(retained).toMatchObject({ ...metadata, position: 0 });
  expect(Buffer.from(data).equals(Buffer.from(image.data))).toBe(true);
  const expected = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = (x + y) % 2 ? 0 : 255;
    expected.set([value, value, value, 255], (y * width + x) * 4);
  }
  expect(Buffer.from(data).equals(Buffer.from(expected))).toBe(true);
});

it.each([
  "0000", "000080", "00000180", "00000001", "00000100", "00000902800080",
  "0000908080800001", "00008180808080800001", "0100010180", "0001010180"
])("rejects invalid WBMP headers or truncated pixels: %s", async hex => {
  const input = Buffer.from(hex, "hex");
  expect(() => decodeImage(input)).toThrow();
  const allocate = vi.fn(() => 0);
  await expect(decodeImageToStorage(source(input), { allocate, async read() { return new Uint8Array(); }, async write() {} }, signal())).rejects.toThrow();
  expect(allocate).not.toHaveBeenCalled();
});

it("checks pixel limits and cancellation before allocating storage", async () => {
  const input = Buffer.from("0000090280008000", "hex"), options = { limitInputPixels: 17 };
  expect(() => decodeImage(input, options)).toThrow("pixel limit");
  await expect(readImageMetadataFromSource(source(input), signal(), options)).rejects.toThrow("pixel limit");
  const allocate = vi.fn(() => 0), storage = { allocate, async read() { return new Uint8Array(); }, async write() {} };
  await expect(decodeImageToStorage(source(input), storage, signal(), options)).rejects.toThrow("pixel limit");
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await expect(decodeImageToStorage(source(input), storage, controller.signal)).rejects.toThrow("cancelled");
  expect(allocate).not.toHaveBeenCalled();
});

it("rejects short retained source reads", async () => {
  const input = Uint8Array.from([0, 0, 8, 100, ...new Array<number>(100).fill(255)]);
  await expect(decodeImageToStorage({ size: input.length, async read(offset, length) {
    return input.subarray(offset, offset + length - (length > 54 ? 1 : 0));
  } }, { allocate() { return 0; }, async read() { return new Uint8Array(); }, async write() {} }, signal())).rejects.toThrow("Truncated WBMP source");
});
