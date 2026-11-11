import { scaleVideoPicture, type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function avgblur(
  frames: MediaVideoFrame[], argument: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const options = { sizeX: 1, planes: 15, sizeY: 0 };
  let enable: string | undefined;
  let position = 0;
  const parts = argument ? argument.split(":") : [];
  if (parts.at(-1) === "") parts.pop();
  for (const part of parts) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? ["sizeX", "planes", "sizeY"][position] : part.slice(0, separator).trim();
    if (separator < 0) position++;
    else position = position === 0 ? 1 : 0;
    const text = (separator < 0 ? part : part.slice(separator + 1)).trim();
    if (key === "enable") { enable = text; continue; }
    if (key !== "sizeX" && key !== "sizeY" && key !== "planes") throw new Error(`avgblur: unsupported option ${key}`);
    const min = key === "sizeX" ? 1 : 0;
    const max = key === "planes" ? 15 : 1024;
    const value = parseFilterExpression(text, "avgblur", {
      min, max, default: key === "sizeX" ? 1 : key === "planes" ? 15 : 0,
      PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    });
    if (!text || !Number.isFinite(value) || value < min || value > max) throw new RangeError(`avgblur: invalid ${key}`);
    const lower = Math.floor(value);
    options[key] = value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
  }
  const output: MediaVideoFrame[] = [];
  const registers = new Float64Array(10);
  let work = 0;
  for (const [n, frame] of frames.entries()) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    if (enable !== undefined) {
      const variables = { n, t: frame.ptsSeconds, w: frame.width, h: frame.height, pos: frame.offset ?? NaN, NAN: NaN, INF: Infinity };
      parseFilterExpression(enable, "avgblur enable", variables, undefined, registers);
      if (!(Math.abs(parseFilterExpression(enable, "avgblur enable", variables, undefined, registers)) >= 0.5)) {
        output.push(frame);
        continue;
      }
    }
    if (options.planes === 0) { output.push(frame); continue; }
    const source = frame.native;
    const native = source?.rgba === frame.data && source.width === frame.width && source.height === frame.height &&
      [0, 4, 5, 8, 12, 13, 14, 29, 30, 49, 62, 68].includes(source.format) ? source : undefined;
    const gray = native ? [8, 29, 30].includes(native.format) : pixelFormat === "gray" || pixelFormat === "gray8";
    if (!native && !gray) throw new Error("avgblur: requires grayscale or retained planar YUV input");
    const sampleBytes = native && [29, 30, 49, 62, 68].includes(native.format) ? 2 : 1;
    const littleEndian = native?.format !== 29;
    const hsub = native && [0, 4, 12, 13, 62].includes(native.format) ? 2 : 1;
    const vsub = native && [0, 12, 62].includes(native.format) ? 2 : 1;
    const chromaWidth = Math.ceil(frame.width / hsub);
    const chromaHeight = Math.ceil(frame.height / vsub);
    // FFmpeg clamps both radii to half the chroma dimensions, even for luma.
    const rx = Math.min(options.sizeX, Math.floor(chromaWidth / 2));
    const ry = Math.min(options.sizeY || options.sizeX, Math.floor(chromaHeight / 2));
    const area = (2 * rx + 1) * (2 * ry + 1);
    const input = native?.pixels ?? frame.data;
    budget.allocateMemory(input.length + (native ? frame.data.length : 0) + frame.width * 8);
    const pixels = new Uint8Array(input.length);
    const columns = new Float64Array(frame.width);
    try {
      for (let offset = 0; offset < input.length; offset += 65536) {
        await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
        pixels.set(input.subarray(offset, offset + 65536), offset);
      }
      const inputView = new DataView(input.buffer, input.byteOffset, input.byteLength);
      const outputView = new DataView(pixels.buffer);
      let offset = 0;
      for (let plane = 0; plane < (gray ? 1 : 3); plane++) {
        const width = plane > 0 ? chromaWidth : frame.width;
        const height = plane > 0 ? chromaHeight : frame.height;
        const start = offset;
        const stride = native ? sampleBytes : 4;
        offset += width * height * sampleBytes;
        if (!(options.planes & (1 << plane))) continue;
        const read = (x: number, y: number) => {
          const index = start + (y * width + x) * stride;
          return sampleBytes === 2 ? inputView.getUint16(index, littleEndian) : input[index]!;
        };
        for (let x = 0; x < width; x++) {
          let sum = read(x, 0) * ry;
          for (let y = 0; y <= ry; y++) {
            if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            sum += read(x, y);
          }
          columns[x] = sum;
        }
        for (let y = 0; y < height; y++) {
          let sum = columns[0]! * rx;
          for (let x = 0; x <= rx; x++) sum += columns[x]!;
          for (let x = 0; x < width; x++) {
            if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            if (x > 0) sum += columns[Math.min(width - 1, x + rx)]! - columns[Math.max(0, x - rx - 1)]!;
            const index = start + (y * width + x) * stride;
            const value = Math.floor(sum / area);
            if (sampleBytes === 2) outputView.setUint16(index, value, littleEndian);
            else {
              pixels[index] = value;
              if (!native) pixels[index + 1] = pixels[index + 2] = value;
            }
          }
          if (y + 1 < height) {
            for (let x = 0; x < width; x++) {
              if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
              columns[x]! += read(x, Math.min(height - 1, y + ry + 1)) - read(x, Math.max(0, y - ry));
            }
          }
        }
      }
      if (native) {
        const blurred = { ...native, pixels };
        const data = scaleVideoPicture({ ...frame, native: blurred }, frame.width, frame.height)!;
        output.push({ ...frame, data, native: { ...blurred, rgba: data } });
      } else {
        const blurred = { ...frame, data: pixels };
        delete blurred.native;
        output.push(blurred);
      }
    } finally {
      budget.releaseMemory(columns.byteLength);
    }
  }
  return output;
}
