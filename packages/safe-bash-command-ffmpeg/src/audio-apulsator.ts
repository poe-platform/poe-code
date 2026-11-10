import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function pulsateAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  if (channels.length !== 1 && channels.length !== 2) throw new Error("apulsator: stereo input required");
  let mode = "sine";
  let timing = "hz";
  const options = { hz: 2, bpm: 120, ms: 500, amount: 1, offset_l: 0, offset_r: 0.5, width: 1, level_in: 1, level_out: 1 };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const names = ["level_in", "level_out", "mode", "amount", "offset_l", "offset_r", "width", "timing", "bpm", "ms", "hz"] as const;
  const argumentsList = argument ? argument.split(":") : [];
  if (argument.endsWith(":")) argumentsList.pop();
  for (const [index, option] of argumentsList.entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[index] : option.slice(0, separator).trim() as keyof typeof options | "mode" | "timing";
    if (!key || (key !== "mode" && key !== "timing" && !Object.hasOwn(options, key))) throw new Error(`apulsator: unsupported option ${option}`);
    const value = option.slice(separator + 1).trim();
    if (key === "mode") {
      const modes = ["sine", "triangle", "square", "sawup", "sawdown"];
      mode = modes[Number(value)] ?? value;
      if (!value || !modes.includes(mode)) {
        throw new Error("apulsator: invalid mode");
      }
      continue;
    }
    if (key === "timing") {
      if (!["bpm", "ms", "hz", "0", "1", "2"].includes(value)) {
        throw new Error("apulsator: invalid timing");
      }
      timing = value;
      continue;
    }
    const number = parseFilterExpression(value, "apulsator", { PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 });
    const gain = key === "level_in" || key === "level_out";
    const min = key === "hz" ? 0.01 : gain ? 0.015625 : key === "bpm" ? 30 : key === "ms" ? 10 : 0;
    const max = key === "hz" ? 100 : gain ? 64 : key === "bpm" ? 300 : key === "ms" ? 2000 : key === "width" ? 2 : 1;
    if (number < min || number > max) {
      throw new Error(`apulsator: invalid ${key}`);
    }
    // Native integer options validate bounds before rounding ties to even.
    const rounded = Math.round(number);
    options[key] = key === "ms"
      ? number % 1 === 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded
      : number;
  }
  const frequency = timing === "bpm" || timing === "0" ? options.bpm / 60
    : timing === "ms" || timing === "1" ? 1000 / options.ms : options.hz;
  const length = channels[0]!.length;
  budget.allocateMemory(length * 2 * 8);
  const output = [new Float64Array(length), new Float64Array(length)];
  const width = Math.min(1.99, Math.max(0.01, options.width));
  let phase = 0;
  for (let frame = 0; frame < length; frame++) {
    if (frame % 1024 === 0) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      budget.checkCpu();
    }
    for (let channel = 0; channel < 2; channel++) {
      let position = Math.min(100, phase / width + (channel === 0 ? options.offset_l : options.offset_r));
      if (position > 1) position %= 1;
      let wave: number;
      switch (mode) {
        case "triangle":
          wave = position > 0.75 ? (position - 0.75) * 4 - 1
            : position > 0.25 ? -4 * position + 2 : position * 4;
          break;
        case "square": wave = position < 0.5 ? -1 : 1; break;
        case "sawup": wave = position * 2 - 1; break;
        case "sawdown": wave = 1 - position * 2; break;
        default: wave = Math.sin(position * 2 * Math.PI);
      }
      // Native mono-to-stereo mixing uses double precision and -3 dB per channel.
      const input = (channels.length === 1
        ? channels[0]![frame]! * Math.SQRT1_2 : channels[channel]![frame]!) * options.level_in;
      output[channel]![frame] = (input * (wave * options.amount * 0.5 + options.amount / 2) + input * (1 - options.amount)) * options.level_out;
    }
    // Advance incrementally, preserving native phase across audio packet boundaries.
    phase += frequency / sampleRate;
    if (phase >= 1) phase %= 1;
  }
  return output;
}
