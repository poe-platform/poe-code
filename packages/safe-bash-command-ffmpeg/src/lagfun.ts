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
    if (native ? ![8, 29, 30].includes(native.format) : pixelFormat !== "gray" && pixelFormat !== "gray8") {
      throw new Error("lagfun: only 8-bit or 16-bit grayscale input is supported");
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
    const sampleBytes = native && [29, 30].includes(native.format) ? 2 : 1;
    const littleEndian = native?.format === 30;
    const source = native?.pixels;
    const view = source ? new DataView(source.buffer, source.byteOffset, source.byteLength) : undefined;
    budget.allocateMemory(length * (sampleBytes + 4));
    const pixels = new Uint8Array(length * sampleBytes);
    const outputView = new DataView(pixels.buffer);
    for (let index = 0; index < length; index++) {
      if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      // Retain float history; FFmpeg rounds only the emitted sample, with ties to even.
      const sample = sampleBytes === 2 ? view!.getUint16(index * 2, littleEndian)
        : source ? source[index]! : frame.data[index * 4]!;
      const value = Math.max(sample, Math.fround(history[index]! * decay));
      history[index] = value;
      const rounded = value % 1 === 0.5 ? 2 * Math.round(value / 2) : Math.round(value);
      if (sampleBytes === 2) outputView.setUint16(index * 2, rounded, littleEndian);
      else pixels[index] = rounded;
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
