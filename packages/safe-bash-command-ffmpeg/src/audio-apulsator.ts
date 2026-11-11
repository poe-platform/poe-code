import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";

export async function pulsateAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  if (channels.length !== 1 && channels.length !== 2) throw new Error("apulsator: stereo input required");
  let mode = "sine";
  let timing = "hz";
  const defaults = { hz: 2, bpm: 120, ms: 500, amount: 1, offset_l: 0, offset_r: 0.5, width: 1, level_in: 1, level_out: 1 };
  const options = { ...defaults };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const names = ["level_in", "level_out", "mode", "amount", "offset_l", "offset_r", "width", "timing", "bpm", "ms", "hz"] as const;
  const argumentsList = argument ? argument.split(":") : [];
  if (argument.endsWith(":")) argumentsList.pop();
  let optionPosition = 0;
  for (const option of argumentsList) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[optionPosition] : option.slice(0, separator).trim() as keyof typeof options | "mode" | "timing" | "enable" | "threads" | "thread_type" | "extra_hw_frames";
    // FFmpeg 7 restarts shorthand after named options, skipping the first slot
    // when it was just visited. The named key does not select the next slot.
    if (separator < 0) optionPosition++;
    else optionPosition = optionPosition === 0 ? 1 : 0;
    if (key === "threads" || key === "thread_type" || key === "extra_hw_frames") {
      validateWeaveGenericOption(key, option.slice(separator + 1).trim(), "apulsator");
      continue;
    }
    if (key === "enable") throw new Error("apulsator: timeline is unsupported");
    if (!key || (key !== "mode" && key !== "timing" && !Object.hasOwn(options, key))) throw new Error(`apulsator: unsupported option ${option}`);
    const value = option.slice(separator + 1).trim();
    if (key === "mode" || key === "timing") {
      const values = key === "mode" ? ["sine", "triangle", "square", "sawup", "sawdown"] : ["bpm", "ms", "hz"];
      const number = parseFilterExpression(value, "apulsator", {
        PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2,
        min: 0, max: values.length - 1, default: key === "mode" ? 0 : 2,
        ...Object.fromEntries(values.map((name, index) => [name, index]))
      });
      if (number < 0 || number > values.length - 1) throw new RangeError(`apulsator: invalid ${key}`);
      // Native integer options validate bounds before rounding ties to even.
      const rounded = Math.round(number);
      const selected = values[number % 1 === 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded]!;
      if (key === "mode") mode = selected;
      else timing = selected;
      continue;
    }
    const gain = key === "level_in" || key === "level_out";
    const min = key === "hz" ? 0.01 : gain ? 0.015625 : key === "bpm" ? 30 : key === "ms" ? 10 : 0;
    const max = key === "hz" ? 100 : gain ? 64 : key === "bpm" ? 300 : key === "ms" ? 2000 : key === "width" ? 2 : 1;
    const number = parseFilterExpression(value, "apulsator", {
      PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2, min, max, default: defaults[key]
    });
    if (number < min || number > max) {
      throw new RangeError(`apulsator: invalid ${key}`);
    }
    // Native integer options validate bounds before rounding ties to even.
    const rounded = Math.round(number);
    options[key] = key === "ms"
      ? number % 1 === 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded
      : number;
  }
  const frequency = timing === "bpm" ? options.bpm / 60
    : timing === "ms" ? 1000 / options.ms : options.hz;
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
