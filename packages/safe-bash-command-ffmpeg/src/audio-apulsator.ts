import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function pulsateAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  if (channels.length !== 2) throw new Error("apulsator: stereo input required");
  const options = { hz: 2, amount: 1, offset_l: 0, offset_r: 0.5 };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const option of argument ? argument.split(":") : []) {
    const separator = option.indexOf("=");
    const key = option.slice(0, separator).trim() as keyof typeof options;
    if (separator < 0 || !Object.hasOwn(options, key)) throw new Error(`apulsator: unsupported option ${option}`);
    const value = option.slice(separator + 1).trim();
    const number = Number(value);
    const min = key === "hz" ? 0.01 : 0;
    const max = key === "hz" ? 100 : 1;
    if (!value || !Number.isFinite(number) || number < min || number > max) {
      throw new Error(`apulsator: invalid ${key}`);
    }
    options[key] = number;
  }
  const length = channels[0]!.length;
  budget.allocateMemory(length * 2 * 8);
  const output = channels.map(() => new Float64Array(length));
  let phase = 0;
  for (let frame = 0; frame < length; frame++) {
    if (frame % 1024 === 0) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      budget.checkCpu();
    }
    for (let channel = 0; channel < 2; channel++) {
      let position = phase + (channel === 0 ? options.offset_l : options.offset_r);
      if (position > 1) position %= 1;
      const wave = Math.sin(position * 2 * Math.PI);
      const input = channels[channel]![frame]!;
      output[channel]![frame] = input * (wave * options.amount * 0.5 + options.amount / 2) + input * (1 - options.amount);
    }
    // Advance incrementally, preserving native phase across audio packet boundaries.
    phase += options.hz / sampleRate;
    if (phase >= 1) phase %= 1;
  }
  return output;
}
