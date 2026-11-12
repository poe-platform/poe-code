import { MediaBudgetTracker, type MediaVideoFrame, type SerializeMediaOptions, type ParseMediaOptions } from "../types.js";

/** Decode uncompressed and RLE true-color, grayscale and indexed Targa images into top-left RGBA. */
export function decodeTga(bytes: Uint8Array, options?: ParseMediaOptions) {
  if (bytes.length < 18) throw new Error("Truncated TGA header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = bytes[2]!, depth = bytes[16]!, descriptor = bytes[17]!;
  const grayscale = type === 3 || type === 11, indexed = type === 1 || type === 9;
  const first = view.getUint16(3, true), paletteCount = view.getUint16(5, true);
  const colorDepth = indexed ? bytes[7]! : depth;
  if ((indexed ? bytes[1] !== 1 || !paletteCount || first + paletteCount > 65536 ||
      (depth !== 8 && depth !== 16) || (colorDepth !== 24 && colorDepth !== 32)
    : bytes[1] !== 0 || (!grayscale && type !== 2 && type !== 10) ||
      (grayscale ? depth !== 8 : depth !== 16 && depth !== 24 && depth !== 32)) || (descriptor & 192) !== 0) {
    throw new Error("Unsupported TGA image format");
  }
  const width = view.getUint16(12, true), height = view.getUint16(14, true);
  if (!width || !height) throw new Error("Invalid TGA dimensions");
  const budget = options?.budget ?? new MediaBudgetTracker(options?.limits);
  budget.recordFrame(width, height);
  budget.allocateMemory(width * height * 4);
  const data = new Uint8Array(width * height * 4);
  const stride = depth / 8, count = width * height;
  const paletteOffset = 18 + bytes[0]!;
  let offset = paletteOffset + (indexed ? paletteCount * colorDepth / 8 : 0), pixel = 0;
  if (indexed && offset > bytes.length) throw new Error("Truncated TGA color map");
  while (pixel < count) {
    budget.checkCpu();
    let run = 1, repeated = false;
    if (type === 9 || type === 10 || type === 11) {
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
      let color = offset;
      if (indexed) {
        const index = bytes[offset]! + (stride === 2 ? bytes[offset + 1]! * 256 : 0) - first;
        if (index < 0 || index >= paletteCount) throw new Error("TGA color map index out of range");
        color = paletteOffset + index * colorDepth / 8;
      }
      if (colorDepth === 16) {
        const packed = view.getUint16(offset, true);
        for (let c = 0; c < 3; c++) {
          const sample = (packed >> ((2 - c) * 5)) & 31;
          data[target + c] = (sample << 3) | (sample >> 2);
        }
      } else {
        data[target] = bytes[color + (grayscale ? 0 : 2)]!;
        data[target + 1] = bytes[color + (grayscale ? 0 : 1)]!;
        data[target + 2] = bytes[color]!;
      }
      data[target + 3] = colorDepth === 32 ? bytes[color + 3]! : 255;
      if (!repeated) offset += stride;
    }
    if (repeated) offset += stride;
  }
  return { width, height, data, format: "targa" };
}

/** Encode top-left RGBA as Targa, with scanline-bounded RLE packets. */
export function encodeTga(frame: Pick<MediaVideoFrame, "width" | "height" | "data">, options?: SerializeMediaOptions & { pixelFormat?: string | undefined }): Uint8Array {
  const { width, height, data } = frame;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 65535 || height > 65535 || data.length !== width * height * 4) {
    throw new Error("Invalid TGA dimensions or RGBA data");
  }
  const budget = options?.budget ?? new MediaBudgetTracker();
  const rle = options?.rle ?? true;
  const format = options?.pixelFormat ?? "bgra";
  const indexed = format === "pal8", gray = format === "gray" || format === "gray8";
  const stride = indexed || gray ? 1 : format === "rgb555le" ? 2 : format === "bgr24" || format === "rgb24" ? 3 : 4;
  const capacity = 18 + (indexed ? 768 : 0) + width * height * stride + (rle ? width * height : 0) + 26;
  budget.allocateMemory(capacity);
  const bytes = new Uint8Array(capacity);
  const view = new DataView(bytes.buffer);
  bytes[2] = (indexed ? 1 : gray ? 3 : 2) + (rle ? 8 : 0);
  view.setUint16(12, width, true);
  view.setUint16(14, height, true);
  bytes[16] = stride * 8;
  bytes[17] = 32 | (stride === 4 ? 8 : 0);
  let offset = 18;
  if (indexed) {
    bytes[1] = 1;
    view.setUint16(5, 256, true);
    bytes[7] = 24;
    // FFmpeg's systematic BGR8 palette, stored in Targa's BGR order.
    for (let i = 0; i < 256; i++) {
      bytes[offset++] = (i >> 6) * 85;
      bytes[offset++] = ((i >> 3) & 7) * 36;
      bytes[offset++] = (i & 7) * 36;
    }
  }
  const dither = [[6, 2], [0, 4]];
  const packed = (i: number) => {
    const r = data[i * 4]!, g = data[i * 4 + 1]!, b = data[i * 4 + 2]!;
    if (stride === 2) {
      // swscale converts RGB through BT.601 with horizontally paired chroma.
      // Keep its six fractional bits until the final RGB555 conversion.
      const x = i % width, y = Math.floor(i / width), pair = (i - (x & 1)) * 4;
      const rs = data[pair]! + (data[pair + 4] ?? 0);
      const gs = data[pair + 1]! + (data[pair + 5] ?? 0);
      const bs = data[pair + 2]! + (data[pair + 6] ?? 0);
      let luma = (8414 * r + 16519 * g + 3208 * b + 524544) >> 9;
      let u = (-4865 * rs - 9528 * gs + 14392 * bs + 8389120) >> 10;
      let v = (14392 * rs - 12061 * gs - 2332 * bs + 8389120) >> 10;
      if (y < height - 2) {
        // FFmpeg's optimized rows truncate each fixed-point product separately.
        luma = (((luma >> 3) - 128) * 9539) >> 16;
        u = (u >> 3) - 1024;
        v = (v >> 3) - 1024;
        const red = luma + ((v * 13075) >> 16);
        const green = luma + ((u * -3209) >> 16) + ((v * -6660) >> 16);
        const blue = luma + ((u * 16525) >> 16);
        const rd = dither[(y & 1) ^ 1]![(x & 1) ^ 1]!, gb = dither[y & 1]![(x & 1) ^ 1]!;
        return ((Math.min(255, Math.max(0, red) + rd) >> 3) << 10) |
          ((Math.min(255, Math.max(0, green) + gb) >> 3) << 5) |
          (Math.min(255, Math.max(0, blue) + gb) >> 3);
      }
      // The final two rows use swscale's rounded lookup-table conversion.
      luma = (luma + 32) >> 6; u = (u + 32) >> 6; v = (v + 32) >> 6;
      const offset = (sample: number, coefficient: number) => ((sample * coefficient) >> 16) - (coefficient >> 9);
      const quantize = (value: number) => Math.max(0, Math.min(255, (-26214400 + (326 + value) * 76309 + 32768) >> 16)) >> 3;
      return (quantize(luma + offset(v, 89830) + dither[y & 1]![x & 1]!) << 10) |
        (quantize(luma + offset(u, -22049) + offset(v, -45756) + dither[y & 1]![(x & 1) ^ 1]!) << 5) |
        quantize(luma + offset(u, 113537) + dither[(y & 1) ^ 1]![x & 1]!);
    }
    return indexed ? (Math.round(b / 85) << 6) | (Math.round(g / 36) << 3) | Math.round(r / 36)
      : gray ? r
      : b | (g << 8) | (r << 16) | (stride === 4 ? data[i * 4 + 3]! << 24 : 0);
  };
  const same = (a: number, b: number) => packed(a) === packed(b);
  const pixel = (i: number) => {
    const value = packed(i);
    for (let c = 0; c < stride; c++) bytes[offset++] = (value >>> (c * 8)) & 255;
  };
  const pixelStart = offset;
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
  if (rle && offset > pixelStart + width * height * bytes[16]! / 8) {
    bytes[2] = bytes[2]! & 7;
    offset = pixelStart;
    for (let y = 0; y < height; y++) {
      budget.checkCpu();
      for (let x = 0; x < width; x++) pixel(y * width + x);
    }
  }
  // TGA 2.0 footer: no extension or developer area.
  bytes.fill(0, offset, offset + 8);
  bytes.set(new TextEncoder().encode("TRUEVISION-XFILE.\0"), offset + 8);
  offset += 26;
  budget.checkOutputBytes(offset);
  return bytes.subarray(0, offset);
}
