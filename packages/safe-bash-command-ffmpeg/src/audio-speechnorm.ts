import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function normalizeSpeech(
  channels: readonly (Float32Array | Float64Array)[], filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const options = { peak: 0.95, expansion: 2, compression: 2, threshold: 0, raise: 0.001, fall: 0.001 };
  const names = Object.keys(options) as (keyof typeof options)[];
  const aliases: Record<string, keyof typeof options> = { p: "peak", e: "expansion", c: "compression", t: "threshold", r: "raise", f: "fall" };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[index] : option.slice(0, separator).trim();
    const name = key && (aliases[key] ?? names.find(name => name === key));
    if (!name) throw new Error(`speechnorm: unsupported option ${key}`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const number = parseFilterExpression(value, "speechnorm", {});
    const factor = name === "expansion" || name === "compression";
    if (!value || !Number.isFinite(number) || number < (factor ? 1 : 0) || number > (factor ? 50 : 1)) {
      throw new Error(`speechnorm: invalid ${name}`);
    }
    options[name] = number;
  }
  budget.allocateMemory(channels.reduce((sum, channel) => sum + channel.length * 8, 0));
  const output = channels.map(channel => new Float64Array(channel.length));
  for (const [c, channel] of channels.entries()) {
    let gain = options.expansion;
    let start = 0;
    let peak = Number.MIN_VALUE;
    // Each half-wave gets one gain. Loud periods cap it immediately;
    // subsequent quiet periods recover by the configured raise amount.
    for (let end = 0; end <= channel.length; end++) {
      if (end % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      if (end > start && (end === channel.length ||
          ((channel[end]! >= 0) !== (channel[end - 1]! >= 0) && peak >= 1 / 32768))) {
        const limit = Math.min(options.expansion, options.peak / peak);
        gain = Math.min(limit, peak >= options.threshold
          ? gain + options.raise : Math.max(1 / options.compression, gain - options.fall));
        for (let i = start; i < end; i++) {
          if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          output[c]![i] = channel[i]! * gain;
        }
        start = end;
        peak = Number.MIN_VALUE;
      }
      if (end < channel.length) peak = Math.max(peak, Math.abs(channel[end]!));
    }
  }
  return output;
}
