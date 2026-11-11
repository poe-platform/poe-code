import { scaleVideoPicture, type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function prewitt(
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
    const key = separator < 0 ? ["planes", "scale", "delta"][position] : part.slice(0, separator).trim();
    if (separator < 0) position++;
    else position = position === 0 ? 1 : 0;
    const text = (separator < 0 ? part : part.slice(separator + 1)).trim();
    if (key === "enable") { enable = text; continue; }
    if (key !== "scale" && key !== "delta" && key !== "planes") throw new Error(`prewitt: unsupported option ${key}`);
    const min = key === "delta" ? -65535 : 0;
    const max = key === "planes" ? 15 : 65535;
    const value = parseFilterExpression(text, "prewitt", {
      min, max, default: key === "scale" ? 1 : key === "planes" ? 15 : 0,
      PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    });
    if (!text || !Number.isFinite(value) || value < min || value > max) throw new RangeError(`prewitt: invalid ${key}`);
    const lower = Math.floor(value);
    options[key] = key !== "planes" ? Math.fround(value) : value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
  }
  const output: MediaVideoFrame[] = [];
  const registers = new Float64Array(10);
  let work = 0;
  for (const [n, frame] of frames.entries()) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    if (enable !== undefined) {
      const variables = { n, t: frame.ptsSeconds, w: frame.width, h: frame.height, pos: frame.offset ?? NaN, NAN: NaN, INF: Infinity };
      parseFilterExpression(enable, "prewitt enable", variables, undefined, registers);
      if (!(Math.abs(parseFilterExpression(enable, "prewitt enable", variables, undefined, registers)) >= 0.5)) {
        output.push(frame);
        continue;
      }
    }
    if (options.planes === 0) { output.push(frame); continue; }
    const source = frame.native;
    const native = source?.rgba === frame.data && source.width === frame.width && source.height === frame.height &&
      [0, 4, 5, 8, 12, 13, 14].includes(source.format) ? source : undefined;
    const gray = native ? native.format === 8 : pixelFormat === "gray" || pixelFormat === "gray8";
    if (!native && !gray) throw new Error("prewitt: requires 8-bit grayscale or retained planar YUV input");
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
      const width = plane ? Math.ceil(frame.width / hsub) : frame.width;
      const height = plane ? Math.ceil(frame.height / vsub) : frame.height;
      const start = offset;
      const stride = native ? 1 : 4;
      offset += width * height;
      if (!(options.planes & (1 << plane))) continue;
      const read = (x: number, y: number) => {
        // Native 3x3 setup reflects the leading edge and repeats the trailing edge.
        x = Math.min(Math.abs(x), width - 1);
        y = Math.min(Math.abs(y), height - 1);
        return input[start + (y * width + x) * stride]!;
      };
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const tl = read(x - 1, y - 1), tc = read(x, y - 1), tr = read(x + 1, y - 1);
          const ml = read(x - 1, y), mr = read(x + 1, y);
          const bl = read(x - 1, y + 1), bc = read(x, y + 1), br = read(x + 1, y + 1);
          const vertical = bl + bc + br - tl - tc - tr;
          const horizontal = tr + mr + br - tl - ml - bl;
          const magnitude = Math.fround(Math.sqrt(vertical * vertical + horizontal * horizontal));
          const value = Math.max(0, Math.min(255, Math.trunc(Math.fround(Math.fround(magnitude * options.scale) + options.delta))));
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
