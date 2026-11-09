import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function normalizeAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  let milliseconds = 500;
  let size = 31;
  let peak = 0.95;
  let maxGain = 10;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["f", "g", "p", "m"][index] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const number = parseFilterExpression(value, "dynaudnorm", {});
    if (key === "f" || key === "framelen") {
      if (!Number.isInteger(number) || number < 10 || number > 8000) throw new Error("dynaudnorm: invalid framelen");
      milliseconds = number;
    } else if (key === "g" || key === "gausssize") {
      if (!Number.isInteger(number) || number < 3 || number > 301) throw new Error("dynaudnorm: invalid gausssize");
      size = number | 1;
    } else if (key === "p" || key === "peak") {
      if (number < 0 || number > 1) throw new Error("dynaudnorm: invalid peak");
      peak = number;
    } else if (key === "m" || key === "maxgain") {
      if (number < 1 || number > 100) throw new Error("dynaudnorm: invalid maxgain");
      maxGain = number;
    } else throw new Error(`dynaudnorm: unsupported option ${key}`);
  }
  // FFmpeg uses even-sized frames and a minimum filter followed by a Gaussian.
  const requested = sampleRate * milliseconds / 1000;
  const rounded = requested % 1 === 0.5 ? 2 * Math.round(requested / 2) : Math.round(requested);
  const frameSize = Math.max(2, rounded + rounded % 2);
  const half = Math.floor(size / 2);
  const length = channels[0]?.length ?? 0;
  budget.allocateMemory(length * channels.length * 8 + size * 4 * 8);
  const output = channels.map(() => new Float64Array(length));
  const weights = Array.from({ length: size }, (_, i) => Math.exp(-0.5 * ((i - half) / (size / 6)) ** 2));
  const total = weights.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < size; i++) weights[i]! /= total;
  // Smoothly cap the gain with maxGain * erf(sqrt(pi) / 2 * gain / maxGain).
  // This error-function approximation has absolute error below 1.5e-7.
  const bound = (gain: number) => {
    if (gain === 0) return 0;
    const x = Math.sqrt(Math.PI) / 2 * gain / maxGain;
    const t = 1 / (1 + 0.3275911 * x);
    return maxGain * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
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
  const amplify = async () => {
    const gain = smoothed.shift()!;
    const end = Math.min(length, written + frameSize);
    const start = written;
    for (; written < end; written++) {
      const fraction = (written - start + 1) / (end - start);
      const factor = previous * (1 - fraction) + gain * fraction;
      for (let c = 0; c < channels.length; c++) {
        if (++work % 4096 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        output[c]![written] = channels[c]![written]! * factor;
      }
    }
    previous = gain;
  };
  for (let start = 0; start < length; start += frameSize) {
    if (smoothed.length) await amplify();
    let magnitude = Number.EPSILON;
    for (const channel of channels) {
      for (let i = start; i < Math.min(length, start + frameSize); i++) {
        if (++work % 4096 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        magnitude = Math.max(magnitude, Math.abs(channel[i]!));
      }
    }
    append(bound(peak / magnitude));
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
  return output;
}
