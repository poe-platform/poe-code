import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { compandAudio } from "./audio-compand.js";

const defaultBands = "0.005,0.1 6 -47/-40,-34/-34,-17/-33 100 | 0.003,0.05 6 -47/-40,-34/-34,-17/-33 400 | 0.000625,0.0125 6 -47/-40,-34/-34,-15/-33 1600 | 0.0001,0.025 6 -47/-40,-34/-34,-31/-31,0/-30 6400 | 0,0.025 6 -38/-31,-28/-28,0/-25 22000";

export async function multibandCompandAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  let argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : defaultBands;
  if (argument.startsWith("args=")) argument = argument.slice(5);
  const length = channels[0]?.length ?? 0;
  budget.allocateMemory(length * channels.length * 8);
  const output = channels.map(() => new Float64Array(length));
  let remaining = channels;
  for (const band of argument.split("|")) {
    const fields = band.trim().split(" ").filter(Boolean);
    if (fields.length < 4 || fields.length > 7) throw new Error("mcompand: expected rates, knee, points, crossover, and optional delay/volume/gain");
    const [rates, knee, points, crossover, delay = "0", volume = "-900", gain = "0"] = fields;
    const times = rates!.split(",");
    if (times.length % 2) throw new Error("mcompand: attack/decay rates must be paired");
    const frequency = Number(crossover);
    if (!Number.isFinite(frequency) || frequency < 0 || frequency >= sampleRate / 2) throw new Error("mcompand: crossover must be below half the sample rate");
    if (Number(delay) !== 0 || Number(gain) !== 0) throw new Error("mcompand: nonzero delay and gain are unsupported");
    let low = remaining;
    if (frequency !== 0) {
      // Fourth-order Linkwitz-Riley crossover: square the Butterworth
      // low/high-pass numerator and common denominator polynomials.
      const w = 2 * Math.PI * frequency / sampleRate;
      const cosine = Math.cos(w);
      const alpha = Math.sin(w) / Math.sqrt(2);
      const square = (a: number, b: number, c: number) => {
        a /= 1 + alpha; b /= 1 + alpha; c /= 1 + alpha;
        return [a * a, 2 * a * b, 2 * a * c + b * b, 2 * b * c, c * c];
      };
      const lp = square((1 - cosine) / 2, 1 - cosine, (1 - cosine) / 2);
      const hp = square((1 + cosine) / 2, -(1 + cosine), (1 + cosine) / 2);
      const denominator = square(1 + alpha, -2 * cosine, 1 - alpha);
      budget.allocateMemory(length * channels.length * 16 + channels.length * 12 * 8);
      low = channels.map(() => new Float64Array(length));
      const high = channels.map(() => new Float64Array(length));
      for (let c = 0; c < channels.length; c++) {
        const inputs = new Float64Array(4), lows = new Float64Array(4), highs = new Float64Array(4);
        for (let i = 0; i < length; i++) {
          if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const sample = remaining[c]![i]!;
          let l = lp[0]! * sample, h = hp[0]! * sample;
          for (let j = 1; j <= 4; j++) {
            const pos = (i - j) & 3;
            l += lp[j]! * inputs[pos]! - denominator[j]! * lows[pos]!;
            h += hp[j]! * inputs[pos]! - denominator[j]! * highs[pos]!;
          }
          inputs[i & 3] = sample; lows[i & 3] = l; highs[i & 3] = h;
          low[c]![i] = l; high[c]![i] = h;
        }
      }
      remaining = high;
    }
    const attacks = times.filter((_, i) => i % 2 === 0).join("|");
    const decays = times.filter((_, i) => i % 2 === 1).join("|");
    const { channels: processed } = await compandAudio(low, sampleRate,
      `compand=${attacks}:${decays}:${points!.split(",").join("|")}:${knee}:0:${volume}`, budget, signal);
    for (let c = 0; c < channels.length; c++) {
      for (let i = 0; i < length; i++) {
        if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        output[c]![i] = output[c]![i]! + processed[c]![i]!;
      }
    }
  }
  return output;
}
