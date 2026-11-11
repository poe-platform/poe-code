import { scaleVideoPicture, type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function tmidequalizer(
  frames: MediaVideoFrame[], argument: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const options = { radius: 5, sigma: 0.5, planes: 15 };
  let position = 0;
  if (argument.endsWith(":")) argument = argument.slice(0, -1);
  for (const option of argument ? argument.split(":") : []) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["radius", "sigma", "planes"][position++] : option.slice(0, separator).trim();
    if (separator >= 0) position = position === 0 ? 1 : 0;
    if (key !== "radius" && key !== "sigma" && key !== "planes") throw new Error(`tmidequalizer: unsupported option ${key}`);
    const text = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const min = key === "radius" ? 1 : 0;
    const max = key === "radius" ? 127 : key === "sigma" ? 1 : 15;
    const value = parseFilterExpression(text, "tmidequalizer", { min, max, default: options[key] });
    if (!text || !Number.isFinite(value) || value < min || value > max) throw new RangeError(`tmidequalizer: ${key} must be from ${min} to ${max}`);
    const lower = Math.floor(value);
    options[key] = key === "sigma" ? Math.fround(value) : value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
  }
  if (!options.planes || !frames.length) return frames;
  const f = Math.fround;
  const radius = options.radius;
  const sigma = f(radius * options.sigma);
  const kernel = Array.from({ length: radius }, (_, n) => sigma === 0 ? 0 : f(Math.exp(-0.5 * (n + 1) ** 2 / f(sigma * sigma))));
  const first = frames[0]!;
  const native = first.native?.rgba === first.data ? first.native : undefined;
  if (native && ![0, 4, 5, 8, 12, 13, 14].includes(native.format)) throw new Error("tmidequalizer: unsupported native pixel format");
  const packed = !native;
  const gray = native?.format === 8;
  const hsub = native && [0, 4, 12, 13].includes(native.format) ? 2 : 1;
  const vsub = native && [0, 12].includes(native.format) ? 2 : 1;
  let offset = 0;
  const planes = Array.from({ length: gray ? 1 : packed ? 4 : 3 }, (_, plane) => {
    const count = Math.ceil(first.width / (plane > 0 && !packed ? hsub : 1)) * Math.ceil(first.height / (plane > 0 && !packed ? vsub : 1));
    const start = packed ? [1, 2, 0, 3][plane]! : offset;
    offset += count;
    return { start, count, stride: packed ? 4 : 1 };
  });
  const histogramBytes = planes.length * 256 * 4;
  const histograms = new Map<number, Float32Array[]>();
  const output: MediaVideoFrame[] = [];
  let work = 0;
  try {
    for (const [index, frame] of frames.entries()) {
      await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
      for (const cached of histograms.keys()) {
        if (cached < index - radius) { histograms.delete(cached); budget.releaseMemory(histogramBytes); }
      }
      for (let neighbor = Math.max(0, index - radius); neighbor <= Math.min(frames.length - 1, index + radius); neighbor++) {
        if (histograms.has(neighbor)) continue;
        const source = frames[neighbor]!;
        if (source.width !== first.width || source.height !== first.height || (native && (source.native?.format !== native.format || source.native.rgba !== source.data))) {
          throw new Error("tmidequalizer: frames must have matching dimensions and pixel formats");
        }
        budget.allocateMemory(histogramBytes);
        const hist = planes.map(() => new Float32Array(256));
        histograms.set(neighbor, hist);
        const pixels = native ? source.native!.pixels : source.data;
        for (const [p, plane] of planes.entries()) {
          if (!(options.planes & (1 << p))) continue;
          const bins = hist[p]!;
          for (let i = 0; i < plane.count; i++) {
            if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            bins[pixels[plane.start + i * plane.stride]!]! += 1;
          }
          for (let i = 0; i < 256; i++) bins[i] = bins[i]! / 256 + (i ? bins[i - 1]! : 0);
        }
      }
      const input = native ? frame.native!.pixels : frame.data;
      budget.allocateMemory(input.length + (native ? frame.data.length : 0));
      const pixels = new Uint8Array(input.length);
      for (let i = 0; i < input.length; i += 65536) {
        await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
        pixels.set(input.subarray(i, i + 65536), i);
      }
      const scratchBytes = 256 + (2 * radius + 1) * 4;
      budget.allocateMemory(scratchBytes);
      try {
        const change = new Uint8Array(256);
        const cursors = new Uint32Array(2 * radius + 1);
        for (const [p, plane] of planes.entries()) {
          if (!(options.planes & (1 << p))) continue;
          cursors.fill(0);
          const original = histograms.get(index)![p]!;
          for (let value = 0; value < 256; value++) {
            let sum = value, weight = 1;
            for (let slot = 0; slot <= 2 * radius; slot++) {
              if (slot === radius) continue;
              const neighbor = Math.max(0, Math.min(frames.length - 1, index - radius + slot));
              const histogram = histograms.get(neighbor)![p]!;
              while (cursors[slot]! < 255 && histogram[cursors[slot]!]! < original[value]!) cursors[slot]!++;
              // Native assigns increasing distance weights oldest-to-center on
              // the left, and center-to-newest on the right (not symmetrically).
              const k = kernel[slot < radius ? slot : slot - radius - 1]!;
              weight = f(weight + k);
              sum = f(sum + f(k * cursors[slot]!));
              if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            }
            const mapped = f(sum / weight), lower = Math.floor(mapped);
            change[value] = mapped - lower === 0.5 ? lower + lower % 2 : Math.round(mapped);
          }
          for (let i = 0; i < plane.count; i++) {
            if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            const at = plane.start + i * plane.stride;
            pixels[at] = change[input[at]!]!;
          }
        }
      } finally { budget.releaseMemory(scratchBytes); }
      if (native) {
        const filtered = { ...frame.native!, pixels };
        const data = scaleVideoPicture({ ...frame, native: filtered }, frame.width, frame.height)!;
        output.push({ ...frame, data, native: { ...filtered, rgba: data } });
      } else {
        const filtered = { ...frame, data: pixels };
        delete filtered.native;
        output.push(filtered);
      }
    }
  } finally { budget.releaseMemory(histograms.size * histogramBytes); }
  return output;
}
