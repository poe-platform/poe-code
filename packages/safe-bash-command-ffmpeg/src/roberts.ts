import { scaleVideoPicture, type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function roberts(
  frames: MediaVideoFrame[], argument: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const options = { planes: 15, scale: 1, delta: 0 };
  let enable: string | undefined;
  let named = false;
  for (const [index, part] of (argument ? argument.split(":") : []).entries()) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? ["planes", "scale", "delta"][index] : part.slice(0, separator).trim();
    const text = (separator < 0 ? part : part.slice(separator + 1)).trim();
    if (separator < 0 && named) throw new Error("roberts: positional option after named option");
    named ||= separator >= 0;
    if (key === "enable") { enable = text; continue; }
    if (key !== "planes" && key !== "scale" && key !== "delta") throw new Error(`roberts: unsupported option ${key}`);
    const min = key === "delta" ? -65535 : 0;
    const max = key === "planes" ? 15 : 65535;
    const value = parseFilterExpression(text, "roberts", {
      min, max, default: options[key], PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    });
    if (!text || !Number.isFinite(value) || value < min || value > max) throw new RangeError(`roberts: invalid ${key}`);
    const lower = Math.floor(value);
    options[key] = key === "planes" ? value - lower === 0.5 ? lower + lower % 2 : Math.round(value) : Math.fround(value);
  }
  const output: MediaVideoFrame[] = [];
  let work = 0;
  for (const [n, frame] of frames.entries()) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    if (options.planes === 0 || enable !== undefined && !(Math.abs(parseFilterExpression(enable, "roberts enable", {
      n, t: frame.ptsSeconds, w: frame.width, h: frame.height, pos: frame.offset ?? NaN
    })) >= 0.5)) { output.push(frame); continue; }
    const source = frame.native;
    const native = source?.rgba === frame.data && source.width === frame.width && source.height === frame.height &&
      [0, 4, 5, 8, 12, 13, 14].includes(source.format) ? source : undefined;
    const gray = native ? native.format === 8 : pixelFormat === "gray" || pixelFormat === "gray8";
    if (!native && !gray) throw new Error("roberts: requires 8-bit grayscale or retained planar YUV input");
    const hsub = native && [0, 4, 12, 13].includes(native.format) ? 2 : 1;
    const vsub = native && [0, 12].includes(native.format) ? 2 : 1;
    const input = native?.pixels ?? frame.data;
    budget.allocateMemory(input.length + (native ? frame.data.length : 0));
    const pixels = new Uint8Array(input.length);
    for (let offset = 0; offset < input.length; offset += 65536) {
      await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
      pixels.set(input.subarray(offset, offset + 65536), offset);
    }
    let start = 0;
    for (let plane = 0; plane < (gray ? 1 : 3); plane++) {
      const width = plane ? Math.ceil(frame.width / hsub) : frame.width;
      const height = plane ? Math.ceil(frame.height / vsub) : frame.height;
      const stride = native ? 1 : 4;
      if (options.planes & (1 << plane)) {
        for (let y = 0; y < height; y++) {
          const previousY = y === 0 ? Math.min(1, height - 1) : y - 1;
          for (let x = 0; x < width; x++) {
            if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            const previousX = x === 0 ? Math.min(1, width - 1) : x - 1;
            const index = start + (y * width + x) * stride;
            // FFmpeg uses horizontal differences in the previous and current rows (c0-c1, c4-c3).
            const gx = input[start + (previousY * width + previousX) * stride]! - input[start + (previousY * width + x) * stride]!;
            const gy = input[index]! - input[start + (y * width + previousX) * stride]!;
            const value = Math.max(0, Math.min(255, Math.trunc(Math.fround(
              Math.fround(Math.fround(Math.sqrt(gx * gx + gy * gy)) * options.scale) + options.delta))));
            pixels[index] = value;
            if (!native) pixels[index + 1] = pixels[index + 2] = value;
          }
        }
      }
      start += width * height;
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
