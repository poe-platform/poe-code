import { yieldTurn } from "safe-bash-contracts/yield";
import type { MediaBudgetTracker } from "@poe-code/mp4-ast";

// FFmpeg aligns overlapping windows and feathers them
// with a Hann window. Alignment can change the number of emitted samples.
export async function filterTempo(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, tempo: number, pcm16: boolean,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<readonly Float32Array[]> {
  const length = channels[0]?.length ?? 0;
  const window = 2 ** Math.ceil(Math.log2(Math.max(2, Math.floor(sampleRate / 24))));
  const hop = window / 2;
  if (length < hop) return channels.map(() => new Float32Array(0));
  const hann = Float32Array.from({ length: window }, (_, i) => (1 - Math.cos(2 * Math.PI * i / (window - 1))) / 2);
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    if (i % 16384 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
    for (const channel of channels) {
      if (Math.abs(channel[i]!) > Math.abs(mono[i]!)) mono[i] = channel[i]!;
    }
  }
  const output = channels.map(() => [] as number[]);
  let previous = -hop;
  let position = -hop;
  let work = 0;
  while (true) {
    let current = previous + Math.trunc(hop * tempo);
    position += hop;
    const drift = Math.trunc(position * tempo - (previous + hop));
    const start = Math.min(window, Math.max(0, -drift));
    const end = Math.max(0, Math.min(window - drift, window - window / 16));
    let correction = -drift;
    let best = -Infinity;
    // Cross-correlate the dominant channel of successive fragments, then
    // weight peaks by drift and distance from the search boundaries.
    for (let lag = start; lag < end; lag++) {
      let correlation = 0;
      for (let j = Math.max(0, -current); j < Math.min(window - lag, length - current, length - previous - lag); j++) {
        correlation += (mono[previous + j + lag] ?? 0) * mono[current + j]!;
        if (++work % 16384 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      }
      const metric = correlation * (drift + lag) * (lag - start) * (end - lag);
      if (metric > best) { best = metric; correction = lag - hop; }
    }
    current -= correction;
    const count = Math.max(0, Math.min(window, length - current));
    const overlap = Math.min(hop, count, length - previous - hop);
    for (let c = 0; c < channels.length; c++) {
      const channel = channels[c]!;
      const dst = output[c]!;
      for (let i = 0; i < overlap; i++) {
        const a = channel[previous + hop + i] ?? 0;
        const b = channel[current + i] ?? 0;
        // Match native float blending (fused multiply-add) and PCM16's
        // truncation toward zero, rather than the WAV encoder's rounding.
        const sample = current + i < 0 ? a : Math.fround(a * hann[hop + i]! + Math.fround(b * hann[i]!));
        dst.push(pcm16 ? Math.trunc(sample * 32768) / 32768 : sample);
      }
      if (current + count >= length) {
        for (let i = overlap; i < count; i++) dst.push(channel[current + i] ?? 0);
      }
    }
    budget.checkDuration((output[0]?.length ?? 0) / sampleRate);
    if (current + count >= length) break;
    previous = current;
  }
  return output.map(channel => Float32Array.from(channel));
}

// Waveform-similarity overlap-add: move whole PCM windows along the input
// timeline, aligning their overlap instead of changing the playback rate.
export async function stretchAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, tempo: number,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<readonly (Float32Array | Float64Array)[]> {
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
