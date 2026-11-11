import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";

export async function phaseAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  sampleFormat: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const defaults = { in_gain: 0.4, out_gain: 0.74, delay: 3, decay: 0.4, speed: 0.5, type: 1 };
  const options = { ...defaults };
  const ranges = { in_gain: [0, 1], out_gain: [0, 1e9], delay: [0, 5], decay: [0, 0.99], speed: [0.1, 2], type: [0, 1] };
  const names = Object.keys(options) as (keyof typeof options)[];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const optionValues = argument ? argument.split(":") : [];
  if (optionValues.at(-1) === "") optionValues.pop();
  let optionPosition = 0;
  for (const option of optionValues) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[optionPosition] : option.slice(0, separator).trim() as keyof typeof options | "threads" | "thread_type" | "extra_hw_frames";
    // FFmpeg 7 restarts shorthand after named options, skipping the first slot
    // when it was just visited. The named key does not select the next slot.
    if (separator < 0) optionPosition++;
    else optionPosition = optionPosition === 0 ? 1 : 0;
    if (key === "threads" || key === "thread_type" || key === "extra_hw_frames") {
      validateWeaveGenericOption(key, option.slice(separator + 1).trim(), "aphaser");
      continue;
    }
    if (!key || !Object.hasOwn(options, key)) throw new Error(`aphaser: unsupported option ${key}`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const [min, max] = ranges[key];
    const number = parseFilterExpression(value, "aphaser", {
      PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2,
      min: min!, max: max!, default: defaults[key],
      ...(key === "type" ? { t: 1, triangular: 1, s: 0, sinusoidal: 0 } : {})
    });
    if (!value || !Number.isFinite(number) || number < min! || number > max!) {
      throw new RangeError(`aphaser: invalid ${key}`);
    }
    // Native rounds the 0..1 integer option to nearest, with ties to even.
    options[key] = key === "type" ? Number(number > 0.5) : number;
  }
  const delayLength = Math.round(options.delay * 0.001 * sampleRate);
  if (delayLength < 1) throw new Error("aphaser: delay is too small");
  const period = Math.round(sampleRate / options.speed);
  const length = channels[0]?.length ?? 0;
  budget.allocateMemory((length + delayLength) * channels.length * 8);
  const output = channels.map(() => new Float64Array(length));
  const history = channels.map(() => new Float64Array(delayLength));
  const scale = sampleFormat === "s16" || sampleFormat === "s16p" ? 32768
    : sampleFormat === "s32" || sampleFormat === "s32p" ? 2147483648 : 1;
  let position = 0;
  let work = 0;
  for (let frame = 0; frame < length; frame++) {
    // Evaluate the periodic modulation directly instead of allocating a full wave table.
    const point = (frame + Math.round(period / 4)) % period;
    const fraction = point / period;
    const wave = options.type === 0 ? (Math.sin(fraction * 2 * Math.PI) + 1) / 2
      : fraction < 0.25 ? fraction * 2 + 0.5 : fraction < 0.75 ? 1.5 - fraction * 2 : fraction * 2 - 1.5;
    const offset = Math.round(1 + wave * (delayLength - 1));
    const read = (position + offset) % delayLength;
    position = (position + 1) % delayLength;
    for (let channel = 0; channel < channels.length; channel++) {
      if (++work % 1024 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
      const value = channels[channel]![frame]! * scale * options.in_gain + history[channel]![read]! * options.decay;
      history[channel]![position] = value;
      const sample = value * options.out_gain;
      // Native integer phasers truncate and retain the sample format between filters.
      // x86 converts through int32 (INT32_MIN on overflow), then narrows s16.
      if (scale !== 1) {
        const integer = Math.trunc(sample);
        const converted = integer < -2147483648 || integer > 2147483647 ? -2147483648 : integer;
        output[channel]![frame] = (scale === 32768 ? (converted << 16) >> 16 : converted) / scale;
      } else {
        output[channel]![frame] = sampleFormat === "flt" || sampleFormat === "fltp" ? Math.fround(sample) : sample;
      }
    }
  }
  return output;
}
