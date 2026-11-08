import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function softClipAudio(
  channels: readonly (Float32Array | Float64Array)[], filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const options = { threshold: 1, output: 1, param: 1 };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["type", "threshold", "output", "param", "oversample"][index] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "type") {
      if (value !== "tanh" && value !== "0") throw new Error("asoftclip: only type=tanh is supported");
    } else if (key === "oversample") {
      if (!value || Number(value) !== 1) throw new Error("asoftclip: only oversample=1 is supported");
    } else if (key === "threshold" || key === "output" || key === "param") {
      const number = Number(value);
      const min = key === "param" ? 0.01 : 0.000001;
      const max = key === "param" ? 3 : key === "output" ? 16 : 1;
      if (!value || !Number.isFinite(number) || number < min || number > max) {
        throw new Error(`asoftclip: invalid ${key}`);
      }
      options[key] = number;
    } else {
      throw new Error(`asoftclip: unsupported option ${key}`);
    }
  }
  budget.allocateMemory(channels.reduce((sum, channel) => sum + channel.length * 8, 0));
  const output = channels.map(channel => new Float64Array(channel.length));
  let work = 0;
  for (const [c, channel] of channels.entries()) {
    for (let i = 0; i < channel.length; i++) {
      if (work++ % 4096 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
      output[c]![i] = options.threshold * options.output * Math.tanh(channel[i]! / options.threshold * options.param);
    }
  }
  return output;
}
