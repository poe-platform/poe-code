import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function compensateAudioDelay(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number }[],
  commands: readonly { sample: number; expression: string }[],
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const names = ["mm", "cm", "m", "dry", "wet", "temp"];
  const values = [0, 0, 0, 0, 1, 20];
  let enable: string | undefined;
  const argument = filter.slice("compensationdelay=".length);
  let optionPosition = 0;
  for (const option of argument ? argument.split(":") : []) {
    const separator = option.indexOf("=");
    const name = separator < 0 ? names[optionPosition] : option.slice(0, separator).trim();
    // Native restarts shorthand after named options, skipping the first slot
    // when it was just visited. The named key does not select the next slot.
    if (separator < 0) optionPosition++;
    else optionPosition = optionPosition === 0 ? 1 : 0;
    const raw = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (name === "enable") {
      enable = raw;
      parseFilterExpression(enable, "compensationdelay enable", { n: 0, t: 0 });
      continue;
    }
    const key = names.indexOf(name!);
    const value = parseFilterExpression(raw, "compensationdelay", {});
    if (key < 0 || value < (key === 5 ? -50 : 0) || value > [10, 100, 100, 1, 1, 50][key]!) {
      throw new Error("compensationdelay: invalid option");
    }
    values[key] = value;
    if (key < 3 || key === 5) {
      // Native integer options use nearest-even rounding after range validation.
      const lower = Math.floor(value);
      values[key] = value - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(value);
    }
  }
  // Native converts distance to whole samples using temperature-dependent sound speed.
  const speed = 1.85325 * (643.95 * Math.sqrt((values[5]! + 273.15) / 273.15)) * 100000 / 3600;
  const delay = Math.trunc((values[2]! * 100 + values[1]! + values[0]! * 0.1) * (1 / speed) * sampleRate);
  const length = channels[0]?.length ?? 0;
  budget.allocateMemory(length * channels.length * Float64Array.BYTES_PER_ELEMENT);
  const output = channels.map(() => new Float64Array(length));
  let nextCommand = 0;
  for (const [n, frame] of frames.entries()) {
    while (nextCommand < commands.length && commands[nextCommand]!.sample <= frame.start) {
      const gain = Number(commands[nextCommand++]!.expression);
      // Failed runtime commands leave the current option unchanged.
      if (Number.isFinite(gain) && gain >= 0 && gain <= 1) values[3] = gain;
    }
    const enabled = enable === undefined || Math.abs(parseFilterExpression(enable, "compensationdelay enable", {
      n, t: frame.pts / sampleRate
    })) >= 0.5;
    for (let i = frame.start; i < frame.end; i++) {
      if (i % 1024 === 0) { budget.checkCpu(); await yieldTurn(signal); signal?.throwIfAborted(); }
      for (const [c, channel] of channels.entries()) {
        const sample = channel[i]!;
        output[c]![i] = enabled ? values[3]! * sample + values[4]! * (i < delay ? 0 : channel[i - delay]!) : sample;
        // Native keeps consuming input history while bypassed.
      }
    }
  }
  return output;
}
