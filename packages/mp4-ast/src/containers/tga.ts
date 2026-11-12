import { MediaBudgetTracker, type MediaVideoFrame, type SerializeMediaOptions, type ParseMediaOptions } from "../types.js";

/** Decode uncompressed and RLE true-color and grayscale Targa images into top-left RGBA. */
export function decodeTga(bytes: Uint8Array, options?: ParseMediaOptions) {
  if (bytes.length < 18) throw new Error("Truncated TGA header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = bytes[2]!, depth = bytes[16]!, descriptor = bytes[17]!;
  const grayscale = type === 3 || type === 11;
  if (bytes[1] !== 0 || (!grayscale && type !== 2 && type !== 10) ||
      (grayscale ? depth !== 8 : depth !== 24 && depth !== 32) || (descriptor & 192) !== 0) {
    throw new Error("Unsupported TGA image format");
  }
  const width = view.getUint16(12, true), height = view.getUint16(14, true);
  if (!width || !height) throw new Error("Invalid TGA dimensions");
  const budget = options?.budget ?? new MediaBudgetTracker(options?.limits);
  budget.recordFrame(width, height);
  budget.allocateMemory(width * height * 4);
  const data = new Uint8Array(width * height * 4);
  const stride = depth / 8, count = width * height;
  let offset = 18 + bytes[0]!, pixel = 0;
  while (pixel < count) {
    budget.checkCpu();
    let run = 1, repeated = false;
    if (type === 10 || type === 11) {
      if (offset >= bytes.length) throw new Error("Truncated TGA RLE packet");
      const packet = bytes[offset++]!;
      run = (packet & 127) + 1;
      repeated = (packet & 128) !== 0;
    }
    if (pixel + run > count) throw new Error("TGA RLE packet exceeds image dimensions");
    if (offset + (repeated ? 1 : run) * stride > bytes.length) throw new Error("Truncated TGA pixels");
    for (let i = 0; i < run; i++, pixel++) {
      const x = pixel % width, y = Math.floor(pixel / width);
      const target = ((descriptor & 32 ? y : height - 1 - y) * width +
        (descriptor & 16 ? width - 1 - x : x)) * 4;
      data[target] = bytes[offset + (grayscale ? 0 : 2)]!;
      data[target + 1] = bytes[offset + (grayscale ? 0 : 1)]!;
      data[target + 2] = bytes[offset]!;
      data[target + 3] = depth === 32 ? bytes[offset + 3]! : 255;
      if (!repeated) offset += stride;
    }
    if (repeated) offset += stride;
  }
  return { width, height, data, format: "targa" };
}

/** Encode top-left RGBA as true-color Targa, with scanline-bounded RLE packets. */
export function encodeTga(frame: Pick<MediaVideoFrame, "width" | "height" | "data">, options?: SerializeMediaOptions): Uint8Array {
  const { width, height, data } = frame;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 65535 || height > 65535 || data.length !== width * height * 4) {
    throw new Error("Invalid TGA dimensions or RGBA data");
  }
  const budget = options?.budget ?? new MediaBudgetTracker();
  const rle = options?.rle ?? true;
  const capacity = 18 + data.length + (rle ? width * height : 0) + 26;
  budget.allocateMemory(capacity);
  const bytes = new Uint8Array(capacity);
  const view = new DataView(bytes.buffer);
  bytes[2] = rle ? 10 : 2;
  view.setUint16(12, width, true);
  view.setUint16(14, height, true);
  bytes[16] = 32;
  bytes[17] = 40;
  let offset = 18;
  const same = (a: number, b: number) => data[a * 4] === data[b * 4] && data[a * 4 + 1] === data[b * 4 + 1] && data[a * 4 + 2] === data[b * 4 + 2] && data[a * 4 + 3] === data[b * 4 + 3];
  const pixel = (i: number) => {
    bytes[offset++] = data[i * 4 + 2]!;
    bytes[offset++] = data[i * 4 + 1]!;
    bytes[offset++] = data[i * 4]!;
    bytes[offset++] = data[i * 4 + 3]!;
  };
  for (let y = 0; y < height; y++) {
    budget.checkCpu();
    const end = (y + 1) * width;
    for (let i = y * width; i < end;) {
      if (!rle) { pixel(i++); continue; }
      let count = 1;
      while (count < 128 && i + count < end && same(i, i + count)) count++;
      if (count > 1) {
        bytes[offset++] = 128 | (count - 1);
        pixel(i);
      } else {
        while (count < 128 && i + count < end && !(i + count + 1 < end && same(i + count, i + count + 1))) count++;
        bytes[offset++] = count - 1;
        for (let j = 0; j < count; j++) pixel(i + j);
      }
      i += count;
    }
  }
  // TGA 2.0 footer: no extension or developer area.
  bytes.set(new TextEncoder().encode("TRUEVISION-XFILE.\0"), offset + 8);
  offset += 26;
  budget.checkOutputBytes(offset);
  return bytes.subarray(0, offset);
}
