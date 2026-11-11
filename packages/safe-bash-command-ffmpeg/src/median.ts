import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";

export async function median(
  frames: MediaVideoFrame[], options: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const defaults = { radius: 1, planes: 15, radiusV: 0, percentile: 0.5 };
  const values = { ...defaults };
  let enable: string | undefined;
  let named = false;
  for (const [index, option] of (options ? options.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? Object.keys(values)[index] : option.slice(0, separator).trim();
    const expression = separator < 0 ? option : option.slice(separator + 1).trim();
    if (separator < 0 && named) throw new Error("median: positional option after named option");
    named ||= separator >= 0;
    if (key === "enable") { enable = expression; continue; }
    if (key === "threads" || key === "thread_type" || key === "extra_hw_frames") {
      validateWeaveGenericOption(key, expression, "median");
      continue;
    }
    if (key !== "radius" && key !== "radiusV" && key !== "planes" && key !== "percentile") {
      throw new Error(`median: unsupported option ${key ?? option}`);
    }
    const min = key === "radius" ? 1 : 0;
    const max = key === "percentile" ? 1 : key === "planes" ? 15 : 127;
    const value = parseFilterExpression(expression, "median", { min, max, default: defaults[key] });
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new RangeError(`median: ${key} must be between ${min} and ${max}`);
    }
    values[key] = key === "percentile" ? Math.fround(value)
      : value % 1 === 0.5 ? 2 * Math.round(value / 2) : Math.round(value);
  }

  const output: MediaVideoFrame[] = [];
  let work = 0;
  for (const [n, frame] of frames.entries()) {
    signal?.throwIfAborted();
    budget.checkCpu();
    const retained = frame.native;
    const native = retained?.rgba === frame.data && retained.width === frame.width &&
      retained.height === frame.height ? retained : undefined;
    const gray = native ? [8, 29, 30].includes(native.format) : pixelFormat === "gray" || pixelFormat === "gray8";
    if (native ? ![0, 4, 5, 8, 12, 13, 14, 29, 30].includes(native.format) : !gray) {
      throw new Error("median: only 8-bit or 16-bit grayscale or 8-bit planar YUV input is supported");
    }
    if (!(values.planes & (gray ? 1 : 7)) || enable !== undefined && !(Math.abs(parseFilterExpression(enable, "median enable", {
      n, t: frame.ptsSeconds, w: frame.width, h: frame.height, pos: frame.offset ?? NaN
    })) >= 0.5)) {
      output.push(frame);
      continue;
    }
    const source = native?.pixels;
    const sampleBytes = native && [29, 30].includes(native.format) ? 2 : 1;
    const littleEndian = native?.format === 30;
    const view = source ? new DataView(source.buffer, source.byteOffset, source.byteLength) : undefined;
    const read = (index: number) => sampleBytes === 2 ? view!.getUint16(index * 2, littleEndian)
      : source ? source[index]! : frame.data[index * 4]!;
    const length = source?.length ?? frame.width * frame.height;
    budget.allocateMemory(length + frame.width * frame.height * 4 + (sampleBytes === 2 ? 65536 + 256 : 256) * 4);
    const pixels = source ? new Uint8Array(source) : new Uint8Array(length);
    const outputView = new DataView(pixels.buffer);
    const histogram = new Uint32Array(sampleBytes === 2 ? 65536 : 256);
    // Locate the high byte first so 16-bit rank selection scans at most 512 bins.
    const coarse = sampleBytes === 2 ? new Uint32Array(256) : undefined;
    const hsub = native && [0, 4, 12, 13].includes(native.format) ? 2 : 1;
    const vsub = native && [0, 12].includes(native.format) ? 2 : 1;
    let offset = 0;
    for (let plane = 0; plane < (gray ? 1 : 3); plane++) {
      const width = Math.ceil(frame.width / (plane ? hsub : 1));
      const height = Math.ceil(frame.height / (plane ? vsub : 1));
      const start = offset;
      offset += width * height;
      if (!(values.planes & (1 << plane))) continue;
      const radius = Math.min(values.radius, Math.floor((width - 1) / 2));
      const radiusV = Math.min(values.radiusV || values.radius, Math.floor((height - 1) / 2));
      // FFmpeg selects floor((window size - 1) * percentile), using float precision.
      const rank = Math.trunc(Math.fround(((2 * radius + 1) * (2 * radiusV + 1) - 1) * values.percentile));
      for (let y = 0; y < height; y++) {
        histogram.fill(0);
        coarse?.fill(0);
        for (let dy = -radiusV; dy <= radiusV; dy++) {
          const row = Math.max(0, Math.min(height - 1, y + dy)) * width;
          for (let dx = -radius; dx <= radius; dx++) {
            if (++work >= 4096) { work = 0; await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            const index = start + row + Math.max(0, dx);
            const value = read(index);
            histogram[value]!++;
            if (coarse) coarse[value >>> 8]!++;
          }
        }
        for (let x = 0; x < width; x++) {
          if (work >= 4096) { work = 0; await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          let count = 0;
          let value = 0;
          if (coarse) {
            let high = 0;
            while (high < 255 && count + coarse[high]! <= rank) count += coarse[high++]!;
            value = high << 8;
          }
          while (value < histogram.length - 1 && count + histogram[value]! <= rank) count += histogram[value++]!;
          work += coarse ? 512 : 256;
          const index = start + y * width + x;
          if (sampleBytes === 2) outputView.setUint16(index * 2, value, littleEndian);
          else pixels[index] = value;
          // Slide the window one column, preserving repeated edge samples.
          if (x + 1 === width) continue;
          const left = Math.max(0, x - radius);
          const right = Math.min(width - 1, x + radius + 1);
          for (let dy = -radiusV; dy <= radiusV; dy++) {
            const row = start + Math.max(0, Math.min(height - 1, y + dy)) * width;
            const removed = read(row + left);
            const added = read(row + right);
            histogram[removed]!--;
            histogram[added]!++;
            if (coarse) {
              coarse[removed >>> 8]!--;
              coarse[added >>> 8]!++;
            }
            work += 2;
          }
        }
      }
    }
    const filtered = native ? { ...native, pixels } : {
      pixels, rgba: frame.data, width: frame.width, height: frame.height, format: 8, colorspace: 5, fullRange: 1
    };
    const data = scaleVideoPicture({ ...frame, native: filtered }, frame.width, frame.height)!;
    output.push({ ...frame, data, native: { ...filtered, rgba: data } });
  }
  return output;
}
