import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function tremoloAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  let frequency = 5;
  let depth = 0.5;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["f", "d"][index] : option.slice(0, separator).trim();
    if (key !== "f" && key !== "d") throw new Error(`tremolo: unsupported option ${key}`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const number = Number(value);
    if (!value || !Number.isFinite(number) || number < (key === "f" ? 0.1 : 0) || number > (key === "f" ? 20000 : 1)) {
      throw new Error(`tremolo: invalid ${key}`);
    }
    if (key === "f") frequency = number;
    else depth = number;
  }
  // Native FFmpeg rounds sampleRate / frequency + 0.5 to nearest, ties to even.
  const size = sampleRate / frequency + 0.5;
  const rounded = Math.round(size);
  const period = size === rounded - 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded;
  const offset = 1 - depth / 2;
  const length = channels[0]?.length ?? 0;
  budget.allocateMemory(length * channels.length * 8);
  const output = channels.map(() => new Float64Array(length));
  let work = 0;
  for (let frame = 0; frame < length; frame++) {
    const phase = (frequency * (frame % period) / sampleRate + 0.25) % 1;
    const gain = Math.sin(2 * Math.PI * phase) * (1 - Math.abs(offset)) + offset;
    for (let c = 0; c < channels.length; c++) {
      if (work++ % 4096 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
      output[c]![frame] = channels[c]![frame]! * gain;
    }
  }
  return output;
}
