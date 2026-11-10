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
  if (length === 0 || outputLength === 0) return output;
  const center = Math.floor((filterLength - 1) / 2);
  // Startup reflects around the first sample; flushing repeats the last sample.
  const period = Math.max(1, 2 * length - 1);
  const sums = new Float64Array(channels.length);
  budget.allocateMemory(channels.length * 8 * Float32Array.BYTES_PER_ELEMENT);
  const lanes = new Float32Array(channels.length * 8);
  let phaseCount = 2 ** phaseShift;
  if (exactRational) {
    let divisor = inputRate;
    let remainder = outputRate;
    while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
    const exactPhases = outputRate / divisor;
    if (exactPhases <= phaseCount) phaseCount = exactPhases;
  }
  function filterWeight(distance: number): number {
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
    return (phase === 0 ? 1 : Math.sin(phase) / phase) * window;
  }
  let work = 0;
  // All phases use the integer-phase coefficient sum for normalization.
  let normalization = 0;
  for (let j = -center; j < filterLength - center; j++) {
    normalization += filterWeight(j);
    if (++work % 16384 === 0) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      budget.checkCpu();
    }
  }
  // FFmpeg's x86 FMA float path accumulates eight lanes, then sums halves.
  // Keep adjacent-phase interpolation on its separate scalar path.
  const interpolate = linearInterp !== 0 && inputRate * phaseCount % outputRate !== 0;
  for (let i = 0; i < outputLength; i++) {
    sums.fill(0);
    lanes.fill(0);
    const phasePosition = i * (inputRate * phaseCount) / outputRate;
    const fraction = linearInterp ? phasePosition - Math.floor(phasePosition) : 0;
    // Default linear interpolation blends adjacent polyphase filter responses.
    // Evaluate only those phases, without allocating a potentially huge bank.
    for (let side = 0; side < (fraction === 0 ? 1 : 2); side++) {
      const phaseWeight = side === 0 ? 1 - fraction : fraction;
      const samplePosition = (Math.floor(phasePosition) + side) / phaseCount;
      for (let j = Math.floor(samplePosition) - center; j < Math.floor(samplePosition) - center + filterLength; j++) {
        const distance = j - samplePosition;
        const weight = filterWeight(distance) * phaseWeight;
        // Reflect at both ends, including clips shorter than the filter support.
        const wrapped = ((j % period) + period) % period;
        const index = wrapped < length ? wrapped : period - wrapped;
        const coefficient = Math.fround(weight / normalization);
        const lane = (j - Math.floor(samplePosition) + center) % 8;
        for (let c = 0; c < channels.length; c++) {
          if (interpolate) sums[c] = sums[c]! + channels[c]![index]! * weight;
          else lanes[c * 8 + lane] = lanes[c * 8 + lane]! + channels[c]![index]! * coefficient;
        }
        if (++work % 16384 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
      }
    }
    for (let c = 0; c < channels.length; c++) {
      if (interpolate) output[c]![i] = sums[c]! / normalization;
      else {
        const base = c * 8;
        for (let step = 4; step >= 1; step /= 2) {
          for (let lane = 0; lane < step; lane++) {
            lanes[base + lane] = lanes[base + lane]! + lanes[base + lane + step]!;
          }
        }
        output[c]![i] = lanes[base]!;
      }
    }
  }
  return output;
}

export async function convertAudioSampleFormat(
  channels: readonly (Float32Array | Float64Array)[], source: string, format: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<readonly (Float32Array | Float64Array)[]> {
  const truncate = (format === "u8" || format === "u8p") && ["u8", "u8p", "s16", "s16p", "s32", "s32p", "s64", "s64p"].includes(source);
  if (format === "dbl" || format === "dblp") return channels;
  const floating = format === "flt" || format === "fltp";
  const scale = format === "u8" || format === "u8p" ? 128 : format === "s32" || format === "s32p" ? 2147483648
    : format === "s64" || format === "s64p" ? 2 ** 63 : 32768;
  const ChannelArray = floating ? Float32Array : Float64Array;
  budget.allocateMemory((channels[0]?.length ?? 0) * channels.length * ChannelArray.BYTES_PER_ELEMENT);
  const output = channels.map(channel => new ChannelArray(channel.length));
  for (let i = 0; i < channels[0]!.length; i++) {
    if (i % 4096 === 0) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      budget.checkCpu();
    }
    for (let c = 0; c < channels.length; c++) {
      if (floating) {
        output[c]![i] = channels[c]![i]!;
        continue;
      }
      const sample = channels[c]![i]! * scale;
      // Integer PCM narrows by discarding low bits; floating PCM rounds to nearest even.
      const lower = Math.floor(sample);
      const quantized = truncate ? lower : sample - lower === 0.5
        ? lower + Math.abs(lower % 2) : Math.round(sample);
      output[c]![i] = Math.max(-scale, Math.min(scale - 1, quantized)) / scale;
    }
  }
  return output;
}
