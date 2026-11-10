import { yieldTurn } from "safe-bash-contracts/yield";
import type { MediaBudgetTracker } from "@poe-code/mp4-ast";

export async function resampleAudio(
  channels: readonly (Float32Array | Float64Array)[], outputLength: number, inputRate: number, outputRate: number,
  budget: MediaBudgetTracker, signal?: AbortSignal, filterType: "kaiser" | "blackman_nuttall" = "kaiser", kaiserBeta = 9, filterSize = 32, resampleCutoff = 0, phaseShift = 10, linearInterp = 1, exactRational = 1,
  frameLimit?: { count?: number; ends: readonly number[]; outputEnds?: number[] }
): Promise<Float32Array[]> {
  const rateRatio = inputRate / outputRate;
  const length = channels[0]?.length ?? 0;
  // Zero selects swresample’s default cutoff; scale support with the effective ratio.
  const cutoff = Math.min((resampleCutoff || 0.97) / rateRatio, 1);
  // Startup needs filterLength + 1 input samples, including the limited
  // reflected tail added on flush. Short clips may never initialize at all.
  const filterLength = filterSize <= cutoff ? 1
    : 2 * Math.ceil(filterSize / 2 / cutoff);
  if (length <= filterLength) {
    const flushedLength = length + Math.ceil(length / 2);
    outputLength = flushedLength <= filterLength ? 0
      : Math.ceil((flushedLength - filterLength / 2) / rateRatio);
  }
  if (frameLimit) {
    let frames = 0;
    let emitted = 0;
    if (frameLimit.count === 0) outputLength = 0;
    for (const end of frameLimit.ends) {
      const available = Math.min(length, end);
      if (available <= filterLength) continue;
      // Each input frame emits only samples whose filter support is available.
      // The remaining tail is a separate frame emitted during flush.
      const produced = Math.max(0, Math.ceil((available - filterLength / 2) / rateRatio));
      if (produced <= emitted) continue;
      emitted = Math.min(outputLength, produced);
      frameLimit.outputEnds?.push(emitted);
      if (++frames === frameLimit.count) {
        outputLength = Math.min(outputLength, emitted);
        break;
      }
    }
    if (emitted < outputLength) frameLimit.outputEnds?.push(outputLength);
  }
  const output = channels.map(() => new Float32Array(outputLength));
  if (length === 0) return output;
  const center = Math.floor((filterLength - 1) / 2);
  // Startup reflects around the first sample; flushing repeats the last sample.
  const period = Math.max(1, 2 * length - 1);
  const sums = new Float64Array(channels.length);
  let phaseCount = 2 ** phaseShift;
  if (exactRational) {
    let divisor = inputRate;
    let remainder = outputRate;
    while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
    const exactPhases = outputRate / divisor;
    if (exactPhases <= phaseCount) phaseCount = exactPhases;
  }
  let work = 0;
  let normalization = 1;
  for (let i = 0; i < outputLength; i++) {
    let weightSum = 0;
    sums.fill(0);
    const phasePosition = i * (inputRate * phaseCount) / outputRate;
    const fraction = linearInterp ? phasePosition - Math.floor(phasePosition) : 0;
    // Default linear interpolation blends adjacent polyphase filter responses.
    // Evaluate only those phases, without allocating a potentially huge bank.
    for (let side = 0; side < (fraction === 0 ? 1 : 2); side++) {
      const phaseWeight = side === 0 ? 1 - fraction : fraction;
      const samplePosition = (Math.floor(phasePosition) + side) / phaseCount;
      for (let j = Math.floor(samplePosition) - center; j < Math.floor(samplePosition) - center + filterLength; j++) {
        const distance = j - samplePosition;
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
        const weight = (phase === 0 ? 1 : Math.sin(phase) / phase) * window * phaseWeight;
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
    }
    // swresample normalizes all phases by the integer-phase coefficient sum.
    if (i === 0) normalization = weightSum;
    for (let c = 0; c < channels.length; c++) output[c]![i] = sums[c]! / normalization;
  }
  return output;
}
