import type { MediaBudgetTracker, MediaVideoFrame } from "@poe-code/mp4-ast";

/** FFmpeg BMP uses a 40-byte DIB, including for uncompressed BGRA. */
export function encodeBmp(frame: MediaVideoFrame, pixelFormat: string | undefined, budget: MediaBudgetTracker): Uint8Array {
  const { width, height, data } = frame;
  const alpha = pixelFormat === "bgra" || pixelFormat === "rgba" || pixelFormat === "gbrap";
  const mono = pixelFormat === "monob";
  const gray = pixelFormat === "gray" || pixelFormat === "gray8";
  const packed = pixelFormat === "rgb565le" || pixelFormat === "rgb555le" || pixelFormat === "rgb444le";
  const four = pixelFormat === "rgb4_byte" || pixelFormat === "bgr4_byte";
  const indexed = four || pixelFormat === "rgb8" || pixelFormat === "bgr8" || pixelFormat === "pal8";
  const rgbOrder = pixelFormat === "rgb8" || pixelFormat === "rgb4_byte";
  const bits = mono ? 1 : gray || indexed ? 8 : packed ? 16 : alpha ? 32 : 24;
  const masks = pixelFormat === "rgb565le" ? [0xf800, 0x07e0, 0x001f]
    : pixelFormat === "rgb444le" ? [0x0f00, 0x00f0, 0x000f] : undefined;
  const paletteSize = mono ? 8 : bits === 8 ? 1024 : 0;
  const offset = 54 + paletteSize + (masks ? 12 : 0);
  const stride = Math.ceil(width * bits / 32) * 4;
  const size = offset + stride * height;
  budget.checkOutputBytes(size);
  const errorBytes = indexed ? (width + 2) * 3 * 4 : 0;
  budget.allocateMemory(size + errorBytes);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d]);
  view.setUint32(2, size, true);
  view.setUint32(10, offset, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, bits, true);
  view.setUint32(30, masks ? 3 : 0, true);
  view.setUint32(34, stride * height, true);
  masks?.forEach((mask, i) => view.setUint32(54 + i * 4, mask, true));
  for (let i = 0; i < paletteSize / 4; i++) {
    let r: number, g: number, b: number;
    if (mono || gray) r = g = b = mono ? i * 255 : i;
    else if (four) {
      r = ((i >> (rgbOrder ? 3 : 0)) & 1) * 255;
      g = ((i >> 1) & 3) * 85;
      b = ((i >> (rgbOrder ? 0 : 3)) & 1) * 255;
    } else {
      r = ((i >> (rgbOrder ? 5 : 0)) & 7) * 36;
      g = ((i >> (rgbOrder ? 2 : 3)) & 7) * 36;
      b = ((i >> (rgbOrder ? 0 : 6)) & 3) * 85;
    }
    bytes.set([b, g, r, 0], 54 + i * 4);
  }
  const errors = indexed ? Array.from({ length: 3 }, () => new Int32Array(width + 2)) : [];
  for (let y = 0; y < height; y++) {
    const previous = [0, 0, 0];
    for (let x = 0; x < width; x++) {
      if (x % 4096 === 0) budget.checkCpu();
      const source = (y * width + x) * 4;
      const target = offset + (height - 1 - y) * stride + Math.floor(x * bits / 8);
      const r = data[source]!, g = data[source + 1]!, b = data[source + 2]!;
      if (mono) bytes[target] = bytes[target]! | ((r >= 128 ? 1 : 0) << (7 - (x & 7)));
      else if (gray) bytes[target] = r;
      else if (indexed) {
        let index = 0;
        for (let channel = 0; channel < 3; channel++) {
          const row = errors[channel]!;
          const value = data[source + channel]! +
            ((7 * previous[channel]! + row[x]! + 5 * row[x + 1]! + 3 * row[x + 2]!) >> 4);
          row[x] = previous[channel]!;
          const channelBits = four ? (channel === 1 ? 2 : 1) : channel === 2 ? 2 : 3;
          const max = (1 << channelBits) - 1;
          const level = Math.max(0, Math.min(max, value >> (8 - channelBits)));
          previous[channel] = value - level * Math.floor(255 / max);
          const shift = four ? (channel === 1 ? 1 : (channel === 0) === rgbOrder ? 3 : 0)
            : channel === 0 ? (rgbOrder ? 5 : 0) : channel === 1 ? (rgbOrder ? 2 : 3) : (rgbOrder ? 0 : 6);
          index |= level << shift;
        }
        bytes[target] = index;
      } else if (packed) {
        const pixel = pixelFormat === "rgb565le" ? ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
          : pixelFormat === "rgb555le" ? ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
            : ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        view.setUint16(target, pixel, true);
      } else {
        bytes[target] = b;
        bytes[target + 1] = g;
        bytes[target + 2] = r;
        if (alpha) bytes[target + 3] = data[source + 3]!;
      }
    }
    for (let channel = 0; channel < errors.length; channel++) errors[channel]![width] = previous[channel]!;
  }
  budget.releaseMemory(errorBytes);
  return bytes;
}
