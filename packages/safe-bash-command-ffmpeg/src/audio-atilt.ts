import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function tiltAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const options = { freq: 10000, slope: 0, width: 1000, order: 5, level: 1 };
  const ranges = { freq: [20, 192000], slope: [-1, 1], width: [100, 10000], order: [2, 30], level: [0, 4] };
  const names = Object.keys(options) as (keyof typeof options)[];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  let positionalIndex = 0;
  for (const option of argument ? argument.split(":") : []) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[positionalIndex++] : option.slice(0, separator).trim() as keyof typeof options;
    if (!key || !Object.hasOwn(options, key)) throw new Error(`atilt: unsupported option ${key}`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const number = parseFilterExpression(value, "atilt", {});
    const [min, max] = ranges[key];
    if (!value || !Number.isFinite(number) || number < min! || number > max!) {
      throw new Error(`atilt: invalid ${key}`);
    }
    options[key] = number;
    if (key === "order") {
      options.order = number % 1 === 0.5 ? 2 * Math.round(number / 2) : Math.round(number);
    }
  }

  budget.allocateMemory(channels.reduce((sum, channel) => sum + channel.length * 8, 0));
  const output = channels.map(channel => new Float64Array(channel.length));
  // Geometrically spaced pole/zero pairs, prewarped about freq and
  // bilinearly transformed. Each first-order stage has unity DC gain.
  const ratio = ((options.freq + options.width) / options.freq) ** (1 / (options.order - 1));
  const angular = 2 * Math.PI * options.freq;
  const warp = angular / Math.tan(angular / (2 * sampleRate));
  const transform = 1 / Math.tan(0.5 / sampleRate);
  let work = 0;
  for (let stage = 0; stage < options.order; stage++) {
    const pole = warp * Math.tan(angular * ratio ** stage / (2 * sampleRate));
    const zero = warp * Math.tan(angular * ratio ** (stage - options.slope) / (2 * sampleRate));
    const denominator = pole + transform;
    const feed = (zero + transform) / denominator;
    const previousFeed = (zero - transform) / denominator;
    const feedback = (pole - transform) / denominator;
    const gain = pole / zero;
    for (const [c, channel] of channels.entries()) {
      let previousInput = 0;
      let previousOutput = 0;
      const samples = output[c]!;
      for (let i = 0; i < samples.length; i++) {
        if (work++ % 4096 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        const input = stage === 0 ? channel[i]! * options.level : samples[i]!;
        const value = input * feed + previousInput * previousFeed - previousOutput * feedback;
        previousInput = input;
        previousOutput = value;
        samples[i] = value * gain;
      }
    }
  }
  return output;
}
