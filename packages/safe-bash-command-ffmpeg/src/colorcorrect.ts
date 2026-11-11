import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function colorcorrect(
  frames: MediaVideoFrame[], argument: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const options = { rl: 0, bl: 0, rh: 0, bh: 0, saturation: 1, analyze: 0 };
  const keys = ["rl", "bl", "rh", "bh", "saturation", "analyze"] as const;
  const parts = argument ? argument.split(":") : [];
  if (parts.at(-1) === "") parts.pop();
  for (const [index, part] of parts.entries()) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? keys[index] : part.slice(0, separator).trim();
    if (key !== "rl" && key !== "bl" && key !== "rh" && key !== "bh" && key !== "saturation" && key !== "analyze") {
      throw new Error(`colorcorrect: unsupported option ${key}`);
    }
    const text = (separator < 0 ? part : part.slice(separator + 1)).trim();
    const min = key === "analyze" ? 0 : key === "saturation" ? -3 : -1;
    const max = key === "saturation" ? 3 : 1;
    const value = parseFilterExpression(text, "colorcorrect", {
      min, max, default: key === "saturation" ? 1 : 0, manual: 0, average: 1
    });
    if (!text || !Number.isFinite(value) || value < min || value > max || key === "analyze" && !Number.isInteger(value)) {
      throw new RangeError(`colorcorrect: unsupported ${key}`);
    }
    options[key] = Math.fround(value);
  }
  const output: MediaVideoFrame[] = [];
  const f = Math.fround;
  const imax = f(1 / 255);
  for (const frame of frames) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    const source = frame.native;
    if (!source || source.rgba !== frame.data || source.width !== frame.width || source.height !== frame.height ||
        ![0, 4, 5, 12, 13, 14, 79].includes(source.format)) {
      throw new Error("colorcorrect: requires 8-bit planar YUV input");
    }
    const hsub = [0, 4, 12, 13].includes(source.format) ? 2 : 1;
    const vsub = [0, 12].includes(source.format) ? 2 : 1;
    const width = Math.ceil(frame.width / hsub);
    const height = Math.ceil(frame.height / vsub);
    const lumaSize = frame.width * frame.height;
    const chromaSize = width * height;
    budget.allocateMemory(source.pixels.length + frame.data.length);
    const pixels = new Uint8Array(source.pixels.length);
    for (let offset = 0; offset < pixels.length; offset += 65536) {
      await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
      pixels.set(source.pixels.subarray(offset, offset + 65536), offset);
    }
    let { rl, bl, rh, bh } = options;
    if (options.analyze === 1) {
      // Match the reference FFmpeg build's 16 slices and float reduction order.
      const slices = Math.min(height, 16);
      let blue = 0, red = 0;
      for (let slice = 0; slice < slices; slice++) {
        const start = Math.floor(height * slice / slices) * width;
        const end = Math.floor(height * (slice + 1) / slices) * width;
        let u = 0, v = 0;
        for (let index = start; index < end; index++) {
          if (index % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          u += pixels[lumaSize + index]!;
          v += pixels[lumaSize + chromaSize + index]!;
        }
        blue = f(blue + f(f(f(imax * u) / (end - start)) - 0.5));
        red = f(red + f(f(f(imax * v) / (end - start)) - 0.5));
      }
      bl = bh = -f(blue / slices);
      rl = rh = -f(red / slices);
    }
    const bd = f(bh - bl), rd = f(rh - rl);
    for (let row = 0; row < height; row++) {
      for (let x = 0; x < width; x++) {
        const index = row * width + x;
        if (index % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        const y = f(pixels[row * vsub * frame.width + x * hsub]! * imax);
        const u = f(f(pixels[lumaSize + index]! * imax) - 0.5);
        const v = f(f(pixels[lumaSize + chromaSize + index]! * imax) - 0.5);
        const nu = f(options.saturation * f(f(u + f(y * bd)) + bl));
        const nv = f(options.saturation * f(f(v + f(y * rd)) + rl));
        pixels[lumaSize + index] = Math.max(0, Math.min(255, Math.trunc(f(f(nu + 0.5) * 255))));
        pixels[lumaSize + chromaSize + index] = Math.max(0, Math.min(255, Math.trunc(f(f(nv + 0.5) * 255))));
      }
    }
    const native = { ...source, pixels };
    const data = scaleVideoPicture({ ...frame, native }, frame.width, frame.height)!;
    output.push({ ...frame, data, native: { ...native, rgba: data } });
  }
  return output;
}
