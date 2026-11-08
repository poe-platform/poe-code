import { yieldTurn } from "safe-bash-contracts/yield";
import type { MediaBudgetTracker } from "@poe-code/mp4-ast";

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 32; k++) {
    term *= x * x / (4 * k * k);
    sum += term;
    if (term < sum * Number.EPSILON) break;
  }
  return sum;
}

export async function resampleSoxr(
  channels: readonly (Float32Array | Float64Array)[], inputRate: number, outputRate: number,
  budget: MediaBudgetTracker, signal?: AbortSignal, resampleCutoff = 0
): Promise<Float32Array[]> {
  const length = channels[0]?.length ?? 0;
  const ratio = inputRate / outputRate;
  const outputLength = Math.round(length / ratio);
  const output = channels.map(() => new Float32Array(outputLength));
  // SoXR's default 20-bit HQ linear-phase filter: 126.43 dB rejection,
  // 0.91374365 passband, and a Kaiser window. Unlike SWR, flushing uses
  // zero padding and rounded duration, even for clips shorter than the filter.
  const passband = resampleCutoff ? Math.max(0.8, Math.min(0.995, resampleCutoff)) : 0.9137436532733066;
  const scale = Math.max(1, ratio);
  const cutoff = (1 + passband) / (2 * scale);
  const beta = 13.040035757464572;
  const normalization = besselI0(beta);
  let divisor = inputRate;
  let remainder = outputRate;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
  const phases = outputRate / divisor;
  const taps = 4 * Math.ceil((8.302342035109922 * 2 * scale * phases / (1 - passband)) / 4) + 1;
  const radius = taps / (2 * phases);
  const sums = new Float64Array(channels.length);
  let work = 0;
  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio;
    sums.fill(0);
    // Evaluate the FIR directly, sharing each coefficient across channels.
    for (let j = Math.max(0, Math.ceil(position - radius)); j <= Math.min(length - 1, Math.floor(position + radius)); j++) {
      const distance = j - position;
      const angle = Math.PI * distance;
      const window = besselI0(beta * Math.sqrt(Math.max(0, 1 - (distance / radius) ** 2))) / normalization;
      const weight = (angle === 0 ? cutoff : Math.sin(cutoff * angle) / angle) * window;
      for (let c = 0; c < channels.length; c++) sums[c] = sums[c]! + channels[c]![j]! * weight;
      if (++work % 16384 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
    }
    for (let c = 0; c < channels.length; c++) output[c]![i] = sums[c]!;
  }
  return output;
}
