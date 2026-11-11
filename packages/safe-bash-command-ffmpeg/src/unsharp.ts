import type { MediaBudgetTracker, MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function unsharp(
  frames: MediaVideoFrame[], argument: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const options = { lx: 5, ly: 5, la: 1 };
  let enable: string | undefined;
  let position = 0;
  if (argument.endsWith(":")) argument = argument.slice(0, -1);
  for (const option of argument ? argument.split(":") : []) {
    const separator = option.indexOf("=");
    let key = separator < 0 ? ["lx", "ly", "la"][position++] : option.slice(0, separator).trim();
    if (separator >= 0) position = position === 0 ? 1 : 0;
    const text = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "enable") { enable = text; continue; }
    if (key === "luma_msize_x") key = "lx";
    if (key === "luma_msize_y") key = "ly";
    if (key === "luma_amount") key = "la";
    if (key !== "lx" && key !== "ly" && key !== "la") throw new Error(`unsharp: unsupported option ${key}`);
    const min = key === "la" ? -2 : 3;
    const max = key === "la" ? 5 : 23;
    const value = parseFilterExpression(text, "unsharp", {
      min, max, default: key === "la" ? 1 : 5, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    });
    if (!text || !Number.isFinite(value) || value < min || value > max) throw new RangeError(`unsharp: invalid ${key}`);
    const lower = Math.floor(value);
    options[key] = key === "la" ? Math.fround(value) : value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
  }
  const { lx, ly } = options;
  if (lx % 2 !== 1 || ly % 2 !== 1 || lx + ly - 2 > 25) {
    throw new RangeError("unsharp: matrix sizes must be odd and their combined scale must not exceed 25 bits");
  }
  // Unsharp uses a separable binomial blur, rounded only after both passes.
  const kernels = [lx, ly].map(size => {
    const weights = [1];
    for (let i = 1; i < size; i++) weights.push(weights[i - 1]! * (size - i) / i);
    return weights;
  });
  const scale = 2 ** (lx + ly - 2);
  const amount = Math.trunc(options.la * 65536);
  const registers = new Float64Array(10);
  const output: MediaVideoFrame[] = [];
  let work = 0;
  for (const [n, frame] of frames.entries()) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    const native = frame.native?.rgba === frame.data && frame.native.width === frame.width &&
      frame.native.height === frame.height ? frame.native : undefined;
    if (native ? native.format !== 8 : pixelFormat !== "gray" && pixelFormat !== "gray8") {
      throw new Error("unsharp: only 8-bit grayscale input is supported");
    }
    if (enable !== undefined) {
      const variables = { n, t: frame.ptsSeconds, w: frame.width, h: frame.height, pos: frame.offset ?? NaN,
        NAN: NaN, INF: Infinity, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 };
      // FFmpeg's generic timeline evaluates the predicate twice per frame.
      parseFilterExpression(enable, "unsharp enable", variables, undefined, registers);
      if (!(Math.abs(parseFilterExpression(enable, "unsharp enable", variables, undefined, registers)) >= 0.5)) {
        output.push(frame);
        continue;
      }
    }
    if (amount === 0) { output.push(frame); continue; }
    const { width, height } = frame;
    const size = width * height;
    budget.allocateMemory(size * 5 + size * Float64Array.BYTES_PER_ELEMENT);
    const horizontal = new Float64Array(size);
    const pixels = new Uint8Array(size);
    const data = new Uint8Array(size * 4);
    const source = native?.pixels ?? frame.data;
    const stride = native ? 1 : 4;
    try {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let sum = 0;
          for (let k = 0; k < lx; k++) {
            if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            const column = Math.max(0, Math.min(width - 1, x + k - (lx - 1) / 2));
            sum += source[(y * width + column) * stride]! * kernels[0]![k]!;
          }
          horizontal[y * width + x] = sum;
        }
      }
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let sum = 0;
          for (let k = 0; k < ly; k++) {
            if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            const row = Math.max(0, Math.min(height - 1, y + k - (ly - 1) / 2));
            sum += horizontal[row * width + x]! * kernels[1]![k]!;
          }
          const i = y * width + x;
          const original = source[i * stride]!;
          const blurred = Math.floor((sum + scale / 2) / scale);
          const value = Math.max(0, Math.min(255, original + Math.floor((original - blurred) * amount / 65536)));
          pixels[i] = value;
          data.fill(value, i * 4, i * 4 + 3);
          data[i * 4 + 3] = frame.data[i * 4 + 3]!;
        }
      }
      output.push({ ...frame, data, native: { ...native, pixels, rgba: data, width, height, format: 8, fullRange: 1, colorspace: native?.colorspace ?? 5 } });
    } finally {
      budget.releaseMemory(horizontal.byteLength);
    }
  }
  return output;
}
