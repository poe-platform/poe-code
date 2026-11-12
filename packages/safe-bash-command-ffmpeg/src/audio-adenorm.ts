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
      type = ({ "0": "dc", "1": "ac", "2": "square", "3": "pulse" } as Record<string, string>)[value] ?? value;
      if (!["dc", "ac", "square", "pulse"].includes(type)) throw new Error(`adenorm: unsupported type ${value}`);
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
      let noise = amplitude;
      if (type === "ac" && i % 2) noise = -amplitude;
      else if (type === "square" && Math.floor(i / 256) % 2) noise = -amplitude;
      else if (type === "pulse" && i % 256) noise = 0;
      output[c]![i] = channel[i]! + noise;
    }
  }
  return output;
}
