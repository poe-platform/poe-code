import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function smoothAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number }[],
  budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { sample: number; action: string; expression: string }[] = []
): Promise<Float64Array[]> {
  const options = { sensitivity: 2, basefreq: 22050 };
  const names = Object.keys(options) as (keyof typeof options)[];
  let enable: string | undefined;
  let positionalIndex = 0;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const parts = argument ? argument.split(":") : [];
  if (argument.endsWith(":")) parts.pop();
  for (const option of parts) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[positionalIndex++] : option.slice(0, separator).trim();
    const value = option.slice(separator + 1).trim();
    if (key === "enable") {
      enable = value;
      parseFilterExpression(value, "adynamicsmooth enable", { n: 0, t: 0 });
    } else if (key === "sensitivity" || key === "basefreq") {
      const number = parseFilterExpression(value, "adynamicsmooth", {});
      if (!value || !Number.isFinite(number) || number < (key === "basefreq" ? 2 : 0) || number > 1000000) {
        throw new RangeError(`adynamicsmooth: invalid ${key}`);
      }
      options[key] = number;
    } else {
      throw new Error(`adynamicsmooth: unsupported option ${key}`);
    }
  }
  budget.allocateMemory(channels.reduce((sum, channel) => sum + channel.length * 8, 0));
  const output = channels.map(channel => new Float64Array(channel.length));
  let work = 0;
  for (const [c, channel] of channels.entries()) {
    const currentOptions = { ...options };
    let nextCommand = 0;
    let low1 = 0;
    let low2 = 0;
    let previousInput = 0;
    for (const [n, frame] of frames.entries()) {
      while (nextCommand < commands.length && commands[nextCommand]!.sample <= frame.start) {
        const command = commands[nextCommand++]!;
        const key = command.action;
        if (key !== "basefreq" && key !== "sensitivity") continue;
        try {
          const value = parseFilterExpression(command.expression, "adynamicsmooth", {});
          if (!Number.isFinite(value) || value < (key === "basefreq" ? 2 : 0) || value > 1000000) continue;
          currentOptions[key] = value;
        } catch { /* Rejected runtime commands leave the current setting unchanged. */ }
      }
      const frequency = currentOptions.basefreq / sampleRate;
      const enabled = enable === undefined || Math.abs(parseFilterExpression(enable, "adynamicsmooth enable", {
        n, t: frame.pts / sampleRate
      })) >= 0.5;
      for (let i = frame.start; i < frame.end; i++) {
        if (work++ % 4096 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        const input = channel[i]!;
        const previousLow = low1;
        const cutoff = frequency + currentOptions.sensitivity * Math.abs(low2 - low1);
        const gain = Math.min(1, cutoff * (5.9948827 + cutoff * (-11.969296 + cutoff * 15.959062)));
        low1 += gain * (0.5 * (input + previousInput) - low1);
        low2 += gain * (0.5 * (low1 + previousLow) - low2);
        previousInput = input;
        // Internal timeline bypass still updates the smoothing history.
        output[c]![i] = enabled ? low2 : input;
      }
    }
  }
  return output;
}
