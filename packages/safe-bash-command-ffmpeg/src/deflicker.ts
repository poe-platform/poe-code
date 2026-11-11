import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { parseFilterBoolean } from "./filter-boolean.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";

type DeflickerFrame = MediaVideoFrame & { filterMetadata?: Record<string, string> };

function formatMeasurement(value: number): string {
  return Number.isNaN(value) ? "-nan" : value === Infinity ? "inf" : value.toFixed(6);
}

export async function deflicker(
  frames: DeflickerFrame[], argument: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<DeflickerFrame[]> {
  let size = 5;
  let mode = 0;
  let bypass = false;
  let position = 0;
  const options = argument ? argument.split(":") : [];
  if (options.at(-1) === "") options.pop();
  for (const option of options) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["size", "mode", "bypass"][position++] : option.slice(0, separator);
    // FFmpeg restarts shorthand after named options, skipping the first slot if just visited.
    if (separator >= 0) position = position === 0 ? 1 : 0;
    const expression = separator < 0 ? option : option.slice(separator + 1);
    if (key === "threads" || key === "thread_type" || key === "extra_hw_frames") {
      validateWeaveGenericOption(key, expression, "deflicker");
      continue;
    }
    if (key === "bypass") { bypass = parseFilterBoolean(expression, "deflicker: invalid bypass"); continue; }
    if (key !== "size" && key !== "s" && key !== "mode" && key !== "m") throw new Error(`deflicker: unsupported option ${key}`);
    const isSize = key === "size" || key === "s";
    const min = isSize ? 2 : 0;
    const max = isSize ? 129 : 6;
    const value = parseFilterExpression(expression, "deflicker", {
      min, max, default: isSize ? 5 : 0, none: 0, am: 0, gm: 1, hm: 2, qm: 3, cm: 4, pm: 5, median: 6
    }, undefined, new Float64Array(10), []);
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`deflicker: ${key} must be between ${min} and ${max}`);
    const rounded = value % 1 === 0.5 ? 2 * Math.round(value / 2) : Math.round(value);
    if (isSize) size = rounded;
    else mode = rounded;
  }
  const f = Math.fround;
  budget.allocateMemory(frames.length * 4 + size * 8);
  const luminance = new Float32Array(frames.length);
  let work = 0;
  for (const [n, frame] of frames.entries()) {
    signal?.throwIfAborted();
    budget.checkCpu();
    const native = frame.native;
    if (native ? native.rgba !== frame.data || native.width !== frame.width || native.height !== frame.height ||
      ![0, 4, 5, 8, 12, 13, 14, 29, 30].includes(native.format) : pixelFormat !== "gray" && pixelFormat !== "gray8") {
      throw new Error("deflicker: only 8-bit or 16-bit grayscale or 8-bit planar YUV input is supported");
    }
    const wide = native && [29, 30].includes(native.format);
    const view = wide ? new DataView(native.pixels.buffer, native.pixels.byteOffset, native.pixels.byteLength) : undefined;
    let sum = 0;
    for (let i = 0; i < frame.width * frame.height; i++) {
      if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      sum += view ? view.getUint16(i * 2, native!.format === 30) : native ? native.pixels[i]! : frame.data[i * 4]!;
    }
    luminance[n] = f(f(sum) / (frame.width * frame.height));
  }
  const window = new Float32Array(size);
  window.set(luminance.subarray(0, size));
  // FFmpeg 7's median comparator compares addresses, not luminance values.
  // Its quicksort only swaps each partition's midpoint with its penultimate slot.
  const order = Array.from({ length: size }, (_, i) => i);
  for (let end = size - 1; end > 2; end -= 2) {
    const mid = end >> 1;
    [order[mid], order[end - 1]] = [order[end - 1]!, order[mid]!];
  }
  const output: DeflickerFrame[] = [];
  for (const [n, frame] of frames.entries()) {
    signal?.throwIfAborted();
    budget.checkCpu();
    let mean = mode === 1 ? 1 : 0;
    for (const value of window) {
      if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      if (mode === 0) mean = f(mean + value);
      else if (mode === 1) mean = f(mean * value);
      else if (mode === 2) mean = f(mean + f(1 / value));
      else if (mode === 3) mean = f(mean + f(value * value));
      else if (mode === 4) mean = f(mean + f(f(value * value) * value));
      else if (mode === 5) mean = f(mean + f(Math.pow(value, size)));
    }
    if (mode === 0) mean = f(mean / size);
    else if (mode === 1) mean = f(Math.pow(mean, f(1 / size)));
    else if (mode === 2) mean = f(size / mean);
    else if (mode === 3) mean = f(Math.sqrt(f(mean / size)));
    else if (mode === 4) mean = f(Math.cbrt(f(mean / size)));
    else if (mode === 5) mean = f(Math.pow(f(mean / size), f(1 / size)));
    else mean = window[order[size >> 1]!]!;
    const factor = f(mean / window[0]!);
    const filterMetadata = { ...frame.filterMetadata,
      "lavfi.deflicker.luminance": window[0]!.toFixed(6),
      "lavfi.deflicker.new_luminance": formatMeasurement(f(window[0]! * factor)),
      "lavfi.deflicker.relative_change": formatMeasurement(f(factor - 1))
    };
    budget.allocateMemory(256);
    if (bypass) output.push({ ...frame, filterMetadata });
    else {
      const native = frame.native;
      const wide = native && [29, 30].includes(native.format);
      const length = frame.width * frame.height;
      budget.allocateMemory((native?.pixels.length ?? length) + frame.data.length);
      const pixels = native ? new Uint8Array(native.pixels) : new Uint8Array(length);
      const view = new DataView(pixels.buffer);
      for (let i = 0; i < length; i++) {
        if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        const value = wide ? view.getUint16(i * 2, native.format === 30) : native ? pixels[i]! : frame.data[i * 4]!;
        const corrected = Math.max(0, Math.min(wide ? 65535 : 255, Math.trunc(f(value * factor))));
        if (wide) view.setUint16(i * 2, corrected, native.format === 30);
        else pixels[i] = corrected;
      }
      const filtered = native ? { ...native, pixels } : {
        pixels, rgba: frame.data, width: frame.width, height: frame.height, format: 8, colorspace: 5, fullRange: 1
      };
      const data = scaleVideoPicture({ ...frame, native: filtered }, frame.width, frame.height)!;
      output.push({ ...frame, data, native: { ...filtered, rgba: data }, filterMetadata });
    }
    window.copyWithin(0, 1);
    const available = Math.min(size, frames.length - n);
    window[available - 1] = luminance[Math.min(n + size, frames.length - 1)]!;
  }
  budget.releaseMemory(luminance.byteLength + size * 8);
  return output;
}
