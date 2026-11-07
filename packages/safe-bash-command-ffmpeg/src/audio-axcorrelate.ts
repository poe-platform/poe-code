import type { MediaBudgetTracker, MediaTrack } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function correlateAudio(
  first: MediaTrack, second: MediaTrack, filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaTrack> {
  const a = first.decodedAudio;
  const b = second.decodedAudio;
  if (!a || !b) throw new Error("axcorrelate requires decoded PCM audio");
  if (a.sampleRate !== b.sampleRate || a.channels !== b.channels || a.channelMask !== b.channelMask) {
    throw new Error("axcorrelate requires matching sample rates and channel layouts");
  }
  let size = 256;
  let algo = "best";
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["size", "algo"][index] : option.slice(0, separator);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "size") {
      size = Number(value);
      if (!Number.isInteger(size) || size < 2 || size > 131072) throw new Error("axcorrelate: invalid size");
    } else if (key === "algo") {
      algo = ["slow", "fast", "best"][Number(value)] ?? value;
      if (!value || !["slow", "fast", "best"].includes(algo)) throw new Error("axcorrelate: invalid algo");
    } else throw new Error(`axcorrelate: unsupported option ${key}`);
  }
  const length = Math.min(a.channelData[0]!.length, b.channelData[0]!.length);
  budget.checkSamples(length);
  budget.checkDuration(length / a.sampleRate);
  budget.allocateMemory(length * a.channels * 8);
  const channelData = a.channelData.map(() => new Float64Array(length));
  for (let c = 0; c < a.channels; c++) {
    const x = a.channelData[c]!;
    const y = b.channelData[c]!;
    let sx = 0, sy = 0, xx = 0, yy = 0, xy = 0;
    // Each forward window is padded with silence past that input's end.
    for (let i = 0; i < size; i++) {
      if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      const u = x[i] ?? 0, v = y[i] ?? 0;
      sx += u; sy += v; xx += u * u; yy += v * v; xy += u * v;
    }
    for (let i = 0; i < length; i++) {
      if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      let numerator = xy;
      let varianceX = xx, varianceY = yy;
      if (algo === "slow") {
        numerator = 0; varianceX = 0; varianceY = 0;
        for (let j = 0; j < size; j++) {
          if ((i * size + j) % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const u = (x[i + j] ?? 0) - sx / size, v = (y[i + j] ?? 0) - sy / size;
          numerator += u * v; varianceX += u * u; varianceY += v * v;
        }
      } else if (algo === "best") {
        numerator -= sx * sy / size;
        varianceX -= sx * sx / size; varianceY -= sy * sy / size;
      }
      const denominator = Math.sqrt(Math.max(0, varianceX)) * Math.sqrt(Math.max(0, varianceY));
      channelData[c]![i] = denominator <= 1e-6 * (algo === "best" ? 1 : size) ? 0
        : Math.max(-1, Math.min(1, numerator / denominator));
      const oldX = x[i] ?? 0, oldY = y[i] ?? 0;
      const newX = x[i + size] ?? 0, newY = y[i + size] ?? 0;
      sx += newX - oldX; sy += newY - oldY;
      xx = Math.max(0, xx + newX * newX - oldX * oldX);
      yy = Math.max(0, yy + newY * newY - oldY * oldY);
      xy += newX * newY - oldX * oldY;
    }
  }
  return { ...first, timescale: a.sampleRate, duration: length, samples: [], editList: undefined,
    decodedAudio: { ...a, channelData } };
}
