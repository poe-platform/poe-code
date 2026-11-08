import { MediaBudgetTracker, type ParseMediaOptions } from "../types.js";

/** Decode uncompressed and RLE true-color Targa images into top-left RGBA. */
export function decodeTga(bytes: Uint8Array, options?: ParseMediaOptions) {
  if (bytes.length < 18) throw new Error("Truncated TGA header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = bytes[2]!, depth = bytes[16]!, descriptor = bytes[17]!;
  if (bytes[1] !== 0 || (type !== 2 && type !== 10) ||
      (depth !== 24 && depth !== 32) || (descriptor & 192) !== 0) {
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
    if (type === 10) {
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
      data[target] = bytes[offset + 2]!;
      data[target + 1] = bytes[offset + 1]!;
      data[target + 2] = bytes[offset]!;
      data[target + 3] = depth === 32 ? bytes[offset + 3]! : 255;
      if (!repeated) offset += stride;
    }
    if (repeated) offset += stride;
  }
  return { width, height, data, format: "targa" };
}
