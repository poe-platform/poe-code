import { scaleVideoPicture, type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

function coefficients(sigma: number, steps: number) {
  const lambda = Math.fround(sigma * sigma) / (2 * steps);
  const nu = (1 + 2 * lambda - Math.sqrt(1 + 4 * lambda)) / (2 * lambda);
  // Zero sigma produces indeterminate coefficients; native uses the identity.
  const normal = (value: number, fallback: number) => Number.isFinite(value) && Math.abs(value) >= 2 ** -126 ? value : fallback;
  return {
    nu: normal(Math.fround(nu), 0),
    boundary: normal(Math.fround(1 / (1 - nu)), 1),
    scale: normal(Math.fround((nu / lambda) ** steps), 1)
  };
}

export async function gblur(
  frames: MediaVideoFrame[], argument: string, pixelFormat: string | undefined, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const options = { sigma: 0.5, steps: 1, planes: 15, sigmaV: -1 };
  let enable: string | undefined;
  let position = 0;
  if (argument.endsWith(":")) argument = argument.slice(0, -1);
  for (const option of argument ? argument.split(":") : []) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["sigma", "steps", "planes", "sigmaV"][position++] : option.slice(0, separator).trim();
    if (separator >= 0) position = position === 0 ? 1 : 0;
    const text = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "enable") { enable = text; continue; }
    if (key !== "sigma" && key !== "steps" && key !== "planes" && key !== "sigmaV") {
      throw new Error(`gblur: unsupported option ${key}`);
    }
    const min = key === "steps" ? 1 : key === "sigmaV" ? -1 : 0;
    const max = key === "steps" ? 6 : key === "planes" ? 15 : 1024;
    const value = parseFilterExpression(text, "gblur", {
      min, max, default: key === "sigma" ? 0.5 : key === "steps" ? 1 : key === "planes" ? 15 : -1, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    });
    if (!text || !Number.isFinite(value) || value < min || value > max) throw new RangeError(`gblur: ${key} must be from ${min} to ${max}`);
    const lower = Math.floor(value);
    options[key] = key === "steps" || key === "planes"
      ? (value - lower === 0.5 ? lower + lower % 2 : Math.round(value)) : Math.fround(value);
  }
  const { sigma, steps, planes } = options;
  const horizontal = coefficients(sigma, steps);
  const vertical = coefficients(options.sigmaV < 0 ? sigma : options.sigmaV, steps);
  const scale = Math.fround(horizontal.scale * vertical.scale);
  const output: MediaVideoFrame[] = [];
  const registers = new Float64Array(10);
  let work = 0;
  for (const [n, frame] of frames.entries()) {
    signal?.throwIfAborted();
    budget.checkCpu();
    const enabled = enable === undefined || Math.abs(parseFilterExpression(enable, "gblur enable", {
      n, t: frame.ptsSeconds, w: frame.width, h: frame.height, pos: frame.offset ?? NaN,
      NAN: NaN, INF: Infinity, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    }, undefined, registers)) >= 0.5;
    const packedAlpha = pixelFormat === "rgba" || pixelFormat === "bgra";
    if (!enabled && !packedAlpha) {
      output.push(frame);
      continue;
    }
    const native = frame.native?.rgba === frame.data && frame.native.width === frame.width &&
      frame.native.height === frame.height ? frame.native : undefined;
    if (native && ![0, 4, 5, 8, 12, 13, 14, 29, 30, 49, 62, 68].includes(native.format)) {
      throw new Error("gblur: unsupported native pixel format");
    }
    const gray = native && [8, 29, 30].includes(native.format);
    const depth = native && [29, 30, 49].includes(native.format) ? 16 : native && [62, 68].includes(native.format) ? 10 : 8;
    const sampleBytes = depth > 8 ? 2 : 1;
    const hsub = native && [0, 4, 12, 13, 62].includes(native.format) ? 2 : 1;
    const vsub = native && [0, 12, 62].includes(native.format) ? 2 : 1;
    const source = native?.pixels ?? frame.data;
    budget.allocateMemory(source.length + (native ? frame.data.length : 0));
    const pixels = new Uint8Array(source);
    if (packedAlpha) {
      // FFmpeg's packed-to-planar conversion rounds alpha through 16 bits.
      for (let i = 3; i < pixels.length; i += 4) {
        if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        pixels[i] = Math.min(255, Math.round(pixels[i]! * 257 / 256));
      }
    }
    const view = new DataView(pixels.buffer);
    const scratchBytes = frame.width * frame.height * Float32Array.BYTES_PER_ELEMENT;
    budget.allocateMemory(scratchBytes);
    const buffer = new Float32Array(frame.width * frame.height);
    let offset = 0;
    try {
      for (let plane = 0; plane < (native ? gray ? 1 : 3 : 4); plane++) {
        const width = Math.ceil(frame.width / (native && plane > 0 ? hsub : 1));
        const height = Math.ceil(frame.height / (native && plane > 0 ? vsub : 1));
        const count = width * height;
        const channel = [1, 2, 0, 3][plane]!; // Planar RGB order is G, B, R, A.
        if (enabled && (planes & (1 << plane))) {
          for (let i = 0; i < count; i++) {
            if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            buffer[i] = native ? sampleBytes === 2 ? view.getUint16(offset + i * 2, native.format !== 29) : pixels[offset + i]! : pixels[i * 4 + channel]!;
          }
          // Separable causal/anticausal recurrences. Keep each operation in float32,
          // including the edge scaling, to match FFmpeg's recursive approximation.
          for (const axis of [0, 1]) {
            const length = axis === 0 ? width : height;
            const lines = axis === 0 ? height : width;
            const stride = axis === 0 ? 1 : width;
            const { nu, boundary } = axis === 0 ? horizontal : vertical;
            for (let line = 0; line < lines; line++) {
              const start = axis === 0 ? line * width : line;
              const end = start + (length - 1) * stride;
              for (let step = 0; step < steps; step++) {
                if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
                buffer[start] = Math.fround(buffer[start]! * boundary);
                for (let i = start + stride; i <= end; i += stride) {
                  if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
                  buffer[i] = buffer[i]! + Math.fround(nu * buffer[i - stride]!);
                }
                buffer[end] = Math.fround(buffer[end]! * boundary);
                for (let i = end - stride; i >= start; i -= stride) {
                  if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
                  buffer[i] = buffer[i]! + Math.fround(nu * buffer[i + stride]!);
                }
              }
            }
          }
          for (let i = 0; i < count; i++) {
            if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            const value = Math.max(0, Math.min(2 ** depth - 1, Math.fround(buffer[i]! * scale)));
            const lower = Math.floor(value);
            const rounded = value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
            if (!native) pixels[i * 4 + channel] = rounded;
            else if (sampleBytes === 2) view.setUint16(offset + i * 2, rounded, native.format !== 29);
            else pixels[offset + i] = rounded;
          }
        }
        offset += count * sampleBytes;
      }
    } finally {
      budget.releaseMemory(scratchBytes);
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
  }
  return output;
}
