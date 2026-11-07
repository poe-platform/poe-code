import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function vibratoAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  let frequency = 5;
  let depth = 0.5;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["f", "d"][index] : option.slice(0, separator).trim();
    if (key !== "f" && key !== "d") throw new Error(`vibrato: unsupported option ${key}`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const number = Number(value);
    if (!value || !Number.isFinite(number) || number < (key === "f" ? 0.1 : 0) || number > (key === "f" ? 20000 : 1)) {
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
  for (let frame = 0; frame < length; frame++) {
    const point = (frame % period + phaseOffset) % period;
    const delay = depth * ((Math.sin(point / period * 2 * Math.PI) + 1) / 2 * (delaySize - 1));
    const integer = Math.floor(delay);
    const fraction = delay - integer;
    const writeIndex = frame % delaySize;
    const first = (writeIndex + integer) % delaySize;
    const second = (first + 1) % delaySize;
    for (let c = 0; c < channels.length; c++) {
      if (work++ % 4096 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
      const buffer = delays[c]!;
      output[c]![frame] = buffer[first]! + fraction * (buffer[second]! - buffer[first]!);
      buffer[writeIndex] = channels[c]![frame]!;
    }
  }
  return output;
}

function roundEven(value: number): number {
  const rounded = Math.round(value);
  return value === rounded - 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded;
}
