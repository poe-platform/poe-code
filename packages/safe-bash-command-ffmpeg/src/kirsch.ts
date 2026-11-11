import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function kirsch(
  frames: MediaVideoFrame[], argument: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const options = { planes: 15, scale: 1, delta: 0 };
  let enable: string | undefined;
  let position = 0;
  if (argument.endsWith(":")) argument = argument.slice(0, -1);
  for (const part of argument ? argument.split(":") : []) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? ["planes", "scale", "delta"][position++] : part.slice(0, separator).trim();
    if (separator >= 0) position = position === 0 ? 1 : 0;
    const text = (separator < 0 ? part : part.slice(separator + 1)).trim();
    if (key === "enable") { enable = text; continue; }
    if (key !== "planes" && key !== "scale" && key !== "delta") throw new Error(`kirsch: unsupported option ${key}`);
    const min = key === "delta" ? -65535 : 0;
    const max = key === "planes" ? 15 : 65535;
    const value = parseFilterExpression(text, "kirsch", {
      min, max, default: key === "planes" ? 15 : key === "scale" ? 1 : 0,
      PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    });
    if (!text || !Number.isFinite(value) || value < min || value > max) throw new RangeError(`kirsch: invalid ${key}`);
    const lower = Math.floor(value);
    options[key] = key === "planes" ? value - lower === 0.5 ? lower + lower % 2 : Math.round(value) : Math.fround(value);
  }

  const output: MediaVideoFrame[] = [];
  const registers = new Float64Array(10);
  let work = 0;
  for (const [n, frame] of frames.entries()) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    if (enable !== undefined && !(Math.abs(parseFilterExpression(enable, "kirsch enable", {
      n, t: frame.ptsSeconds, w: frame.width, h: frame.height, pos: frame.offset ?? NaN,
      NAN: NaN, INF: Infinity, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    }, undefined, registers)) >= 0.5)) {
      output.push(frame);
      continue;
    }
    const source = frame.native;
    const native = source?.rgba === frame.data && source.width === frame.width && source.height === frame.height &&
      [0, 4, 5, 8, 12, 13, 14].includes(source.format) ? source : undefined;
    const gray = native ? native.format === 8 : pixelFormat === "gray" || pixelFormat === "gray8";
    if (!native && !gray) throw new Error("kirsch: requires 8-bit grayscale or retained planar YUV input");
    if (!(options.planes & (gray ? 1 : 7))) { output.push(frame); continue; }
    const hsub = native && [0, 4, 12, 13].includes(native.format) ? 2 : 1;
    const vsub = native && [0, 12].includes(native.format) ? 2 : 1;
    const input = native?.pixels ?? frame.data;
    budget.allocateMemory(input.length + (native ? frame.data.length : 0));
    const pixels = new Uint8Array(input.length);
    for (let offset = 0; offset < input.length; offset += 65536) {
      await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
      pixels.set(input.subarray(offset, offset + 65536), offset);
    }
    let offset = 0;
    for (let plane = 0; plane < (gray ? 1 : 3); plane++) {
      const width = Math.ceil(frame.width / (plane > 0 ? hsub : 1));
      const height = Math.ceil(frame.height / (plane > 0 ? vsub : 1));
      const start = offset;
      offset += width * height;
      if (!(options.planes & (1 << plane))) continue;
      const stride = native ? 1 : 4;
      const read = (x: number, y: number) => input[start + (y * width + x) * stride]!;
      for (let y = 0; y < height; y++) {
        // FFmpeg reflects the top/left neighbor and repeats the bottom/right edge.
        const top = Math.min(height - 1, Math.abs(y - 1));
        const bottom = Math.min(height - 1, y + 1);
        for (let x = 0; x < width; x++) {
          if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const left = Math.min(width - 1, Math.abs(x - 1));
          const right = Math.min(width - 1, x + 1);
          const a = read(left, top), b = read(x, top), c = read(right, top);
          const d = read(left, y), e = read(right, y);
          const f = read(left, bottom), g = read(x, bottom), h = read(right, bottom);
          // Native kernels rotate three +5 weights through these eight samples in
          // raster order; all other weights are -3 and the center is excluded.
          const response = 8 * Math.max(a + b + c, b + c + d, c + d + e, d + e + f,
            e + f + g, f + g + h, g + h + a, h + a + b) - 3 * (a + b + c + d + e + f + g + h);
          const value = Math.max(0, Math.min(255, Math.trunc(Math.fround(Math.fround(Math.abs(response) * options.scale) + options.delta))));
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
