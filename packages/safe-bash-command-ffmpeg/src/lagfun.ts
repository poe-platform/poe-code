import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function lagfun(
  frames: MediaVideoFrame[], argument: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  let decay = Math.fround(0.95);
  let planes = 15;
  let position = 0;
  const parts = argument ? argument.split(":") : [];
  if (parts.at(-1) === "") parts.pop();
  for (const part of parts) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? ["decay", "planes"][position++] : part.slice(0, separator).trim();
    if (separator >= 0) position = position === 0 ? 1 : 0;
    if (key !== "decay" && key !== "planes") throw new Error(`lagfun: unsupported option ${key ?? part}`);
    const value = parseFilterExpression(separator < 0 ? part : part.slice(separator + 1), "lagfun", {
      min: 0, max: key === "decay" ? 1 : 15, default: key === "decay" ? 0.95 : 15
    });
    if (!Number.isFinite(value) || value < 0 || value > (key === "decay" ? 1 : 15) ||
        key === "planes" && !Number.isInteger(value)) {
      throw new RangeError(`lagfun: invalid ${key}`);
    }
    if (key === "decay") decay = Math.fround(value);
    else planes = value;
  }

  const output: MediaVideoFrame[] = [];
  let history: Float32Array | undefined;
  let work = 0;
  for (const frame of frames) {
    signal?.throwIfAborted();
    budget.checkCpu();
    const retained = frame.native;
    const native = retained?.rgba === frame.data && retained.width === frame.width &&
      retained.height === frame.height ? retained : undefined;
    if (native ? native.format !== 8 : pixelFormat !== "gray" && pixelFormat !== "gray8") {
      throw new Error("lagfun: only 8-bit grayscale input is supported");
    }
    if (!(planes & 1)) {
      output.push(frame);
      continue;
    }
    if (output.length && (frame.width !== output[0]!.width || frame.height !== output[0]!.height)) {
      throw new Error("lagfun: frames must have matching dimensions");
    }
    const length = frame.width * frame.height;
    if (!history) {
      budget.allocateMemory(length * 4);
      history = new Float32Array(length);
    }
    budget.allocateMemory(length * 5);
    const pixels = new Uint8Array(length);
    for (let index = 0; index < length; index++) {
      if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      // Retain float history; FFmpeg rounds only the emitted sample, with ties to even.
      const value = Math.max(native ? native.pixels[index]! : frame.data[index * 4]!,
        Math.fround(history[index]! * decay));
      history[index] = value;
      pixels[index] = value % 1 === 0.5 ? 2 * Math.round(value / 2) : Math.round(value);
    }
    const filtered = native ? { ...native, pixels } : {
      pixels, rgba: frame.data, width: frame.width, height: frame.height, format: 8, colorspace: 5, fullRange: 1
    };
    const data = scaleVideoPicture({ ...frame, native: filtered }, frame.width, frame.height)!;
    output.push({ ...frame, data, native: { ...filtered, rgba: data } });
  }
  if (history) budget.releaseMemory(history.byteLength);
  return output;
}
