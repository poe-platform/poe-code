import { yieldTurn } from "safe-bash-contracts/yield";
import type { MediaBudgetTracker } from "@poe-code/mp4-ast";

export async function resampleAudio(
  channels: readonly (Float32Array | Float64Array)[], outputLength: number, rateRatio: number,
  budget: MediaBudgetTracker, signal?: AbortSignal, filterType: "kaiser" | "blackman_nuttall" = "kaiser", kaiserBeta = 9, filterSize = 32
): Promise<Float32Array[]> {
  const length = channels[0]?.length ?? 0;
  // swresample scales the requested filter size by a 0.97 cutoff and rounds up to even support.
  // Startup needs filterLength + 1 input samples, including the limited
  // reflected tail added on flush. Short clips may never initialize at all.
  const filterLength = filterSize <= Math.min(0.97 / rateRatio, 1) ? 1
    : 2 * Math.ceil(filterSize / 2 / Math.min(0.97 / rateRatio, 1));
  if (length <= filterLength) {
    const flushedLength = length + Math.ceil(length / 2);
    outputLength = flushedLength <= filterLength ? 0
      : Math.ceil((flushedLength - filterLength / 2) / rateRatio);
  }
  const output = channels.map(() => new Float32Array(outputLength));
  if (length === 0) return output;
  // swresample defaults: Kaiser beta 9 and a 0.97 cutoff.
  const cutoff = Math.min(0.97 / rateRatio, 1);
  const center = Math.floor((filterLength - 1) / 2);
  const period = Math.max(1, 2 * (length - 1));
  const sums = new Float64Array(channels.length);
  let work = 0;
  let normalization = 1;
  for (let i = 0; i < outputLength; i++) {
    const position = i * rateRatio;
    let weightSum = 0;
    sums.fill(0);
    for (let j = Math.floor(position) - center; j < Math.floor(position) - center + filterLength; j++) {
      const distance = j - position;
      const phase = Math.PI * distance * cutoff;
      const w = 2 * distance / filterLength;
      let window: number;
      if (filterType === "blackman_nuttall") {
        const angle = Math.PI * w;
        window = 0.3635819 + 0.4891775 * Math.cos(angle)
          + 0.1365995 * Math.cos(2 * angle) + 0.0106411 * Math.cos(3 * angle);
      } else {
        const x = kaiserBeta * kaiserBeta * Math.max(1 - w * w, 0) / 4;
        // I0(beta * sqrt(1 - w²)), evaluated by its convergent power series.
        window = 1;
        let term = 1;
        for (let k = 1; k < 32; k++) {
          term *= x / (k * k);
          window += term;
          if (term < window * Number.EPSILON) break;
        }
      }
      const weight = (phase === 0 ? 1 : Math.sin(phase) / phase) * window;
      weightSum += weight;
      // Reflect at both ends, including clips shorter than the filter support.
      const wrapped = ((j % period) + period) % period;
      const index = wrapped < length ? wrapped : period - wrapped;
      for (let c = 0; c < channels.length; c++) sums[c] = sums[c]! + channels[c]![index]! * weight;
      if (++work % 16384 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
    }
    // swresample normalizes all phases by the integer-phase coefficient sum.
    if (i === 0) normalization = weightSum;
    for (let c = 0; c < channels.length; c++) output[c]![i] = sums[c]! / normalization;
  }
  return output;
}
