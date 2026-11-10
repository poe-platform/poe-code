import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function vibratoAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number; pos?: number | undefined }[],
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  let frequency = 5;
  let depth = 0.5;
  let enable: string | undefined;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const options = argument ? argument.split(":") : [];
  if (options.at(-1) === "") options.pop();
  let optionPosition = 0;
  for (const option of options) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["f", "d"][optionPosition] : option.slice(0, separator).trim();
    // FFmpeg 7 restarts shorthand after named options, skipping the first slot
    // when it was just visited. The named key does not select the next slot.
    if (separator < 0) optionPosition++;
    else optionPosition = optionPosition === 0 ? 1 : 0;
    if (key === "enable") {
      enable = option.slice(separator + 1).trim();
      parseFilterExpression(enable, "vibrato enable", { n: 0, t: 0, pos: NaN, w: 0, h: 0, E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2 });
      continue;
    }
    if (key !== "f" && key !== "d") throw new Error(`vibrato: unsupported option ${key}`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const min = key === "f" ? 0.1 : 0;
    const max = key === "f" ? 20000 : 1;
    const number = parseFilterExpression(value, "vibrato", {
      E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2,
      min, max, default: key === "f" ? 5 : 0.5
    });
    if (number < min || number > max) {
      throw new Error(`vibrato: invalid ${key}`);
    }
    if (key === "f") frequency = number;
    else depth = number;
  }
  // Native delay and oscillator lengths use nearest-even rounding.
  const delaySize = Math.max(1, roundEven(sampleRate * 0.005 + 0.5));
  const period = Math.max(1, roundEven(sampleRate / frequency + 0.5));
  const phaseOffset = Math.floor(0.75 * period + 0.5);
  const length = channels[0]?.length ?? 0;
  budget.allocateMemory((length + delaySize) * channels.length * 8);
  const output = channels.map(() => new Float64Array(length));
  const delays = channels.map(() => new Float64Array(delaySize));
  let work = 0;
  // Generic timeline bypass freezes both oscillator phase and delay history.
  let position = 0;
  for (const [n, timestamp] of frames.entries()) {
    const enabled = enable === undefined || Math.abs(parseFilterExpression(enable, "vibrato enable", {
      n, t: timestamp.pts / sampleRate, pos: timestamp.pos ?? NaN, w: 0, h: 0,
      E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2
    })) >= 0.5;
    for (let frame = timestamp.start; frame < timestamp.end; frame++) {
      const point = (position % period + phaseOffset) % period;
      const delay = depth * ((Math.sin(point / period * 2 * Math.PI) + 1) / 2 * (delaySize - 1));
      const integer = Math.floor(delay);
      const fraction = delay - integer;
      const writeIndex = position % delaySize;
      const first = (writeIndex + integer) % delaySize;
      const second = (first + 1) % delaySize;
      for (let c = 0; c < channels.length; c++) {
        if (work++ % 4096 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        if (!enabled) {
          output[c]![frame] = channels[c]![frame]!;
          continue;
        }
        const buffer = delays[c]!;
        output[c]![frame] = buffer[first]! + fraction * (buffer[second]! - buffer[first]!);
        buffer[writeIndex] = channels[c]![frame]!;
      }
      if (enabled) position++;
    }
  }
  return output;
}

function roundEven(value: number): number {
  const rounded = Math.round(value);
  return value === rounded - 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded;
}
