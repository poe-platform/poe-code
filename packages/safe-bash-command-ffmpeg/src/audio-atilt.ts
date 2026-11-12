import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function tiltAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  format: string, frames: readonly { start: number; end: number; pts: number }[],
  budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { sample: number; action: string; expression: string }[] = []
): Promise<Float64Array[]> {
  let enable: string | undefined;
  const options = { freq: 10000, slope: 0, width: 1000, order: 5, level: 1 };
  const ranges = { freq: [20, 192000], slope: [-1, 1], width: [100, 10000], order: [2, 30], level: [0, 4] };
  const names = Object.keys(options) as (keyof typeof options)[];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const parts = argument ? argument.split(":") : [];
  if (argument.endsWith(":")) parts.pop();
  let positionalIndex = 0;
  for (const option of parts) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[positionalIndex++] : option.slice(0, separator).trim() as keyof typeof options | "enable";
    if (key === "enable") {
      enable = option.slice(separator + 1).trim();
      parseFilterExpression(enable, "atilt enable", { n: 0, t: 0 });
      continue;
    }
    if (!key || !Object.hasOwn(options, key)) throw new Error(`atilt: unsupported option ${key}`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const number = parseFilterExpression(value, "atilt", {});
    const [min, max] = ranges[key];
    if (!value || !Number.isFinite(number) || number < min! || number > max!) {
      throw new RangeError(`atilt: invalid ${key}`);
    }
    options[key] = number;
    if (key === "order") {
      options.order = number % 1 === 0.5 ? 2 * Math.round(number / 2) : Math.round(number);
    }
  }

  budget.allocateMemory(channels.reduce((sum, channel) => sum + channel.length * 8, 0));
  const round = format === "dblp" ? (value: number) => value : Math.fround;
  const output = channels.map(channel => new Float64Array(channel.length));
  // Native atilt retains all stage histories when order shrinks and grows.
  budget.allocateMemory(channels.length * 30 * 2 * 8 + 30 * 4 * 8);
  const history = channels.map(() => new Float64Array(30 * 2));
  const coefficients = new Float64Array(30 * 4);
  const updateCoefficients = () => {
    // Geometrically spaced pole/zero pairs, prewarped about freq and
    // bilinearly transformed. Each first-order stage has unity DC gain.
    const ratio = ((options.freq + options.width) / options.freq) ** (1 / (options.order - 1));
    const angular = 2 * Math.PI * options.freq;
    const warp = angular / Math.tan(angular / (2 * sampleRate));
    const transform = 1 / Math.tan(0.5 / sampleRate);
    for (let stage = 0; stage < options.order; stage++) {
      const pole = warp * Math.tan(angular * ratio ** stage / (2 * sampleRate));
      const zero = warp * Math.tan(angular * ratio ** (stage - options.slope) / (2 * sampleRate));
      const denominator = pole + transform;
      coefficients[stage * 4] = (zero + transform) / denominator;
      coefficients[stage * 4 + 1] = (zero - transform) / denominator;
      coefficients[stage * 4 + 2] = (pole - transform) / denominator;
      coefficients[stage * 4 + 3] = pole / zero;
    }
  };
  updateCoefficients();
  let work = 0;
  let nextCommand = 0;
  for (const [n, frame] of frames.entries()) {
    while (nextCommand < commands.length && commands[nextCommand]!.sample <= frame.start) {
      const command = commands[nextCommand++]!;
      const key = command.action as keyof typeof options;
      if (!Object.hasOwn(options, key)) continue;
      try {
        const value = parseFilterExpression(command.expression, "atilt", {});
        const [min, max] = ranges[key];
        if (!Number.isFinite(value) || value < min! || value > max!) continue;
        options[key] = key === "order"
          ? value % 1 === 0.5 ? 2 * Math.round(value / 2) : Math.round(value)
          : value;
        updateCoefficients();
      } catch { /* Native asendcmd continues after a rejected command. */ }
    }
    const enabled = enable === undefined || Math.abs(parseFilterExpression(enable, "atilt enable", {
      n, t: frame.pts / sampleRate
    })) >= 0.5;
    const level = round(options.level);
    for (let stage = 0; stage < (enabled ? options.order : 1); stage++) {
      const feed = round(coefficients[stage * 4]!);
      const previousFeed = round(coefficients[stage * 4 + 1]!);
      const feedback = round(coefficients[stage * 4 + 2]!);
      const gain = round(coefficients[stage * 4 + 3]!);
      for (const [c, channel] of channels.entries()) {
        const state = history[c]!;
        let previousInput = state[stage * 2]!;
        let previousOutput = state[stage * 2 + 1]!;
        const samples = output[c]!;
        for (let i = frame.start; i < frame.end; i++) {
          if (work++ % 4096 === 0) {
            await yieldTurn(signal);
            signal?.throwIfAborted();
            budget.checkCpu();
          }
          // Generic timeline bypass freezes each stage's history.
          if (!enabled) {
            samples[i] = round(channel[i]!);
            continue;
          }
          const input = stage === 0 ? round(round(channel[i]!) * level) : samples[i]!;
          const value = round(round(round(input * feed) + round(previousInput * previousFeed)) - round(previousOutput * feedback));
          previousInput = input;
          previousOutput = value;
          samples[i] = round(value * gain);
        }
        state[stage * 2] = previousInput;
        state[stage * 2 + 1] = previousOutput;
      }
    }
  }
  return output;
}
