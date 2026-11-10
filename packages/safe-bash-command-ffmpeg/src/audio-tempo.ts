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
