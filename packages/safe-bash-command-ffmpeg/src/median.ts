import type { MediaBudgetTracker, MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

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
    if (key !== "radius" && key !== "radiusV" && key !== "planes" && key !== "percentile") {
      throw new Error(`median: unsupported option ${key ?? option}`);
    }
    const min = key === "radius" ? 1 : 0;
    const max = key === "percentile" ? 1 : key === "planes" ? 15 : 127;
    const value = parseFilterExpression(expression, "median", { min, max, default: defaults[key] });
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`median: ${key} must be between ${min} and ${max}`);
    }
    values[key] = key === "percentile" ? Math.fround(value)
      : value % 1 === 0.5 ? 2 * Math.round(value / 2) : Math.round(value);
  }

  const output: MediaVideoFrame[] = [];
  let work = 0;
  for (const [n, frame] of frames.entries()) {
    signal?.throwIfAborted();
    budget.checkCpu();
    const { width, height } = frame;
    const native = frame.native;
    const source = native?.format === 8 && native.rgba === frame.data &&
      native.width === width && native.height === height ? native.pixels : undefined;
    if (!source && pixelFormat !== "gray" && pixelFormat !== "gray8") {
      throw new Error("median: only 8-bit grayscale input is supported");
    }
    if (!(values.planes & 1) || enable !== undefined && !(Math.abs(parseFilterExpression(enable, "median enable", {
      n, t: frame.ptsSeconds, w: width, h: height, pos: frame.offset ?? NaN
    })) >= 0.5)) {
      output.push(frame);
      continue;
    }
    const radius = Math.min(values.radius, Math.floor((width - 1) / 2));
    const radiusV = Math.min(values.radiusV || values.radius, Math.floor((height - 1) / 2));
    // FFmpeg selects floor((window size - 1) * percentile), using float precision.
    const rank = Math.trunc(Math.fround(((2 * radius + 1) * (2 * radiusV + 1) - 1) * values.percentile));
    budget.allocateMemory(width * height * 5 + 256 * 4);
    const pixels = new Uint8Array(width * height);
    const data = new Uint8Array(width * height * 4);
    const histogram = new Uint32Array(256);
    for (let y = 0; y < height; y++) {
      histogram.fill(0);
      for (let dy = -radiusV; dy <= radiusV; dy++) {
        const row = Math.max(0, Math.min(height - 1, y + dy)) * width;
        for (let dx = -radius; dx <= radius; dx++) {
          if (++work >= 4096) { work = 0; await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const index = row + Math.max(0, dx);
          histogram[source ? source[index]! : frame.data[index * 4]!]!++;
        }
      }
      for (let x = 0; x < width; x++) {
        if (work >= 4096) { work = 0; await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        let count = 0;
        let value = 0;
        while (value < 255 && count + histogram[value]! <= rank) count += histogram[value++]!;
        work += 256;
        const index = y * width + x;
        pixels[index] = value;
        data.fill(value, index * 4, index * 4 + 3);
        data[index * 4 + 3] = 255;
        // Slide the window one column, preserving repeated edge samples.
        if (x + 1 === width) continue;
        const left = Math.max(0, x - radius);
        const right = Math.min(width - 1, x + radius + 1);
        for (let dy = -radiusV; dy <= radiusV; dy++) {
          const row = Math.max(0, Math.min(height - 1, y + dy)) * width;
          histogram[source ? source[row + left]! : frame.data[(row + left) * 4]!]!--;
          histogram[source ? source[row + right]! : frame.data[(row + right) * 4]!]!++;
          work += 2;
        }
      }
    }
    output.push({ ...frame, data, native: {
      ...native, pixels, rgba: data, width, height, format: 8, colorspace: 5, fullRange: 1
    } });
  }
  return output;
}
