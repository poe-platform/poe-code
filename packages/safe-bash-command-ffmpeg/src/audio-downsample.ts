import { yieldTurn } from "safe-bash-contracts/yield";
import type { MediaBudgetTracker } from "@poe-code/mp4-ast";

export async function downsampleAudio(
  channels: readonly Float32Array[], outputLength: number,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float32Array[]> {
  const length = channels[0]?.length ?? 0;
  const output = channels.map(() => new Float32Array(outputLength));
  if (length === 0) return output;
  // A Blackman-windowed sinc removes content above the new Nyquist limit.
  // Scale the support with the rate ratio to retain rejection at large reductions.
  const cutoff = Math.min(1, outputLength / length) * 0.94;
  const radius = 32 / cutoff;
  const sums = new Float64Array(channels.length);
  let work = 0;
  for (let i = 0; i < outputLength; i++) {
    const position = i * length / outputLength;
    let weightSum = 0;
    sums.fill(0);
    for (let j = Math.max(0, Math.ceil(position - radius)); j <= Math.min(length - 1, Math.floor(position + radius)); j++) {
      const distance = j - position;
      const phase = Math.PI * distance * cutoff;
      const window = 0.42 + 0.5 * Math.cos(Math.PI * distance / radius) + 0.08 * Math.cos(2 * Math.PI * distance / radius);
      const weight = (phase === 0 ? 1 : Math.sin(phase) / phase) * window;
      weightSum += weight;
      for (let c = 0; c < channels.length; c++) sums[c] = sums[c]! + channels[c]![j]! * weight;
      if (++work % 16384 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
    }
    // Normalize the truncated kernel at the boundaries to preserve constant audio.
    for (let c = 0; c < channels.length; c++) output[c]![i] = sums[c]! / weightSum;
  }
  return output;
}
