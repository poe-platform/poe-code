import type { MediaBudgetTracker, MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function colorlevels(
  frames: MediaVideoFrame[], argument: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const keys = ["rimin", "gimin", "bimin", "aimin", "rimax", "gimax", "bimax", "aimax",
    "romin", "gomin", "bomin", "aomin", "romax", "gomax", "bomax", "aomax", "preserve"];
  const values: number[] = keys.map((_, index) => index < 16 && Math.floor(index / 4) % 2 ? 1 : 0);
  const modes = { none: 0, lum: 1, max: 2, avg: 3, sum: 4, nrm: 5, pwr: 6 };
  let enable: string | undefined;
  let position = 0;
  const parts = argument ? argument.split(":") : [];
  if (parts.at(-1) === "") parts.pop();
  for (const part of parts) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? keys[position++] : part.slice(0, separator).trim();
    const text = (separator < 0 ? part : part.slice(separator + 1)).trim();
    if (key === "enable") { enable = text; continue; }
    const index = key === undefined ? -1 : keys.indexOf(key);
    if (index < 0) throw new Error(`colorlevels: unsupported option ${key}`);
    const min = index < 8 ? -1 : 0;
    const max = index === 16 ? 6 : 1;
    const value = parseFilterExpression(text, "colorlevels", {
      min, max, default: index < 16 && Math.floor(index / 4) % 2 ? 1 : 0,
      ...(index === 16 ? modes : {})
    });
    if (!text || !Number.isFinite(value) || value < min || value > max) {
      throw new RangeError(`colorlevels: ${key} must be between ${min} and ${max}`);
    }
    values[index] = index === 16 ? roundToEven(value) : value;
  }
  if (pixelFormat !== undefined && !["rgb24", "bgr24", "rgba", "bgra"].includes(pixelFormat)) {
    throw new Error("colorlevels: requires 8-bit packed RGB or RGBA input");
  }
  const channels = pixelFormat === "rgb24" || pixelFormat === "bgr24" ? 3 : 4;
  const preserve = values[16]!;
  const output: MediaVideoFrame[] = [];
  const registers = new Float64Array(10);
  const f = Math.fround;
  for (const [n, frame] of frames.entries()) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    if (enable !== undefined) {
      const variables = { n, t: frame.ptsSeconds, w: frame.width, h: frame.height, pos: frame.offset ?? NaN, NAN: NaN, INF: Infinity };
      parseFilterExpression(enable, "colorlevels enable", variables, undefined, registers);
      if (!(Math.abs(parseFilterExpression(enable, "colorlevels enable", variables, undefined, registers)) >= 0.5)) {
        output.push(frame);
        continue;
      }
    }
    const endpoints = values.slice(0, 16).map(value => roundToEven(value * 255));
    const coefficients = new Float32Array(4);
    for (let channel = 0; channel < channels; channel++) {
      const autoMin = endpoints[channel]! < 0;
      const autoMax = endpoints[channel + 4]! < 0;
      if (autoMin || autoMax) {
        let min = 255, max = 0;
        for (let offset = 0; offset < frame.data.length; offset += 4) {
          if (offset % 65536 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const value = frame.data[offset + channel]!;
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
        if (autoMin) endpoints[channel] = min;
        if (autoMax) endpoints[channel + 4] = max;
      }
      coefficients[channel] = (endpoints[channel + 12]! - endpoints[channel + 8]!) /
        (endpoints[channel + 4]! - endpoints[channel]!);
    }
    budget.allocateMemory(frame.data.byteLength);
    const data = new Uint8Array(frame.data.length);
    const mapped = new Int32Array(4);
    for (let offset = 0; offset < data.length; offset += 4) {
      if (offset % 65536 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      for (let channel = 0; channel < channels; channel++) {
        // Native quantizes endpoints to nearest even, then truncates float32 mapping.
        mapped[channel] = f(f((frame.data[offset + channel]! - endpoints[channel]!) * coefficients[channel]!) + endpoints[channel + 8]!);
      }
      if (preserve) {
        const before = colorValue(frame.data[offset]!, frame.data[offset + 1]!, frame.data[offset + 2]!, preserve);
        const after = colorValue(mapped[0]!, mapped[1]!, mapped[2]!, preserve);
        if (after > 0) {
          const ratio = f(before / after);
          for (let channel = 0; channel < 3; channel++) mapped[channel] = f(mapped[channel]! * ratio);
        }
      }
      for (let channel = 0; channel < channels; channel++) data[offset + channel] = Math.max(0, Math.min(255, mapped[channel]!));
      if (channels === 3) data[offset + 3] = 255;
    }
    const filtered = { ...frame, data };
    delete filtered.native;
    output.push(filtered);
  }
  return output;
}

function roundToEven(value: number): number {
  const lower = Math.floor(value);
  return value - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(value);
}

function colorValue(r: number, g: number, b: number, mode: number): number {
  const f = Math.fround;
  if (mode === 1) return f(Math.max(r, g, b) + Math.min(r, g, b));
  if (mode === 2) return Math.max(r, g, b);
  if (mode === 3) return f(f(f(f(r + g) + b) + 1) / 3);
  if (mode === 4) return f(f(r + g) + b);
  r = f(r / 255); g = f(g / 255); b = f(b / 255);
  if (mode === 5) return f(Math.sqrt(f(f(f(r * r) + f(g * g)) + f(b * b))));
  return f(Math.cbrt(f(f(f(f(r * r) * r) + f(f(g * g) * g)) + f(f(b * b) * b))));
}
