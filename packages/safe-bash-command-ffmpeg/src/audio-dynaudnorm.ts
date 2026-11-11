import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function normalizeAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string, budget: MediaBudgetTracker,
  signal: AbortSignal | undefined, warn: (message: string) => Promise<void>,
  frames?: readonly { start: number; end: number; pts: number; pos?: number | undefined }[], startSample = 0
): Promise<{ channels: Float64Array[]; frameSize: number }> {
  let enable: string | undefined;
  const variables = { n: 0, t: 0, pos: NaN, w: 0, h: 0, E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2 };
  let milliseconds = 500;
  let size = 31;
  let peak = 0.95;
  let maxGain = 10;
  let targetRms = 0;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  let positional = 0;
  for (const option of argument ? argument.split(":") : []) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["f", "g", "p", "m", "r"][positional++] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "enable") {
      enable = value;
      parseFilterExpression(enable, "dynaudnorm enable", variables, undefined, new Float64Array(10), []);
      continue;
    }
    const number = parseFilterExpression(value, "dynaudnorm", {});
    // AVOption integers round to nearest, with halfway values going to even.
    const rounded = number % 1 === 0.5 ? 2 * Math.round(number / 2) : Math.round(number);
    if (key === "f" || key === "framelen") {
      if (number < 10 || number > 8000) throw new Error("dynaudnorm: invalid framelen");
      milliseconds = rounded;
    } else if (key === "g" || key === "gausssize") {
      if (number < 3 || number > 301) throw new Error("dynaudnorm: invalid gausssize");
      size = rounded;
    } else if (key === "p" || key === "peak") {
      if (number < 0 || number > 1) throw new Error("dynaudnorm: invalid peak");
      peak = number;
    } else if (key === "m" || key === "maxgain") {
      if (number < 1 || number > 100) throw new Error("dynaudnorm: invalid maxgain");
      maxGain = number;
    } else if (key === "r" || key === "targetrms") {
      if (number < 0 || number > 1) throw new Error("dynaudnorm: invalid targetrms");
      targetRms = number;
    } else throw new Error(`dynaudnorm: unsupported option ${key}`);
  }
  if (size % 2 === 0) {
    await warn(`filter size ${size} is invalid. Changing to an odd value.\n`);
    size++;
  }
  // FFmpeg uses even-sized frames and a minimum filter followed by a Gaussian.
  const requested = sampleRate * milliseconds / 1000;
  const rounded = requested % 1 === 0.5 ? 2 * Math.round(requested / 2) : Math.round(requested);
  const frameSize = Math.max(2, rounded + rounded % 2);
  const half = Math.floor(size / 2);
  const length = channels[0]?.length ?? 0;
  budget.allocateMemory(length * channels.length * 8 + size * 4 * 8);
  const output = channels.map(() => new Float64Array(length));
  // Preserve FFmpeg's coefficient evaluation order for double-precision frames.
  const sigma = ((size / 2 - 1) / 3) + 1 / 3;
  const scale = 1 / (sigma * Math.sqrt(2 * Math.PI));
  const variance = 2 * sigma * sigma;
  const weights = Array.from({ length: size }, (_, i) => scale * Math.exp(-(i - half) * (i - half) / variance));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const adjust = 1 / total;
  for (let i = 0; i < size; i++) weights[i]! *= adjust;
  // Smoothly cap the gain with maxGain * erf(sqrt(pi) / 2 * gain / maxGain).
  const bound = (gain: number) => {
    if (gain === 0) return 0;
    const x = Math.sqrt(Math.PI) / 2 * (gain / maxGain);
    // erf(6) rounds to 1 in double precision. Below that, use the positive
    // series 2/sqrt(pi) * exp(-x*x) * (x + 2*x^3/3 + 4*x^5/15 + ...).
    // Avoid cancellation and preserve gains at PCM rounding boundaries.
    if (x >= 6) return maxGain;
    let term = x;
    let sum = x;
    for (let n = 1; n < 128; n++) {
      term *= 2 * x * x / (2 * n + 1);
      const next = sum + term;
      if (next === sum) break;
      sum = next;
    }
    return maxGain * (2 / Math.sqrt(Math.PI) * Math.exp(-x * x) * sum);
  };
  const original: number[] = [];
  const minimum: number[] = [];
  const smoothed: number[] = [];
  let previous = 1;
  const append = (gain: number) => {
    if (!original.length) {
      previous = Math.min(1, gain);
      for (let i = 0; i < half; i++) original.push(previous);
    }
    original.push(gain);
    if (original.length === size) {
      if (!minimum.length) {
        let initial = 1;
        for (let i = 0; i < half; i++) {
          initial = Math.min(initial, original[half + i + 1]!);
          minimum.push(initial);
        }
      }
      minimum.push(Math.min(...original));
      original.shift();
    }
    if (minimum.length === size) {
      smoothed.push(Math.min(original[0]!, minimum.reduce((sum, value, i) => sum + value * weights[i]!, 0)));
      minimum.shift();
    }
  };
  let written = 0;
  let work = 0;
  const registers = new Float64Array(10);
  const randomStates: BigUint64Array[] = [];
  let frameIndex = 0;
  const amplify = async () => {
    const gain = smoothed.shift()!;
    const end = Math.min(length, written + frameSize);
    const start = written;
    let enabled = true;
    if (enable !== undefined) {
      while (frames && frameIndex + 1 < frames.length && frames[frameIndex]!.end <= start) frameIndex++;
      const frame = frames?.[frameIndex];
      variables.n = start / frameSize;
      variables.t = (frame ? frame.pts + start - frame.start : startSample + start) / sampleRate;
      variables.pos = frame?.pos !== undefined && frame.pos >= 0 ? frame.pos : NaN;
      // The native activate path evaluates once per consumed normalization frame.
      enabled = Math.abs(parseFilterExpression(enable, "dynaudnorm enable", variables, undefined, registers, randomStates)) >= 0.5;
    }
    for (; written < end; written++) {
      const fraction = (written - start + 1) / (end - start);
      const factor = previous * (1 - fraction) + gain * fraction;
      for (let c = 0; c < channels.length; c++) {
        if (++work % 4096 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        output[c]![written] = channels[c]![written]! * (enabled ? factor : 1);
      }
    }
    previous = gain;
  };
  for (let start = 0; start < length; start += frameSize) {
    if (smoothed.length) await amplify();
    let magnitude = Number.EPSILON;
    let squares = 0;
    const end = Math.min(length, start + frameSize);
    for (const channel of channels) {
      for (let i = start; i < end; i++) {
        if (++work % 4096 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        magnitude = Math.max(magnitude, Math.abs(channel[i]!));
        if (targetRms > Number.EPSILON) squares += channel[i]! * channel[i]!;
      }
    }
    const rmsGain = targetRms > Number.EPSILON
      ? targetRms / Math.max(Number.EPSILON, Math.sqrt(squares / ((end - start) * channels.length)))
      : Infinity;
    append(bound(Math.min(peak / magnitude, rmsGain)));
  }
  // At EOF FFmpeg extends the pending gain history, then feeds peak-level
  // padding frames while draining audio. Padding never appears in the output.
  while (written < length) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    budget.checkCpu();
    while (!smoothed.length) append(original[0]!);
    await amplify();
    append(bound(peak / Math.max(Number.EPSILON, peak)));
  }
  return { channels: output, frameSize };
}
