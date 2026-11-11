import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";

export async function flangeAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const defaults = { delay: 0, depth: 2, regen: 0, width: 71, speed: 0.5, shape: 0, phase: 25, interp: 0 };
  const options = { ...defaults };
  const ranges = { delay: [0, 30], depth: [0, 10], regen: [-95, 95], width: [0, 100], speed: [0.1, 10], shape: [0, 1], phase: [0, 100], interp: [0, 1] } as const;
  const names = Object.keys(options) as (keyof typeof options)[];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const argumentsList = argument ? argument.split(":") : [];
  if (argumentsList.at(-1) === "") argumentsList.pop();
  let position = 0;
  for (const option of argumentsList) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[position] : option.slice(0, separator).trim() as keyof typeof options | "threads" | "thread_type" | "extra_hw_frames";
    if (separator < 0) position++;
    else position = position === 0 ? 1 : 0;
    if (key === "threads" || key === "thread_type" || key === "extra_hw_frames") {
      validateWeaveGenericOption(key, option.slice(separator + 1).trim(), "flanger");
      continue;
    }
    if (!key || !Object.hasOwn(options, key)) throw new Error(`flanger: unsupported option ${key}`);
    const value = separator < 0 ? option : option.slice(separator + 1);
    const [min, max] = ranges[key];
    const number = parseFilterExpression(value, "flanger", {
      PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2, none: 0, all: -1, min, max, default: defaults[key],
      ...(key === "shape" ? { sinusoidal: 0, s: 0, triangular: 1, t: 1 } : {}),
      ...(key === "interp" ? { linear: 0, quadratic: 1 } : {})
    }, undefined, new Float64Array(10));
    if (!Number.isFinite(number) || number < min || number > max) throw new RangeError(`flanger: invalid ${key}`);
    options[key] = key === "shape" || key === "interp" ? Number(number > 0.5) : number;
  }
  const size = Math.trunc((options.delay / 1000 + options.depth / 1000) * sampleRate + 2.5);
  const period = Math.trunc(sampleRate / options.speed);
  const base = options.delay / 1000 * sampleRate;
  const floor = Math.floor(base);
  const minimum = base - floor === 0.5 ? floor + floor % 2 : Math.round(base);
  const length = channels[0]?.length ?? 0;
  budget.allocateMemory((length + size) * channels.length * 8);
  const output = channels.map(() => new Float64Array(length));
  const history = channels.map(() => new Float64Array(size));
  const feedback = options.regen / 100;
  const dry = 1 / (1 + options.width / 100);
  const wet = options.width / 100 / (1 + options.width / 100) * (1 - Math.abs(feedback));
  let work = 0;
  for (let channel = 0; channel < channels.length; channel++) {
    const buffer = history[channel]!;
    const phase = Math.trunc(channel * period * (options.phase / 100) + 0.5);
    let last = 0;
    for (let frame = 0; frame < length; frame++) {
      if (++work % 1024 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
      // Evaluate the native float wave table at this phase without allocating it.
      const point = (frame + phase + Math.round(0.75 * period)) % period;
      const fraction = point / period;
      const wave = options.shape === 0 ? (Math.sin(fraction * 2 * Math.PI) + 1) / 2
        : fraction < 0.25 ? point * 2 / period + 0.5 : fraction < 0.75 ? 1.5 - point * 2 / period : point * 2 / period - 1.5;
      const delay = Math.fround(wave * (size - 2 - minimum) + minimum);
      const integer = Math.trunc(delay);
      const fractional = delay - integer;
      const write = size - 1 - frame % size;
      const input = channels[channel]![frame]!;
      buffer[write] = input + last * feedback;
      const first = buffer[(write + integer) % size]!;
      const second = buffer[(write + integer + 1) % size]!;
      if (options.interp === 0) {
        last = first + (second - first) * fractional;
      } else {
        const third = buffer[(write + integer + 2) % size]! - first;
        const delta = second - first;
        // Preserve native coefficient grouping for double-precision rounding.
        const a = third * 0.5 - delta;
        const b = delta * 2 - third * 0.5;
        last = first + (a * fractional + b) * fractional;
      }
      output[channel]![frame] = input * dry + last * wet;
    }
  }
  return output;
}
