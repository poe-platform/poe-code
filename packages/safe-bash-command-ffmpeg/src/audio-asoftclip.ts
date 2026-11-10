import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function softClipAudio(
  channels: readonly (Float32Array | Float64Array)[], filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const types = ["hard", "tanh", "atan", "cubic", "exp", "alg", "quintic", "sin", "erf"];
  let type = "tanh";
  const options = { threshold: 1, output: 1, param: 1 };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["type", "threshold", "output", "param", "oversample"][index] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "type") {
      const selected = types.includes(value) ? value : types.find((_, i) => value === String(i - 1));
      if (!selected) throw new Error("asoftclip: invalid type");
      type = selected;
    } else if (key === "oversample") {
      if (!value || Number(value) !== 1) throw new Error("asoftclip: only oversample=1 is supported");
    } else if (key === "threshold" || key === "output" || key === "param") {
      const number = parseFilterExpression(value, "asoftclip", {});
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
      const sample = channel[i]! / options.threshold;
      let clipped: number;
      switch (type) {
        case "hard": clipped = Math.max(-1, Math.min(1, sample)); break;
        case "atan": clipped = 2 / Math.PI * Math.atan(sample * options.param); break;
        case "cubic": clipped = Math.abs(sample) >= 1.5 ? Math.sign(sample) : sample - 0.1481 * sample ** 3; break;
        case "exp": clipped = 2 / (1 + Math.exp(-2 * sample)) - 1; break;
        case "alg": clipped = sample / Math.sqrt(options.param + sample * sample); break;
        case "quintic": clipped = Math.abs(sample) >= 1.25 ? Math.sign(sample) : sample - 0.08192 * sample ** 5; break;
        case "sin": clipped = Math.abs(sample) >= Math.PI / 2 ? Math.sign(sample) : Math.sin(sample); break;
        case "erf": {
          const x = Math.abs(sample);
          // erf(6) rounds to 1. The positive series avoids cancellation below it.
          if (x >= 6) {
            clipped = Math.sign(sample);
            break;
          }
          let term = x;
          let sum = x;
          for (let n = 1; n < 128; n++) {
            term *= 2 * x * x / (2 * n + 1);
            const next = sum + term;
            if (next === sum) break;
            sum = next;
          }
          clipped = Math.sign(sample) * (2 / Math.sqrt(Math.PI) * Math.exp(-x * x) * sum);
          break;
        }
        default: clipped = Math.tanh(sample * options.param);
      }
      output[c]![i] = options.threshold * options.output * clipped;
    }
  }
  return output;
}
