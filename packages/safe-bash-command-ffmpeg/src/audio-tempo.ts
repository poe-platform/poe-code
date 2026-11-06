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
  const window = Math.min(length, hop * 2, outputLength);
  const finalPosition = outputLength - window;
  const search = Math.round(sampleRate * 0.01);
  const stride = Math.max(1, Math.floor(sampleRate / 4000));
  let work = 0;
  for (let c = 0; c < channels.length; c++) {
    const start = finalPosition === 0 ? length - window : 0;
    output[c]!.set(channels[c]!.subarray(start, start + window));
  }
  let previousPosition = 0;
  while (previousPosition < finalPosition) {
    const position = Math.min(previousPosition + hop, finalPosition);
    await yieldTurn(signal);
    signal?.throwIfAborted();
    budget.checkCpu();
    // Anchor the last complete window to the input tail. A truncated window
    // can otherwise omit trailing audio entirely, especially on short clips.
    const final = position === finalPosition;
    const expected = final ? length - window : Math.min(length - window, Math.round(position * tempo));
    const start = final ? expected : Math.max(0, expected - search);
    const end = final ? expected : Math.min(length - window, expected + search);
    const overlap = window - (position - previousPosition);
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
      for (let i = 0; i < window; i++) {
        const sample = channels[c]![best + i]!;
        const weight = Math.min(1, i / overlap);
        output[c]![position + i] = output[c]![position + i]! * (1 - weight) + sample * weight;
      }
    }
    previousPosition = position;
  }
  return output;
}
