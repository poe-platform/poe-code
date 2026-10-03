import {deflateSync} from "node:zlib";
import {expect, it, vi} from "vitest";
import {decodePngToStorage, type ImageByteStorage} from "./png-storage.js";
import {decodePngImage} from "./png.js";

function chunk(name: string, bytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(bytes.length + 12);
  const view = new DataView(output.buffer);
  view.setUint32(0, bytes.length);
  output.set(new TextEncoder().encode(name), 4); output.set(bytes, 8);
  let crc = 0xffffffff;
  for (const byte of output.subarray(4, -4)) {crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);}
  view.setUint32(output.length - 4, (crc ^ 0xffffffff) >>> 0);
  return output;
}
function png(extras: Uint8Array[] = [], compressed = deflateSync(Uint8Array.of(0, 5, 6, 7, 8)), width = 1, height = 1, depth = 8, color = 6): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header[8] = depth; header[9] = color;
  return Buffer.concat([Uint8Array.of(137,80,78,71,13,10,26,10), chunk("IHDR", header), ...extras, chunk("IDAT", compressed), chunk("IEND", new Uint8Array())]);
}
function capabilities(bytes: Uint8Array) {
  const backing = new Uint8Array(131072), borrowed = new Uint8Array(4096);
  let end = 8;
  const read = (bytes: Uint8Array, offset: number, length: number): Uint8Array => {
    expect(length).toBeLessThanOrEqual(4096);
    borrowed.fill(255); borrowed.set(bytes.subarray(offset, offset + length));
    return borrowed.subarray(0, length);
  };
  const storage: ImageByteStorage = {
    allocate: vi.fn(length => {const position = end; end += length; return position;}),
    read: vi.fn(async (position, length) => read(backing, position, length)),
    write: vi.fn(async (position, data) => {expect(data.length).toBeLessThanOrEqual(4096); backing.set(data, position);})
  };
  return {storage, backing, source: {size: bytes.length, read: vi.fn(async (position: number, length: number) => read(bytes, position, length))}};
}

it("keeps decoded metadata aligned with the buffered image without leaking synthetic header size", async () => {
  const bytes = png();
  const {storage, source, backing} = capabilities(bytes);
  const {data, ...expected} = decodePngImage(bytes);
  const image = await decodePngToStorage(source, storage, new AbortController().signal);
  expect(image).toMatchObject(expected);
  expect(image).not.toHaveProperty("size");
  expect(backing.subarray(image.position, image.position + 4)).toEqual(data);
});

it.each([[true, false], [true, true], [false, false], [false, true]])("preserves EXIF orientation and centimeter density (little=%s,prefix=%s)", async (little, prefix) => {
  const tiff = new Uint8Array(54);
  const view = new DataView(tiff.buffer);
  tiff.set(little ? [73,73] : [77,77]);
  view.setUint16(2, 42, little); view.setUint32(4, 8, little); view.setUint16(8, 3, little);
  const fields = [[0x0112, 3, 6], [0x0128, 3, 3], [0x011a, 5, 46]];
  for (const [index, [tag, type, value]] of fields.entries()) {
    const at = 10 + index * 12;
    view.setUint16(at, tag!, little); view.setUint16(at + 2, type!, little); view.setUint32(at + 4, 1, little);
    if (type === 3) view.setUint16(at + 8, value!, little); else view.setUint32(at + 8, value!, little);
  }
  view.setUint32(46, 100, little); view.setUint32(50, 1, little);
  const bytes = png([chunk("eXIf", prefix ? Buffer.concat([new TextEncoder().encode("Exif\0\0"), tiff]) : tiff)]);
  const {source, storage, backing} = capabilities(bytes);
  const image = await decodePngToStorage(source, storage, new AbortController().signal);
  expect(image).toMatchObject({orientation: 6, density: 254});
  const expected = decodePngImage(bytes);
  expect(image.orientation).toBe(expected.orientation); expect(image.density).toBe(expected.density);
  expect(backing.subarray(image.position, image.position + 4)).toEqual(expected.data);
});

it("propagates decoder cancellation into an in-flight caller source read", async () => {
  const bytes = png();
  const {storage} = capabilities(bytes);
  const controller = new AbortController();
  const reason = {cancel: "PNG source"};
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => {enter = resolve;});
  const released = new Promise<void>(resolve => {release = resolve;});
  let observed: AbortSignal | undefined;
  const result = decodePngToStorage({size: bytes.length, async read(position, length, options?: {signal?: AbortSignal}) {
    observed = options?.signal; enter(); await released;
    return bytes.subarray(position, position + length);
  }}, storage, controller.signal);
  const settled = result.then(() => undefined, error => error);
  try {await entered; controller.abort(reason); expect(observed?.aborted).toBe(true); expect(observed?.reason).toBe(reason);}
  finally {release(); expect(await settled).toBe(reason);}
  expect(storage.allocate).not.toHaveBeenCalled();
});

it("preserves caller backing write failures instead of replacing them during decoder cleanup", async () => {
  const {source, storage} = capabilities(png());
  const failure = {write: "failed"};
  storage.write = vi.fn(async () => {throw failure;});
  await expect(decodePngToStorage(source, storage, new AbortController().signal)).rejects.toBe(failure);
  expect(storage.write).toHaveBeenCalledTimes(1);
});

it("rejects corrupt zlib checksums even after producing the declared pixel bytes", async () => {
  const compressed = deflateSync(Uint8Array.of(0,5,6,7,8));
  compressed[compressed.length - 1]! ^= 1;
  const {source, storage} = capabilities(png([], compressed));
  await expect(decodePngToStorage(source, storage, new AbortController().signal)).rejects.toThrow();
});

it("rejects non-byte range responses instead of coercing them into allocations", async () => {
  const bytes = png();
  const {storage} = capabilities(bytes);
  const source = {size: bytes.length, async read(position: number, length: number) {return Array.from(bytes.subarray(position, position + length)) as unknown as Uint8Array;}};
  await expect(decodePngToStorage(source, storage, new AbortController().signal)).rejects.toThrow();
  expect(storage.allocate).not.toHaveBeenCalled();
});

it("reconstructs 16-bit RGB with all filters across non-pixel-aligned storage windows", async () => {
  const width = 1501, height = 5, stride = width * 6;
  const raw = new Uint8Array((stride + 1) * height);
  const expected = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = Uint8Array.from({length: stride}, (_, index) => (index * 17 + y * 31) & 255);
    raw[y * (stride + 1)] = y;
    for (let index = 0; index < stride; index++) {
      const a = row[index - 6] ?? 0, b = previous[index]!, c = previous[index - 6] ?? 0;
      const p = a + b - c, distances = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      const paeth = [a, b, c][distances.indexOf(Math.min(...distances))]!;
      raw[y * (stride + 1) + 1 + index] = (row[index]! - [0, a, b, Math.floor((a + b) / 2), paeth][y]!) & 255;
    }
    for (let x = 0; x < width; x++) expected.set([row[x * 6]!, row[x * 6 + 2]!, row[x * 6 + 4]!, 255], (y * width + x) * 4);
    previous = row;
  }
  const {source, storage, backing} = capabilities(png([], deflateSync(raw), width, height, 16, 2));
  const image = await decodePngToStorage(source, storage, new AbortController().signal);
  expect(backing.subarray(image.position, image.position + expected.length)).toEqual(expected);
});
