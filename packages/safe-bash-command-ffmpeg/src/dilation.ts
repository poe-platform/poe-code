import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function dilation(
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
      throw new Error(`dilation: unsupported option ${key}`);
    }
    const max = key === "coordinates" ? 255 : 65535;
    const value = parseFilterExpression(text, "dilation", { min: 0, max, default: max, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 });
    if (!text || !Number.isFinite(value) || value < 0 || value > max) throw new RangeError(`dilation: ${key} must be from 0 to ${max}`);
    const lower = Math.floor(value);
    options[key] = value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
  }
  const thresholds = [options.threshold0, options.threshold1, options.threshold2, options.threshold3];
  // Bits run left to right across the top, middle (without center), and bottom rows.
  const neighbors = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
    .filter((_, bit) => options.coordinates & (1 << bit));
  const output: MediaVideoFrame[] = [];
  const registers = new Float64Array(10);
  let work = 0;
  for (const [n, frame] of frames.entries()) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    const source = frame.native;
    const native = source?.rgba === frame.data && source.width === frame.width && source.height === frame.height ? source : undefined;
    const gray = native ? [8, 29, 30].includes(native.format) : pixelFormat === "gray" || pixelFormat === "gray8";
    if (native ? ![0, 4, 5, 8, 12, 13, 14, 29, 30, 49, 62, 68].includes(native.format) : !gray) {
      throw new Error("dilation: requires grayscale or retained planar YUV input");
    }
    if (enable !== undefined) {
      const variables = { n, t: frame.ptsSeconds, w: frame.width, h: frame.height, pos: frame.offset ?? NaN };
      parseFilterExpression(enable, "dilation enable", variables, undefined, registers);
      if (!(Math.abs(parseFilterExpression(enable, "dilation enable", variables, undefined, registers)) >= 0.5)) {
        output.push(frame);
        continue;
      }
    }
    if (!neighbors.length || thresholds.slice(0, gray ? 1 : 3).every(value => value === 0)) { output.push(frame); continue; }
    const sampleBytes = native && [29, 30, 49, 62, 68].includes(native.format) ? 2 : 1;
    const littleEndian = native?.format !== 29;
    const hsub = native && [0, 4, 12, 13, 62].includes(native.format) ? 2 : 1;
    const vsub = native && [0, 12, 62].includes(native.format) ? 2 : 1;
    const input = native?.pixels ?? frame.data;
    budget.allocateMemory(input.length + (native ? frame.data.length : 0));
    const pixels = new Uint8Array(input.length);
    for (let start = 0; start < input.length; start += 65536) {
      await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
      pixels.set(input.subarray(start, start + 65536), start);
    }
    const inputView = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const outputView = new DataView(pixels.buffer);
    let offset = 0;
    for (let plane = 0; plane < (gray ? 1 : 3); plane++) {
      const width = Math.ceil(frame.width / (plane ? hsub : 1));
      const height = Math.ceil(frame.height / (plane ? vsub : 1));
      const start = offset;
      offset += width * height * sampleBytes;
      if (!thresholds[plane]) continue;
      const stride = native ? sampleBytes : 4;
      const read = (x: number, y: number) => {
        const index = start + (y * width + x) * stride;
        return sampleBytes === 2 ? inputView.getUint16(index, littleEndian) : input[index]!;
      };
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const original = read(x, y);
          let value = original;
          for (const [dx, dy] of neighbors) {
            const nx = x + dx!;
            // Horizontal borders reflect inward; vertical borders repeat the edge row.
            const column = width === 1 ? 0 : nx < 0 ? 1 : nx >= width ? width - 2 : nx;
            value = Math.max(value, read(column, Math.max(0, Math.min(height - 1, y + dy!))));
          }
          value = Math.min(value, original + thresholds[plane]!);
          const index = start + (y * width + x) * stride;
          if (sampleBytes === 2) outputView.setUint16(index, value, littleEndian);
          else {
            pixels[index] = value;
            if (!native) pixels[index + 1] = pixels[index + 2] = value;
          }
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
