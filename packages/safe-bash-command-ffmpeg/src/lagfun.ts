import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function lagfun(
  frames: MediaVideoFrame[], argument: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  let decay = Math.fround(0.95);
  let planes = 15;
  let position = 0;
  const parts = argument ? argument.split(":") : [];
  if (parts.at(-1) === "") parts.pop();
  for (const part of parts) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? ["decay", "planes"][position++] : part.slice(0, separator).trim();
    if (separator >= 0) position = position === 0 ? 1 : 0;
    if (key !== "decay" && key !== "planes") throw new Error(`lagfun: unsupported option ${key ?? part}`);
    const value = parseFilterExpression(separator < 0 ? part : part.slice(separator + 1), "lagfun", {
      min: 0, max: key === "decay" ? 1 : 15, default: key === "decay" ? 0.95 : 15
    });
    if (!Number.isFinite(value) || value < 0 || value > (key === "decay" ? 1 : 15) ||
        key === "planes" && !Number.isInteger(value)) {
      throw new RangeError(`lagfun: invalid ${key}`);
    }
    if (key === "decay") decay = Math.fround(value);
    else planes = value;
  }

  const output: MediaVideoFrame[] = [];
  const history: Float32Array[] = [];
  let work = 0;
  for (const frame of frames) {
    signal?.throwIfAborted();
    budget.checkCpu();
    const retained = frame.native;
    const native = retained?.rgba === frame.data && retained.width === frame.width &&
      retained.height === frame.height ? retained : undefined;
    const gray = native ? [8, 29, 30].includes(native.format) : pixelFormat === "gray" || pixelFormat === "gray8";
    const planar = native && [0, 4, 5, 12, 13, 14, 79].includes(native.format) ? native : undefined;
    if (!gray && !planar && !["rgb24", "bgr24", "gbrp"].includes(pixelFormat ?? "")) {
      throw new Error("lagfun: only 8-bit or 16-bit grayscale, 8-bit planar YUV and RGB input is supported");
    }
    const planeCount = gray ? 1 : planar?.format === 79 ? 4 : 3;
    if (!(planes & ((1 << planeCount) - 1))) {
      output.push(frame);
      continue;
    }
    if (output.length && (frame.width !== output[0]!.width || frame.height !== output[0]!.height)) {
      throw new Error("lagfun: frames must have matching dimensions");
    }
    const length = frame.width * frame.height;
    const source = planar ?? (gray ? native : undefined);
    const sampleBytes = gray && native && [29, 30].includes(native.format) ? 2 : 1;
    const littleEndian = native?.format === 30;
    const byteLength = source?.pixels.length ?? (gray ? length : frame.data.length);
    budget.allocateMemory(byteLength + (source || gray ? frame.data.length : 0));
    const pixels = source ? new Uint8Array(source.pixels) : gray ? new Uint8Array(length) : new Uint8Array(frame.data);
    const view = new DataView(pixels.buffer);
    let offset = 0;
    for (let plane = 0; plane < planeCount; plane++) {
      const chroma = planar && (plane === 1 || plane === 2);
      const width = chroma && [0, 4, 12, 13].includes(planar.format) ? Math.ceil(frame.width / 2) : frame.width;
      const height = chroma && [0, 12].includes(planar.format) ? Math.ceil(frame.height / 2) : frame.height;
      const size = width * height;
      if (planes & (1 << plane)) {
        if (!history[plane]) {
          budget.allocateMemory(size * 4);
          history[plane] = new Float32Array(size);
        }
        const previous = history[plane]!;
        for (let index = 0; index < size; index++) {
          if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          // Packed RGB negotiates to planar GBR; retain the existing RGBA storage.
          const position = source || gray ? offset + index * sampleBytes : index * 4 + [1, 2, 0][plane]!;
          const sample = sampleBytes === 2 ? view.getUint16(position, littleEndian)
            : gray && !source ? frame.data[index * 4]! : pixels[position]!;
          // Retain float history; FFmpeg rounds only the emitted sample, with ties to even.
          const value = Math.max(sample, Math.fround(previous[index]! * decay));
          previous[index] = value;
          // Disabled frames update and decay history while retaining their original samples.
          const rounded = enabled ? (value % 1 === 0.5 ? 2 * Math.round(value / 2) : Math.round(value)) : sample;
          if (sampleBytes === 2) view.setUint16(position, rounded, littleEndian);
          else pixels[position] = rounded;
        }
      }
      offset += size * sampleBytes;
    }
    if (source || gray) {
      const filtered = source ? { ...source, pixels } : {
        pixels, rgba: frame.data, width: frame.width, height: frame.height, format: 8, colorspace: 5, fullRange: 1
      };
      const data = scaleVideoPicture({ ...frame, native: filtered }, frame.width, frame.height)!;
      output.push({ ...frame, data, native: { ...filtered, rgba: data } });
    } else {
      const filtered = { ...frame, data: pixels };
      delete filtered.native;
      output.push(filtered);
    }
  }
  for (const plane of history) if (plane) budget.releaseMemory(plane.byteLength);
  return output;
}
