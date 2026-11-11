import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function exciteAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number }[],
  budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { sample: number; action: string; expression: string }[] = []
): Promise<Float64Array[]> {
  const options = { level_in: 1, level_out: 1, amount: 1, drive: 8.5, blend: 0, freq: 7500, ceil: 9999, listen: 0 };
  const ranges = { level_in: [0, 64], level_out: [0, 64], amount: [0, 64], drive: [0.1, 10], blend: [-10, 10], freq: [2000, 12000], ceil: [9999, 20000], listen: [0, 1] };
  const names = Object.keys(options) as (keyof typeof options)[];
  const setOption = (key: keyof typeof options, value: string) => {
    const number = key !== "listen" ? parseFilterExpression(value, "aexciter", {})
      : ["true", "yes", "on"].includes(value.toLowerCase()) ? 1
      : key === "listen" && ["false", "no", "off"].includes(value.toLowerCase()) ? 0 : Number(value);
    const [min, max] = ranges[key];
    if (!value || !Number.isFinite(number) || key === "listen" && !Number.isInteger(number)) {
      throw new Error(`aexciter: invalid ${key}`);
    }
    if (number < min! || number > max!) throw new RangeError(`aexciter: invalid ${key}`);
    options[key] = number;
  };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[index] : option.slice(0, separator).trim() as keyof typeof options | "threads" | "extra_hw_frames";
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "threads" || key === "extra_hw_frames") {
      const min = key === "threads" ? 0 : -1;
      const number = parseFilterExpression(value, "aexciter", { min, max: 2147483647, default: min });
      if (!Number.isFinite(number) || number < min || number > 2147483647) {
        throw new RangeError(`aexciter: invalid ${key}`);
      }
      // Scheduling and hardware frame reservations do not change PCM samples.
      continue;
    }
    if (!key || !Object.hasOwn(options, key)) throw new Error(`aexciter: unsupported option ${key}`);
    setOption(key, value);
  }
  budget.allocateMemory(channels.reduce((sum, channel) => sum + channel.length * 8 + 14 * 8, 0));
  const output = channels.map(channel => new Float64Array(channel.length));
  const history = channels.map(() => new Float64Array(14));
  let work = 0;
  let nextCommand = 0;
  for (const frame of frames) {
    while (nextCommand < commands.length && commands[nextCommand]!.sample <= frame.start) {
      const command = commands[nextCommand++]!;
      const key = command.action as keyof typeof options;
      if (!Object.hasOwn(options, key)) continue;
      try {
        setOption(key, command.expression);
      } catch { /* Native asendcmd continues after a rejected command. */ }
    }
    // Native exciter transfer curve, with its near-zero suppression and DC blocker.
    const root = (value: number) => Math.abs(value) > 1e-8 ? Math.sqrt(Math.abs(value)) : 0;
    const drive = 12 / options.drive;
    const bias = drive / (10.5 - options.blend) * 780 / 33;
    const kpa = root(2 * drive * drive - 1) + 1;
    const kpb = (2 - kpa) / 2;
    const ap = (drive * drive - kpa + 1) / 2;
    const kc = kpa / root(2 * root(2 * drive * drive - 1) - 2 * drive * drive);
    const sq = kc * kc + 1;
    const knb = -bias / root(sq);
    const kna = 2 * kc * bias / root(sq);
    const an = bias * bias / sq;
    const power = 2 / (2 * knb + root(2 * kna + 4 * an - 1) + 1);
    const dc = (0.1 * sampleRate) / (0.1 * sampleRate + 1);
    const coefficients = (frequency: number, highpass: boolean) => {
      const angle = 2 * Math.PI * frequency / sampleRate;
      const cosine = Math.cos(angle);
      const alpha = Math.sin(angle) / (2 * 0.707);
      const a0 = 1 + alpha;
      const b = highpass ? 1 + cosine : 1 - cosine;
      return [2 * cosine / a0, -(1 - alpha) / a0, b / 2 / a0, (highpass ? -b : b) / a0, b / 2 / a0];
    };
    const hp = coefficients(options.freq, true);
    const lp = coefficients(options.ceil, false);
    for (const [c, channel] of channels.entries()) {
      const samples = output[c]!;
      const state = history[c]!;
      let previousMedium = state[12]!;
      let previousOutput = state[13]!;
      const process = (input: number, coefficients: number[], stage: number) => {
        const offset = stage * 2;
        const value = coefficients[2]! * input + state[offset]!;
        state[offset] = coefficients[3]! * input + state[offset + 1]! + coefficients[0]! * value;
        state[offset + 1] = coefficients[4]! * input + coefficients[1]! * value;
        return value;
      };
      for (let i = frame.start; i < frame.end; i++) {
        if (++work % 1024 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        const input = channel[i]!;
        let value = process(process(input * options.level_in, hp, 0), hp, 1);
        const medium = value >= 0 ? (root(ap + value * (kpa - value)) + kpb) * power
          : (root(an - value * (kna + value)) + knb) * power * -1;
        value = dc * (medium - previousMedium + previousOutput);
        previousMedium = Math.abs(medium) > 1e-8 ? medium : 0;
        previousOutput = Math.abs(value) > 1e-8 ? value : 0;
        value = process(process(value, hp, 2), hp, 3);
        if (options.ceil >= 10000) value = process(process(value, lp, 4), lp, 5);
        samples[i] = (value * options.amount + (1 - options.listen) * input) * options.level_out;
      }
      state[12] = previousMedium;
      state[13] = previousOutput;
    }
  }
  return output;
}
