import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function adenormAudio(
  channels: readonly (Float32Array | Float64Array)[], filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  let level = -351;
  let type = "dc";
  let positionalIndex = 0;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const parts = argument ? argument.split(":") : [];
  if (argument.endsWith(":")) parts.pop();
  for (const option of parts) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["level", "type"][positionalIndex++] : option.slice(0, separator).trim();
    const value = option.slice(separator + 1).trim();
    if (key === "level") {
      level = parseFilterExpression(value, "adenorm", {});
      if (!value || !Number.isFinite(level) || level < -451 || level > -90) {
        throw new RangeError("adenorm: invalid level");
      }
    } else if (key === "type") {
      if (!["dc", "ac", "0", "1"].includes(value)) throw new Error(`adenorm: unsupported type ${value}`);
      type = value === "1" ? "ac" : value;
    } else {
      throw new Error(`adenorm: unsupported option ${key}`);
    }
  }
  const amplitude = 10 ** (level / 20);
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
      output[c]![i] = channel[i]! + (type === "ac" && i % 2 ? -amplitude : amplitude);
    }
  }
  return output;
}
