import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function compensateAudioDelay(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number }[],
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const names = ["mm", "cm", "m", "dry", "wet", "temp"];
  const values = [0, 0, 0, 0, 1, 20];
  let enable: string | undefined;
  const argument = filter.slice("compensationdelay=".length);
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const name = separator < 0 ? names[index] : option.slice(0, separator).trim();
    const raw = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (name === "enable") {
      enable = raw;
      parseFilterExpression(enable, "compensationdelay enable", { n: 0, t: 0 });
      continue;
    }
    const key = names.indexOf(name!);
    const value = Number(raw);
    if (key < 0 || !raw || !Number.isFinite(value) ||
        value < (key === 5 ? -50 : 0) || value > [10, 100, 100, 1, 1, 50][key]! ||
        ((key < 3 || key === 5) && !Number.isInteger(value))) {
      throw new Error("compensationdelay: invalid option");
    }
    values[key] = value;
  }
  // Native converts distance to whole samples using temperature-dependent sound speed.
  const speed = 1.85325 * (643.95 * Math.sqrt((values[5]! + 273.15) / 273.15)) * 100000 / 3600;
  const delay = Math.trunc((values[2]! * 100 + values[1]! + values[0]! * 0.1) * (1 / speed) * sampleRate);
  const length = channels[0]?.length ?? 0;
  budget.allocateMemory(length * channels.length * Float64Array.BYTES_PER_ELEMENT);
  const output = channels.map(() => new Float64Array(length));
  for (const [n, frame] of frames.entries()) {
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
