import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function softClipAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number }[],
  format: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const types = ["hard", "tanh", "atan", "cubic", "exp", "alg", "quintic", "sin", "erf"];
  let type = "tanh";
  let enable: string | undefined;
  const options = { threshold: 1, output: 1, param: 1, oversample: 1 };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["type", "threshold", "output", "param", "oversample"][index] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "enable") {
      enable = value;
      parseFilterExpression(enable, "asoftclip enable", { n: 0, t: 0 });
    } else if (key === "type") {
      const selected = types.includes(value) ? value : types.find((_, i) => value === String(i - 1));
      if (!selected) throw new Error("asoftclip: invalid type");
      type = selected;
    } else if (key === "oversample") {
      const number = parseFilterExpression(value, "asoftclip", {});
      if (!Number.isInteger(number) || number < 1 || number > 64) throw new Error("asoftclip: invalid oversample");
      options.oversample = number;
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
  function clip(sample: number): number {
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
      default: clipped = round(Math.tanh(round(sample * param)));
    }
    return round(round(clipped) * gain);
  }
  budget.allocateMemory(channels.reduce((sum, channel) => sum + channel.length * 8, 0));
  const output = channels.map(channel => new Float64Array(channel.length));
  // Zero insertion and two low-pass passes match FFmpeg's oversampling.
  // The cutoff is the original Nyquist frequency, so the rate cancels out.
  const round = format === "dblp" ? (value: number) => value : Math.fround;
  const angle = Math.PI / options.oversample;
  const cosine = Math.cos(angle);
  const alpha = Math.sin(angle) / 1.6;
  const a0 = 1 + alpha;
  const feedback1 = -2 * cosine / a0;
  const feedback2 = (1 - alpha) / a0;
  const feed0 = (1 - cosine) / 2 / a0;
  const feed1 = (1 - cosine) / a0;
  const normalization = (1 + feedback1 + feedback2) / (feed0 + feed1 + feed0);
  const a1 = round(feedback1), a2 = round(feedback2);
  const b0 = round(feed0 * normalization), b1 = round(feed1 * normalization);
  const threshold = round(options.threshold);
  const gain = round(options.output * threshold);
  const factor = round(1 / threshold);
  const param = round(options.param);
  let work = 0;
  for (const [c, channel] of channels.entries()) {
    let up0 = 0, up1 = 0, down0 = 0, down1 = 0;
    for (const [n, frame] of frames.entries()) {
      const enabled = enable === undefined || Math.abs(parseFilterExpression(enable, "asoftclip enable", {
        n, t: frame.pts / sampleRate
      })) >= 0.5;
      for (let i = frame.start; i < frame.end; i++) {
        for (let phase = 0; phase < (enabled ? options.oversample : 1); phase++) {
          if (work++ % 4096 === 0) {
            await yieldTurn(signal);
            signal?.throwIfAborted();
            budget.checkCpu();
          }
          if (!enabled) {
            output[c]![i] = channel[i]!;
            continue;
          }
          if (options.oversample === 1) {
            output[c]![i] = clip(round(round(channel[i]!) * factor));
            continue;
          }
          const sample = phase === 0 ? round(channel[i]!) : 0;
          const interpolated = round(round(sample * b0) + up0);
          up0 = round(round(round(b1 * sample) + up1) - round(a1 * interpolated));
          up1 = round(round(b0 * sample) - round(a2 * interpolated));
          const clipped = clip(round(interpolated * factor));
          const filtered = round(round(clipped * b0) + down0);
          down0 = round(round(round(b1 * clipped) + down1) - round(a1 * filtered));
          down1 = round(round(b0 * clipped) - round(a2 * filtered));
          // Stream the oversampled values without allocating a factor-sized buffer.
          if (phase === 0) output[c]![i] = round(filtered * (options.oversample * 0.5));
        }
      }
    }
  }
  return output;
}
