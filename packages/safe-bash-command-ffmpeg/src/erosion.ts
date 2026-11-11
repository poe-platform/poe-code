import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function erosion(
  frames: MediaVideoFrame[], argument: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const options = { coordinates: 255, threshold0: 65535, threshold1: 65535, threshold2: 65535, threshold3: 65535 };
  let enable: string | undefined;
  let position = 0;
  if (argument.endsWith(":")) argument = argument.slice(0, -1);
  for (const part of argument ? argument.split(":") : []) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? Object.keys(options)[position++] : part.slice(0, separator).trim();
    if (separator >= 0) position = position === 0 ? 1 : 0;
    const text = (separator < 0 ? part : part.slice(separator + 1)).trim();
    if (key === "enable") { enable = text; continue; }
    if (key !== "coordinates" && key !== "threshold0" && key !== "threshold1" && key !== "threshold2" && key !== "threshold3") {
      throw new Error(`erosion: unsupported option ${key}`);
    }
    const max = key === "coordinates" ? 255 : 65535;
    const value = parseFilterExpression(text, "erosion", {
      min: 0, max, default: max, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    });
    if (!text || !Number.isFinite(value) || value < 0 || value > max) throw new RangeError(`erosion: invalid ${key}`);
    const lower = Math.floor(value);
    options[key] = value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
  }

  const output: MediaVideoFrame[] = [];
  const registers = new Float64Array(10);
  const thresholds = [options.threshold0, options.threshold1, options.threshold2];
  let work = 0;
  for (const [n, frame] of frames.entries()) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    const retained = frame.native;
    const native = retained?.rgba === frame.data && retained.width === frame.width && retained.height === frame.height
      ? retained : undefined;
    const gray = native ? native.format === 8 : pixelFormat === "gray" || pixelFormat === "gray8";
    if (native ? ![0, 4, 5, 8, 12, 13, 14].includes(native.format) : !gray) {
      throw new Error("erosion: requires 8-bit grayscale or retained planar YUV input");
    }
    if (enable !== undefined) {
      const variables = { n, t: frame.ptsSeconds, w: frame.width, h: frame.height, pos: frame.offset ?? NaN,
        NAN: NaN, INF: Infinity, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 };
      // Generic FFmpeg timeline expressions are evaluated twice per frame.
      parseFilterExpression(enable, "erosion enable", variables, undefined, registers);
      if (!(Math.abs(parseFilterExpression(enable, "erosion enable", variables, undefined, registers)) >= 0.5)) {
        output.push(frame);
        continue;
      }
    }
    if (!options.coordinates || !thresholds.slice(0, gray ? 1 : 3).some(Boolean)) { output.push(frame); continue; }
    const input = native?.pixels ?? frame.data;
    budget.allocateMemory(input.length + (native ? frame.data.length : 0));
    const pixels = new Uint8Array(input.length);
    for (let offset = 0; offset < input.length; offset += 65536) {
      await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
      pixels.set(input.subarray(offset, offset + 65536), offset);
    }
    const hsub = native && [0, 4, 12, 13].includes(native.format) ? 2 : 1;
    const vsub = native && [0, 12].includes(native.format) ? 2 : 1;
    const stride = native ? 1 : 4;
    let offset = 0;
    for (let plane = 0; plane < (gray ? 1 : 3); plane++) {
      const width = Math.ceil(frame.width / (plane ? hsub : 1));
      const height = Math.ceil(frame.height / (plane ? vsub : 1));
      const start = offset;
      offset += width * height;
      const threshold = thresholds[plane]!;
      if (!threshold) continue;
      const read = (x: number, y: number) => input[start + (y * width + x) * stride]!;
      for (let y = 0; y < height; y++) {
        // Native erosion repeats vertical borders and reflects horizontal neighbors.
        const top = Math.max(0, y - 1), bottom = Math.min(height - 1, y + 1);
        for (let x = 0; x < width; x++) {
          if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const left = x ? x - 1 : Math.min(1, width - 1);
          const right = x + 1 < width ? x + 1 : Math.max(0, width - 2);
          const center = read(x, y);
          let value = center;
          if (options.coordinates & 1) value = Math.min(value, read(left, top));
          if (options.coordinates & 2) value = Math.min(value, read(x, top));
          if (options.coordinates & 4) value = Math.min(value, read(right, top));
          if (options.coordinates & 8) value = Math.min(value, read(left, y));
          if (options.coordinates & 16) value = Math.min(value, read(right, y));
          if (options.coordinates & 32) value = Math.min(value, read(left, bottom));
          if (options.coordinates & 64) value = Math.min(value, read(x, bottom));
          if (options.coordinates & 128) value = Math.min(value, read(right, bottom));
          value = Math.max(value, center - threshold);
          const index = start + (y * width + x) * stride;
          pixels[index] = value;
          if (!native) pixels[index + 1] = pixels[index + 2] = value;
        }
      }
    }
    if (native) {
      const filtered = { ...native, pixels };
      const data = scaleVideoPicture({ ...frame, native: filtered }, frame.width, frame.height)!;
      output.push({ ...frame, data, native: { ...filtered, rgba: data } });
    } else {
      const filtered = { ...frame, data: pixels };
      delete filtered.native;
      output.push(filtered);
    }
  }
  return output;
}
