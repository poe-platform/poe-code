import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { transform } from "./audio-fft.js";
import { parseFilterExpression } from "./filter-expression.js";

// Windows, normalization and overlap-add follow FFmpeg 7's window_func.h and af_afftfilt.c
// (LGPL-2.1-or-later), Copyright (c) 2016 Paul B Mahol.
export async function filterFft(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number,
  filter: string, frames: readonly { start: number; end: number; pts: number; pos?: number | undefined }[],
  budget: MediaBudgetTracker, signal?: AbortSignal
) {
  let size = 4096, overlap = 0.75, realExpression = "re", imaginaryExpression = "im";
  let windowFunction = "hann";
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const options = argument ? argument.split(":") : [];
  if (options.at(-1) === "") options.pop();
  let position = 0;
  for (const option of options) {
    const equals = option.indexOf("=");
    const key = equals < 0 ? ["real", "imag", "win_size", "win_func", "overlap"][position++] : option.slice(0, equals).trim();
    const raw = (equals < 0 ? option : option.slice(equals + 1)).trim();
    if (key === "real") realExpression = raw;
    else if (key === "imag") imaginaryExpression = raw;
    else if (key === "win_size" || key === "overlap") {
      const min = key === "win_size" ? 16 : 0, max = key === "win_size" ? 131072 : 1;
      const value = parseFilterExpression(raw, "afftfilt", { min, max, default: key === "win_size" ? 4096 : 0.75 });
      if (value < min || value > max) throw new RangeError(`afftfilt: invalid ${key}`);
      if (key === "win_size") size = value % 1 === 0.5 ? 2 * Math.round(value / 2) : Math.round(value);
      else overlap = Math.fround(value);
    } else if (key === "win_func") {
      if (raw === "rect" || raw === "0") windowFunction = "rect";
      else if (raw === "hann" || raw === "hanning" || raw === "1") windowFunction = "hann";
      else if (raw === "hamming" || raw === "2") windowFunction = "hamming";
      else if (raw === "blackman" || raw === "3") windowFunction = "blackman";
      else throw new Error(`afftfilt: unsupported option ${key}`);
    } else {
      throw new Error(`afftfilt: unsupported option ${key}`);
    }
  }
  if (overlap === 1) overlap = windowFunction === "rect" ? 0 : windowFunction === "blackman" ? Math.fround(0.661) : 0.5;
  const hop = Math.trunc(Math.fround(size * Math.fround(1 - overlap)));
  if (hop <= 0) throw new Error("afftfilt: invalid overlap");
  const length = channels[0]?.length ?? 0;
  const scratchLength = (size & (size - 1)) === 0 ? 0 : 4 * 2 ** Math.ceil(Math.log2(2 * size - 1));
  budget.allocateMemory(channels.length * length * 4 + size * 24 + scratchLength * 8
    + Math.ceil(length / hop) * 32 + channels.length * 160);
  signal?.throwIfAborted(); budget.checkCpu();
  const output = channels.map(() => new Float32Array(length));
  const window = Float32Array.from({ length: size }, (_, i) => {
    const angle = 2 * Math.PI * i / (size - 1);
    const weight = windowFunction === "rect" ? 1
      : windowFunction === "hamming" ? 0.54 - 0.46 * Math.cos(angle)
      : windowFunction === "blackman" ? 0.42659 - 0.49656 * Math.cos(angle) + 0.076849 * Math.cos(2 * angle)
      : 0.5 * (1 - Math.cos(angle));
    return Math.sqrt(Math.fround(Math.fround(weight) / size));
  });
  const real = new Float64Array(size), imaginary = new Float64Array(size);
  const scratch = new Float64Array(scratchLength), buffer = new Float32Array(size);
  const factor = Math.fround(Math.sqrt(Math.fround(1 - overlap)));
  const expressions = [realExpression, imaginaryExpression].map(expression => expression.split("|").filter(Boolean));
  const variables = { sr: sampleRate, b: 0, nb: Math.floor(size / 2), ch: 0, chs: channels.length, pts: 0, re: 0, im: 0 };
  const outputFrames: { start: number; end: number; pts: number; pos?: number | undefined }[] = [];
  for (let start = 0, index = 0; start < length; start += hop) {
    if (outputFrames.length % 1024 === 0) { await yieldTurn(signal); budget.checkCpu(); }
    while (index + 1 < frames.length && frames[index]!.end <= start) index++;
    const frame = frames[index];
    outputFrames.push({ start, end: Math.min(length, start + hop),
      pts: frame ? frame.pts + start - frame.start : start, pos: frame?.pos });
  }
  for (const [c, channel] of channels.entries()) {
    const re = expressions[0]![Math.min(c, expressions[0]!.length - 1)] ?? "1";
    const im = expressions[1]![Math.min(c, expressions[1]!.length - 1)] ?? "1";
    const realRegisters = new Float64Array(10), imaginaryRegisters = new Float64Array(10);
    variables.ch = c;
    parseFilterExpression(re, "afftfilt", variables, undefined, realRegisters);
    parseFilterExpression(im, "afftfilt", variables, undefined, imaginaryRegisters);
    realRegisters.fill(0); imaginaryRegisters.fill(0); buffer.fill(0);
    for (const frame of outputFrames) {
      await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
      imaginary.fill(0);
      for (let i = 0; i < size; i++) {
        real[i] = Math.fround(Math.fround(channel[frame.start - (size - hop) + i] ?? 0) * window[i]!);
      }
      transform(real, imaginary, false, scratch);
      variables.pts = frame.pts;
      for (let i = 0; i <= Math.floor(size / 2); i++) {
        if (i % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        variables.b = i; variables.re = Math.fround(real[i]!); variables.im = Math.fround(imaginary[i]!);
        real[i] = Math.fround(parseFilterExpression(re, "afftfilt", variables, undefined, realRegisters));
        imaginary[i] = Math.fround(parseFilterExpression(im, "afftfilt", variables, undefined, imaginaryRegisters));
      }
      for (let i = Math.floor(size / 2) + 1; i < size; i++) {
        const mirror = 2 * Math.floor(size / 2) - i;
        real[i] = real[mirror]!; imaginary[i] = -imaginary[mirror]!;
      }
      transform(real, imaginary, true, scratch);
      buffer.copyWithin(0, hop); buffer.fill(0, size - hop);
      for (let i = 0; i < size; i++) {
        buffer[i] = buffer[i]! + Math.fround(Math.fround(Math.fround(real[i]!) * window[i]!) * factor);
      }
      output[c]!.set(buffer.subarray(0, frame.end - frame.start), frame.start);
    }
  }
  return { channels: output, frames: outputFrames };
}
