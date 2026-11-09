import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function cutUltrasonicAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<readonly (Float32Array | Float64Array)[]> {
  const options = { cutoff: 20000, order: 10, level: 1 };
  const ranges = { cutoff: [20000, 192000], order: [3, 20], level: [0, 1] };
  const names = Object.keys(options) as (keyof typeof options)[];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[index] : option.slice(0, separator).trim() as keyof typeof options;
    if (!key || !Object.hasOwn(options, key)) throw new Error(`asupercut: unsupported option ${key}`);
    let value = parseFilterExpression(separator < 0 ? option : option.slice(separator + 1), "asupercut", {});
    const [min, max] = ranges[key];
    if (value < min! || value > max!) throw new Error(`asupercut: invalid ${key}`);
    if (key === "order") {
      const lower = Math.floor(value);
      value = value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
    }
    options[key] = value;
  }
  signal?.throwIfAborted();
  budget.checkCpu();
  // Native bypass also skips the input gain.
  if (options.cutoff >= sampleRate / 2) return channels;

  const stages = Math.ceil(options.order / 2);
  budget.allocateMemory(stages * 5 * 8 + channels.reduce((sum, channel) => sum + channel.length * 8, 0));
  const coefficients = new Float64Array(stages * 5);
  const k = Math.tan(Math.PI * options.cutoff / sampleRate);
  const odd = options.order % 2;
  if (odd) {
    const gain = k / (1 + k);
    coefficients.set([gain, gain, 0, (1 - k) / (1 + k), 0]);
  }
  // Bilinear transform of the Butterworth poles, ordered by descending Q.
  for (let stage = odd; stage < stages; stage++) {
    const q = -1 / (2 * Math.cos(Math.PI * (2 * (stage - odd + 1) + options.order - 1) / (2 * options.order)));
    const norm = 1 / (1 + k / q + k * k);
    const gain = k * k * norm;
    coefficients.set([gain, 2 * gain, gain, 2 * (1 - k * k) * norm, -(1 - k / q + k * k) * norm], stage * 5);
  }
  const output: Float64Array[] = [];
  let work = 0;
  for (const channel of channels) {
    const samples = new Float64Array(channel.length);
    for (let stage = 0; stage < stages; stage++) {
      const offset = stage * 5;
      const b0 = coefficients[offset]!, b1 = coefficients[offset + 1]!, b2 = coefficients[offset + 2]!;
      const a1 = coefficients[offset + 3]!, a2 = coefficients[offset + 4]!;
      let w0 = 0, w1 = 0;
      for (let i = 0; i < samples.length; i++) {
        if (++work % 1024 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        const input = stage === 0 ? channel[i]! * options.level : samples[i]!;
        const value = input * b0 + w0;
        w0 = b1 * input + w1 + a1 * value;
        w1 = b2 * input + a2 * value;
        samples[i] = value;
      }
    }
    output.push(samples);
  }
  budget.releaseMemory(coefficients.byteLength);
  return output;
}
