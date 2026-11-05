import { yieldTurn } from "safe-bash-contracts/yield";
import type { MediaBudgetTracker } from "@poe-code/mp4-ast";

// Waveform-similarity overlap-add: move whole PCM windows along the input
// timeline, aligning their overlap instead of changing the playback rate.
export async function stretchAudio(
  channels: readonly Float32Array[], sampleRate: number, tempo: number,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<readonly Float32Array[]> {
  const length = channels[0]?.length ?? 0;
  if (tempo === 1 || length === 0) return channels;
  const outputLength = Math.max(1, Math.round(length / tempo));
  budget.checkDuration(outputLength / sampleRate);
  const output = channels.map(() => new Float32Array(outputLength));
  if (length === 1) return output.map((channel, c) => channel.fill(channels[c]![0]!));
  const hop = Math.max(1, Math.min(Math.floor(length / 2), Math.round(sampleRate * 0.02)));
  const window = Math.min(length, hop * 2);
  const search = Math.round(sampleRate * 0.01);
  const stride = Math.max(1, Math.floor(sampleRate / 4000));
  let work = 0;
  for (let c = 0; c < channels.length; c++) {
    output[c]!.set(channels[c]!.subarray(0, Math.min(window, outputLength)));
  }
  for (let position = hop; position < outputLength; position += hop) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    budget.checkCpu();
    const expected = Math.min(length - window, Math.round(position * tempo));
    const start = Math.max(0, expected - search);
    const end = Math.min(length - window, expected + search);
    const overlap = Math.min(hop, outputLength - position);
    let best = expected;
    let bestError = Infinity;
    for (let candidate = start; candidate <= end; candidate++) {
      let error = 0;
      for (let c = 0; c < channels.length; c++) {
        for (let i = 0; i < overlap; i += stride) {
          const difference = output[c]![position + i]! - channels[c]![candidate + i]!;
          error += difference * difference;
          if (++work % 16384 === 0) {
            await yieldTurn(signal);
            signal?.throwIfAborted();
            budget.checkCpu();
          }
        }
      }
      if (error < bestError || (error === bestError && Math.abs(candidate - expected) < Math.abs(best - expected))) {
        bestError = error;
        best = candidate;
      }
    }
    // Use the same alignment for every channel, including opposite-phase stereo.
    for (let c = 0; c < channels.length; c++) {
      for (let i = 0; i < Math.min(window, outputLength - position); i++) {
        const sample = channels[c]![best + i]!;
        const weight = Math.min(1, i / hop);
        output[c]![position + i] = output[c]![position + i]! * (1 - weight) + sample * weight;
      }
    }
  }
  return output;
}
