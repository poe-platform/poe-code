import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { formatYuv } from "./format-yuv.js";

export async function scharr(
  frames: MediaVideoFrame[], argument: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const options = { planes: 15, scale: 1, delta: 0 };
  let enable: string | undefined;
  let position = 0;
  const parts = argument ? argument.split(":") : [];
  if (parts.at(-1) === "") parts.pop();
  for (const part of parts) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? ["planes", "scale", "delta"][position++] : part.slice(0, separator).trim();
    if (separator >= 0) position = position === 0 ? 1 : 0;
    const text = (separator < 0 ? part : part.slice(separator + 1)).trim();
    if (key === "enable") { enable = text; continue; }
    if (key !== "planes" && key !== "scale" && key !== "delta") throw new Error(`scharr: unsupported option ${key}`);
    const min = key === "delta" ? -65535 : 0;
    const max = key === "planes" ? 15 : 65535;
    const value = parseFilterExpression(text, "scharr", {
      min, max, default: key === "planes" ? 15 : key === "scale" ? 1 : 0,
      PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    });
    if (!text || !Number.isFinite(value) || value < min || value > max) throw new RangeError(`scharr: invalid ${key}`);
    const lower = Math.floor(value);
    options[key] = key === "planes" ? (value - lower === 0.5 ? lower + lower % 2 : Math.round(value)) : Math.fround(value);
  }
  const output: MediaVideoFrame[] = [];
  const registers = new Float64Array(10);
  let work = 0;
  for (const [n, original] of frames.entries()) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    if (enable !== undefined) {
      const variables = { n, t: original.ptsSeconds, w: original.width, h: original.height, pos: original.offset ?? NaN, NAN: NaN, INF: Infinity };
      parseFilterExpression(enable, "scharr enable", variables, undefined, registers);
      if (!(Math.abs(parseFilterExpression(enable, "scharr enable", variables, undefined, registers)) >= 0.5)) {
        output.push(original);
        continue;
      }
    }
    if (!options.planes) { output.push(original); continue; }
    let frame = original;
    if ((pixelFormat === "yuv420p" || pixelFormat === "yuv422p" || pixelFormat === "yuv444p") &&
        (frame.native?.rgba !== frame.data || frame.native.width !== frame.width || frame.native.height !== frame.height)) {
      budget.allocateMemory(frame.width * frame.height * 7);
      frame = await formatYuv(frame, pixelFormat, signal);
    }
    const source = frame.native;
    const native = source?.rgba === frame.data && source.width === frame.width && source.height === frame.height ? source : undefined;
    const gray = native ? native.format === 8 : pixelFormat === "gray" || pixelFormat === "gray8";
    if (native ? ![0, 4, 5, 8, 12, 13, 14].includes(native.format) : !gray) {
      throw new Error("scharr: requires 8-bit grayscale or planar YUV input");
    }
    const input = native?.pixels ?? frame.data;
    budget.allocateMemory(input.length + (native ? frame.data.length : 0));
    const pixels = new Uint8Array(input.length);
    for (let offset = 0; offset < input.length; offset += 65536) {
      await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
      pixels.set(input.subarray(offset, offset + 65536), offset);
    }
    const hsub = native && [0, 4, 12, 13].includes(native.format) ? 2 : 1;
    const vsub = native && [0, 12].includes(native.format) ? 2 : 1;
    let offset = 0;
    for (let plane = 0; plane < (gray ? 1 : 3); plane++) {
      const width = Math.ceil(frame.width / (plane ? hsub : 1));
      const height = Math.ceil(frame.height / (plane ? vsub : 1));
      const start = offset;
      const stride = native ? 1 : 4;
      offset += width * height;
      if (!(options.planes & (1 << plane))) continue;
      const read = (x: number, y: number) => input[start + (y * width + x) * stride]!;
      for (let y = 0; y < height; y++) {
        // Native reflects the leading edge and repeats the trailing edge.
        const top = y === 0 ? Math.min(1, height - 1) : y - 1;
        const bottom = Math.min(y + 1, height - 1);
        for (let x = 0; x < width; x++) {
          if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const left = x === 0 ? Math.min(1, width - 1) : x - 1;
          const right = Math.min(x + 1, width - 1);
          const tl = read(left, top), tr = read(right, top);
          const bl = read(left, bottom), br = read(right, bottom);
          const vertical = (47 * (bl + br - tl - tr) + 162 * (read(x, bottom) - read(x, top))) / 256;
          const horizontal = (47 * (tr + br - tl - bl) + 162 * (read(right, y) - read(left, y))) / 256;
          const f = Math.fround;
          const magnitude = f(Math.sqrt(f(f(vertical * vertical) + f(horizontal * horizontal))));
          const value = Math.max(0, Math.min(255, Math.trunc(f(f(magnitude * options.scale) + options.delta))));
          const index = start + (y * width + x) * stride;
          if (native) pixels[index] = value;
          else pixels.fill(value, index, index + 3);
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
