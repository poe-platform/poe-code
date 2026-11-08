import { yieldTurn } from "safe-bash-contracts/yield";
import type { MediaBudgetTracker } from "@poe-code/mp4-ast";

export async function resampleAudio(
  channels: readonly (Float32Array | Float64Array)[], outputLength: number, rateRatio: number,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float32Array[]> {
  const length = channels[0]?.length ?? 0;
  // swresample's default 32-tap filter uses a 0.97 cutoff and even support.
  // Startup needs filterLength + 1 input samples, including the limited
  // reflected tail added on flush. Short clips may never initialize at all.
  const filterLength = 2 * Math.ceil(16 / Math.min(0.97 / rateRatio, 1));
  if (length <= filterLength) {
    const flushedLength = length + Math.ceil(length / 2);
    outputLength = flushedLength <= filterLength ? 0
      : Math.ceil((flushedLength - filterLength / 2) / rateRatio);
  }
  const output = channels.map(() => new Float32Array(outputLength));
  if (length === 0) return output;
  // A Blackman-windowed sinc removes content above the new Nyquist limit.
  // Scale the support with the rate ratio to retain rejection at large reductions.
  const cutoff = rateRatio > 1 ? 0.94 / rateRatio : 1;
  const radius = 32 / cutoff;
  const period = Math.max(1, 2 * (length - 1));
  const sums = new Float64Array(channels.length);
  let work = 0;
  for (let i = 0; i < outputLength; i++) {
    const position = i * rateRatio;
    let weightSum = 0;
    sums.fill(0);
    for (let j = Math.ceil(position - radius); j <= Math.floor(position + radius); j++) {
      const distance = j - position;
      const phase = Math.PI * distance * cutoff;
      const window = 0.42 + 0.5 * Math.cos(Math.PI * distance / radius) + 0.08 * Math.cos(2 * Math.PI * distance / radius);
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
    // Normalize each fractional phase to preserve constant audio.
    for (let c = 0; c < channels.length; c++) output[c]![i] = sums[c]! / weightSum;
  }
  return output;
}
