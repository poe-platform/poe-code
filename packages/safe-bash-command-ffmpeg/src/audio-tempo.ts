import { yieldTurn } from "safe-bash-contracts/yield";
import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { parseFilterExpression } from "./filter-expression.js";

export function parseTempo(argument: string): number {
  let tempo = 1;
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? (index === 0 ? "tempo" : "") : option.slice(0, separator).trim();
    if (key === "enable") throw new Error("atempo: timeline is unsupported");
    if (key !== "tempo") throw new Error("atempo: unknown option");
    tempo = parseFilterExpression(separator < 0 ? option : option.slice(separator + 1), "atempo", {});
    if (tempo < 0.5 || tempo > 100) {
      throw new RangeError("atempo: must be in the range [0.5, 100]");
    }
  }
  return tempo;
}

// FFmpeg aligns overlapping windows and feathers them
// with a Hann window. Alignment can change the number of emitted samples.
export async function filterTempo(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, tempo: number, sampleFormat: string, frameSize: number,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<readonly (Float32Array | Float64Array)[]> {
  // Unblended samples retain the input format's precision.
  const SampleArray = sampleFormat === "dbl" || sampleFormat === "dblp" ? Float64Array : Float32Array;
  const length = channels[0]?.length ?? 0;
  const window = 2 ** Math.ceil(Math.log2(Math.max(2, Math.floor(sampleRate / 24))));
  const hop = window / 2;
  if (length < hop) return channels.map(() => new SampleArray(0));
  const hann = Float32Array.from({ length: window }, (_, i) => (1 - Math.cos(2 * Math.PI * i / (window - 1))) / 2);
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    if (i % 16384 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
    for (const channel of channels) {
      const sample = sampleFormat === "u8" ? channel[i]! * 128 + 128 : channel[i]!;
      // Unsigned channel magnitudes saturate at 127 when choosing the dominant channel.
      if (sampleFormat === "u8" ? Math.min(sample, 127) > Math.min(mono[i]!, 127)
        : Math.abs(sample) > Math.abs(mono[i]!)) mono[i] = sample;
    }
  }
  const output = channels.map(() => [] as number[]);
  let previous = -hop;
  let position = -hop;
  let work = 0;
  let flushing = false;
  while (true) {
    let current = previous + Math.trunc(hop * tempo);
    position += hop;
    const drift = Math.trunc(position * tempo - (previous + hop));
    const start = Math.min(window, Math.max(0, -drift));
    const end = Math.max(0, Math.min(window - drift, window - window / 16));
    // A complete fragment still advances at exact EOF. If alignment pushes
    // its reload past EOF, native flushing aligns that partial fragment again.
    for (let attempt = 0; attempt < 2; attempt++) {
      flushing ||= current + window > length;
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
      if (flushing || current + window <= length) break;
    }
    const count = Math.max(0, Math.min(window, length - current));
    const overlap = Math.min(hop, count, length - previous - hop);
    // At EOF a destination frame that fills before the overlap finishes stops
    // fragment advancement. Flush its tail; otherwise continue the overlap chain.
    const emitted = output[0]?.length ?? 0;
    const frameFull = emitted > 0 && emitted % frameSize === 0
      || frameSize - emitted % frameSize < overlap;
    const final = (flushing || frameFull) && current + count >= length;
    for (let c = 0; c < channels.length; c++) {
      const channel = channels[c]!;
      const dst = output[c]!;
      for (let i = 0; i < overlap; i++) {
        // Native u8 alignment and blending use unsigned bytes, including zero padding.
        const a = sampleFormat === "u8" ? (channel[previous + hop + i] ?? -1) * 128 + 128 : channel[previous + hop + i] ?? 0;
        const b = sampleFormat === "u8" ? (channel[current + i] ?? -1) * 128 + 128 : channel[current + i] ?? 0;
        // Native converts inputs and both products to float before adding, then truncates PCM16
        // toward zero rather than using the WAV encoder's rounding.
        const sample = current + i < 0 ? a : Math.fround(Math.fround(Math.fround(a) * hann[hop + i]!) + Math.fround(Math.fround(b) * hann[i]!));
        dst.push(sampleFormat === "u8" ? Math.trunc(sample) / 128 - 1
          : sampleFormat === "s16" ? Math.trunc(sample * 32768) / 32768 : sample);
      }
      if (final) {
        for (let i = overlap; i < count; i++) dst.push(channel[current + i] ?? 0);
      }
    }
    budget.checkDuration((output[0]?.length ?? 0) / sampleRate);
    if (final) break;
    previous = current;
  }
  return output.map(channel => SampleArray.from(channel));
}
