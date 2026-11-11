import type { MediaVideoFrame, MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function hqdn3d(
  frames: MediaVideoFrame[], argument: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const keys = ["luma_spatial", "chroma_spatial", "luma_tmp", "chroma_tmp"] as const;
  const strengths = { luma_spatial: 0, chroma_spatial: 0, luma_tmp: 0, chroma_tmp: 0 };
  let enable: string | undefined;
  let position = 0;
  const parts = argument ? argument.split(":") : [];
  if (parts.at(-1) === "") parts.pop();
  for (const part of parts) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? keys[position++] : part.slice(0, separator).trim();
    if (separator >= 0) position = position === 0 ? 1 : 0;
    const text = (separator < 0 ? part : part.slice(separator + 1)).trim();
    if (key === "enable") { enable = text; continue; }
    if (key !== "luma_spatial" && key !== "chroma_spatial" && key !== "luma_tmp" && key !== "chroma_tmp") {
      throw new Error(`hqdn3d: unsupported option ${key}`);
    }
    const value = parseFilterExpression(text, "hqdn3d", {
      min: 0, max: Number.MAX_VALUE, default: 0, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    });
    if (!text || !Number.isFinite(value) || value < 0) throw new Error(`hqdn3d: invalid ${key}`);
    strengths[key] = value;
  }
  if (pixelFormat !== "gray" && pixelFormat !== "gray8") throw new Error("hqdn3d: requires 8-bit grayscale input");
  // Zero requests FFmpeg's derived defaults, including explicitly supplied zero.
  strengths.luma_spatial ||= 4;
  strengths.luma_tmp ||= 6 * strengths.luma_spatial / 4;
  const first = frames[0];
  if (!first) return frames;
  const { width, height } = first;
  const scratchBytes = 2 * 8192 * 2 + (width * height + width) * 2 + 10 * 8;
  budget.allocateMemory(scratchBytes);
  try {
    // Samples retain eight fractional bits between spatial and temporal passes.
    // Each table bin spans 1/16 of an 8-bit sample; use its midpoint and ties-to-even.
    const coefficients: Int16Array[] = [];
    for (const strength of [strengths.luma_spatial, strengths.luma_tmp]) {
      const table = new Int16Array(8192);
      const exponent = Math.log(0.25) / Math.log(1 - Math.min(strength, 252) / 255 - 0.00001);
      for (let i = 0; i < table.length; i++) {
        if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        const difference = ((i - 4096) * 32 + 15) / 512;
        const value = Math.pow(Math.max(0, 1 - Math.abs(difference) / 255), exponent) * 256 * difference;
        const lower = Math.floor(value);
        table[i] = value - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(value);
      }
      coefficients.push(table);
    }
    const spatial = coefficients[0]!;
    const temporal = coefficients[1]!;
    const history = new Uint16Array(width * height);
    const line = new Uint16Array(width);
    const registers = new Float64Array(10);
    const output: MediaVideoFrame[] = [];
    for (const [n, frame] of frames.entries()) {
      await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
      if (frame.width !== width || frame.height !== height) throw new Error("hqdn3d: frames must have matching dimensions");
      const enabled = enable === undefined || Math.abs(parseFilterExpression(enable, "hqdn3d enable", {
        n, t: frame.ptsSeconds, w: width, h: height, pos: frame.offset ?? NaN, NAN: NaN, INF: Infinity
      }, undefined, registers)) >= 0.5;
      // Disabled frames still advance the internal denoising history.
      budget.allocateMemory(enabled ? frame.data.byteLength : 0);
      const data = enabled ? new Uint8Array(frame.data.byteLength) : undefined;
      for (let y = 0; y < height; y++) {
        let horizontal = frame.data[y * width * 4]! * 256 + 127;
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const sample = frame.data[i * 4]! * 256 + 127;
          if (n === 0) history[i] = sample;
          if (x > 0 || y === 0) horizontal = sample + spatial[4096 + ((horizontal - sample) >> 4)]!;
          const smoothed = y === 0 ? horizontal : horizontal + spatial[4096 + ((line[x]! - horizontal) >> 4)]!;
          line[x] = smoothed;
          const value = smoothed + temporal[4096 + ((history[i]! - smoothed) >> 4)]!;
          history[i] = value;
          if (data) {
            data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = value >> 8;
            data[i * 4 + 3] = 255;
          }
        }
      }
      if (data) {
        const filtered = { ...frame, data };
        delete filtered.native;
        output.push(filtered);
      } else output.push(frame);
    }
    return output;
  } finally {
    budget.releaseMemory(scratchBytes);
  }
}
