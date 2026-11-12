import { scaleVideoPicture, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { scaleWeights } from "./scale.js";
import { yieldTurn } from "safe-bash-contracts/yield";

/** Convert to limited-range BT.601 planes before subsequent filters see RGBA. */
export async function formatYuv(
  frame: MediaVideoFrame, format: "yuv420p10le" | "yuv420p" | "yuv422p" | "yuv444p" | "yuva444p" | "yuv444p16le", signal?: AbortSignal
): Promise<MediaVideoFrame> {
  const { width, height, data } = frame;
  const alpha = format === "yuva444p";
  const tenBit = format === "yuv420p10le";
  const sixteenBit = format === "yuv444p16le";
  const nativeFormat = alpha ? 79 : sixteenBit ? 49 : tenBit ? 62 : format === "yuv420p" ? 0 : format === "yuv422p" ? 4 : 5;
  if (frame.native?.format === nativeFormat && frame.native.rgba === data &&
      frame.native.width === width && frame.native.height === height) return frame;
  const hsub = (format === "yuv444p" || alpha || sixteenBit) ? 1 : 2;
  const vsub = tenBit || format === "yuv420p" ? 2 : 1;
  const chromaWidth = Math.ceil(width / hsub);
  const chromaHeight = Math.ceil(height / vsub);
  const lumaSize = width * height;
  const chromaSize = chromaWidth * chromaHeight;
  const pixels = new Uint8Array((lumaSize * (alpha ? 2 : 1) + chromaSize * 2) * (tenBit || sixteenBit ? 2 : 1));
  const view10 = tenBit ? new DataView(pixels.buffer) : undefined;
  const source = frame.native;
  if (sixteenBit) {
    const packed = source && [34, 35].includes(source.format) && source.rgba === data &&
      source.width === width && source.height === height ? source : undefined;
    const input = packed ? new DataView(packed.pixels.buffer, packed.pixels.byteOffset, packed.pixels.byteLength) : undefined;
    const output = new DataView(pixels.buffer);
    for (let i = 0; i < lumaSize; i++) {
      if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }
      const r = input ? input.getUint16(i * 6, packed!.format === 35) : data[i * 4]! * 257;
      const g = input ? input.getUint16(i * 6 + 2, packed!.format === 35) : data[i * 4 + 1]! * 257;
      const b = input ? input.getUint16(i * 6 + 4, packed!.format === 35) : data[i * 4 + 2]! * 257;
      // swscale's packed 16-bit BT.601 conversion rounds before planar filtering.
      output.setUint16(i * 2, Math.floor((8414 * r + 16519 * g + 3208 * b) / 32768 + 4096.5), true);
      output.setUint16((lumaSize + i) * 2, Math.floor((-4865 * r - 9528 * g + 14392 * b) / 32768 + 32768.5), true);
      output.setUint16((lumaSize * 2 + i) * 2, Math.floor((14392 * r - 12061 * g - 2332 * b) / 32768 + 32768.5), true);
    }
    const native = { rgba: data, pixels, width, height, format: nativeFormat, colorspace: 5, fullRange: 0 };
    const rgba = scaleVideoPicture({ ...frame, native }, width, height)!;
    return { ...frame, data: rgba, native: { ...native, rgba } };
  }
  if (source && [0, 4, 5, 12, 13, 14].includes(source.format) &&
      ["yuv420p", "yuv422p", "yuv444p"].includes(format) &&
      source.rgba === data && source.width === width && source.height === height) {
    // Resample native planes without clipping luma/chroma through an RGB round trip.
    const sourceWidth = [0, 4, 12, 13].includes(source.format) ? Math.ceil(width / 2) : width;
    const sourceHeight = [0, 12].includes(source.format) ? Math.ceil(height / 2) : height;
    const horizontal = scaleWeights(sourceWidth, chromaWidth, "bicubic");
    const vertical = scaleWeights(sourceHeight, chromaHeight, "bicubic");
    // swscale normalizes horizontal coefficients to 14 bits with carried rounding error.
    for (const taps of horizontal) {
      let error = 0;
      for (const tap of taps) {
        const value = tap.weight * 16384 + error;
        tap.weight = Math.round(value);
        error = value - tap.weight;
      }
    }
    for (const taps of vertical) {
      let error = 0;
      for (const tap of taps) {
        const value = tap.weight * 4096 + error;
        tap.weight = Math.round(value);
        error = value - tap.weight;
      }
    }
    pixels.set(source.pixels.subarray(0, lumaSize));
    for (let plane = 0; plane < 2; plane++) {
      for (let y = 0; y < chromaHeight; y++) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        for (let x = 0; x < chromaWidth; x++) {
          let value = 0;
          for (const row of vertical[y]!) {
            let horizontalValue = 0;
            for (const tap of horizontal[x]!) {
              horizontalValue += source.pixels[lumaSize + plane * sourceWidth * sourceHeight + row.index * sourceWidth + tap.index]! * tap.weight;
            }
            // swscale carries 15-bit horizontal samples into the 12-bit vertical filter.
            value += Math.min(32767, Math.floor(horizontalValue / 128)) * row.weight;
          }
          pixels[lumaSize + plane * chromaSize + y * chromaWidth + x] = Math.max(0, Math.min(255, Math.floor((value + 262144) / 524288)));
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
      if (count === 1) {
        // Like luma, full-resolution chroma rounds through 14-bit intermediates.
        const u = (-4865 * r - 9528 * g + 14392 * b + 4194560) >> 9;
        const v = (14392 * r - 12061 * g - 2332 * b + 4194560) >> 9;
        pixels[offset] = (u + 32) >> 6;
        pixels[offset + chromaSize] = (v + 32) >> 6;
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
