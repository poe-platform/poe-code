import { scaleVideoPicture, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { scaleWeights } from "./scale.js";
import { yieldTurn } from "safe-bash-contracts/yield";

/** Convert to limited-range BT.601 planes before subsequent filters see RGBA. */
export async function formatYuv(
  frame: MediaVideoFrame, format: "yuv420p10le" | "yuv420p" | "yuv422p" | "yuv444p" | "yuva444p", signal?: AbortSignal
): Promise<MediaVideoFrame> {
  const { width, height, data } = frame;
  const alpha = format === "yuva444p";
  const tenBit = format === "yuv420p10le";
  const nativeFormat = alpha ? 79 : tenBit ? 62 : format === "yuv420p" ? 0 : format === "yuv422p" ? 4 : 5;
  if (frame.native?.format === nativeFormat && frame.native.rgba === data &&
      frame.native.width === width && frame.native.height === height) return frame;
  const hsub = (format === "yuv444p" || alpha) ? 1 : 2;
  const vsub = tenBit || format === "yuv420p" ? 2 : 1;
  const chromaWidth = Math.ceil(width / hsub);
  const chromaHeight = Math.ceil(height / vsub);
  const lumaSize = width * height;
  const chromaSize = chromaWidth * chromaHeight;
  const pixels = new Uint8Array((lumaSize * (alpha ? 2 : 1) + chromaSize * 2) * (tenBit ? 2 : 1));
  const view10 = tenBit ? new DataView(pixels.buffer) : undefined;
  const source = frame.native;
  if (source && ((source.format === 4 && format === "yuv444p") || (source.format === 5 && format === "yuv422p")) &&
      source.rgba === data && source.width === width && source.height === height) {
    // Transpose negotiates 4:4:4 for asymmetric chroma; resample planes without an RGB round trip.
    const sourceWidth = source.format === 4 ? Math.ceil(width / 2) : width;
    const horizontal = scaleWeights(sourceWidth, chromaWidth, "bicubic");
    // swscale normalizes horizontal coefficients to 14 bits with carried rounding error.
    for (const taps of horizontal) {
      let error = 0;
      for (const tap of taps) {
        const value = tap.weight * 16384 + error;
        tap.weight = Math.round(value);
        error = value - tap.weight;
      }
    }
    pixels.set(source.pixels.subarray(0, lumaSize));
    for (let plane = 0; plane < 2; plane++) {
      for (let y = 0; y < height; y++) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        for (let x = 0; x < chromaWidth; x++) {
          let value = 0;
          for (const tap of horizontal[x]!) {
            value += source.pixels[lumaSize + plane * sourceWidth * height + y * sourceWidth + tap.index]! * tap.weight;
          }
          pixels[lumaSize + plane * chromaSize + y * chromaWidth + x] = Math.max(0, Math.min(255, Math.floor((value + 8192) / 16384)));
        }
      }
    }
    const native = { ...source, pixels, format: nativeFormat };
    const rgba = scaleVideoPicture({ ...frame, native }, width, height)!;
    return { ...frame, data: rgba, native: { ...native, rgba } };
  }
  if (format === "yuv444p" && source && [49, 68].includes(source.format) &&
      source.rgba === data && source.width === width && source.height === height) {
    // swscale's planar depth reduction restarts its ordered dither per slice.
    // Use the reference FFmpeg 7 build's 16 slices, including single-row slices.
    const sliceHeight = Math.ceil(height / 16);
    const dither = source.format === 68 ? [[1, 2], [3, 0]] : [
      [36, 68, 60, 92, 34, 66, 58, 90], [100, 4, 124, 28, 98, 2, 122, 26],
      [52, 84, 44, 76, 50, 82, 42, 74], [116, 20, 108, 12, 114, 18, 106, 10],
      [32, 64, 56, 88, 38, 70, 62, 94], [96, 0, 120, 24, 102, 6, 126, 30],
      [48, 80, 40, 72, 54, 86, 46, 78], [112, 16, 104, 8, 118, 22, 110, 14]
    ];
    const shift = source.format === 68 ? 2 : 8;
    const view = new DataView(source.pixels.buffer, source.pixels.byteOffset, source.pixels.byteLength);
    for (let plane = 0; plane < 3; plane++) {
      for (let y = 0; y < height; y++) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        const row = dither[(y % sliceHeight) % dither.length]!;
        for (let x = 0; x < width; x++) {
          const offset = plane * lumaSize + y * width + x;
          const sample = view.getUint16(offset * 2, true);
          const value = (sample + row[x % row.length]!) >> shift;
          pixels[offset] = Math.min(255, value);
        }
      }
    }
    const native = { ...source, pixels, format: nativeFormat };
    const rgba = scaleVideoPicture({ ...frame, native }, width, height)!;
    return { ...frame, data: rgba, native: { ...native, rgba } };
  }
  if (tenBit && source?.format === 0 && source.rgba === data &&
      source.width === width && source.height === height) {
    for (let i = 0; i < source.pixels.length; i++) {
      if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }
      view10!.setUint16(i * 2, source.pixels[i]! << 2, true);
    }
    const native = { ...source, pixels, format: nativeFormat };
    const rgba = scaleVideoPicture({ ...frame, native }, width, height)!;
    return { ...frame, data: rgba, native: { ...native, rgba } };
  }
  for (let y = 0; y < height; y++) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (alpha) {
        // swscale expands packed alpha to 14 bits before rounding to 8.
        pixels[lumaSize * 3 + y * width + x] = Math.min(255, Math.round(data[offset + 3]! * 257 / 256));
      }
      // swscale rounds RGB luma to 14 bits before rounding to an 8-bit plane.
      const luma = (8414 * data[offset]! + 16519 * data[offset + 1]! +
        3208 * data[offset + 2]! + (16 << 15) + 256) >> 9;
      if (view10) view10.setUint16((y * width + x) * 2, (luma + 8) >> 4, true);
      else pixels[y * width + x] = (luma + 32) >> 6;
    }
  }
  for (let y = 0; y < chromaHeight; y++) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    for (let x = 0; x < chromaWidth; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < vsub; dy++) {
        for (let dx = 0; dx < hsub; dx++) {
          const offset = (Math.min(height - 1, y * vsub + dy) * width + Math.min(width - 1, x * hsub + dx)) * 4;
          r += data[offset]!;
          g += data[offset + 1]!;
          b += data[offset + 2]!;
        }
      }
      const count = hsub * vsub;
      const offset = lumaSize + y * chromaWidth + x;
      if (view10) {
        view10.setUint16(offset * 2, Math.floor((-4857 * r - 9535 * g + 14392 * b) / (8192 * count) + 512.5), true);
        view10.setUint16((offset + chromaSize) * 2, Math.floor((14392 * r - 12052 * g - 2340 * b) / (8192 * count) + 512.5), true);
        continue;
      }
      pixels[offset] = Math.floor((-4857 * r - 9535 * g + 14392 * b) / (32768 * count) + 128.5);
      pixels[offset + chromaSize] = Math.floor((14392 * r - 12052 * g - 2340 * b) / (32768 * count) + 128.5);
    }
  }
  const native = { rgba: data, pixels, width, height, format: nativeFormat, colorspace: 5, fullRange: 0 };
  const rgba = scaleVideoPicture({ ...frame, native }, width, height)!;
  return { ...frame, data: rgba, native: { ...native, rgba } };
}
