import { yieldTurn } from "safe-bash-contracts/yield";
import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { parseFilterExpression } from "./filter-expression.js";

// Scheduled updates must retain both WSOLA fragments and the partially filled
// output frame: a command can arrive between loading and emitting a fragment.
export async function filterScheduledTempo(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, sampleFormat: string,
  tempo: number, commands: readonly { sample: number; expression: string }[],
  frames: readonly { start: number; end: number; pts: number }[], budget: MediaBudgetTracker, signal?: AbortSignal, frameLimit?: number
): Promise<{ channels: readonly (Float32Array | Float64Array)[]; frames: { start: number; end: number; pts: number; inputEnd: number }[] }> {
  // Unblended samples retain the input format's precision.
  const SampleArray = sampleFormat === "dbl" || sampleFormat === "dblp" ? Float64Array : Float32Array;
  const length = channels[0]?.length ?? 0;
  const window = 2 ** Math.ceil(Math.log2(Math.max(2, Math.floor(sampleRate / 24))));
  const hop = window / 2;
  budget.allocateMemory((length + window) * 4);
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
  const outputFrames: { start: number; end: number; pts: number; inputEnd: number }[] = [];
  let frameStart = 0;
  let previous = { input: 0, output: 0, count: 0 };
  let current = { input: -hop, output: -hop, count: 0 };
  let fragments = 0;
  let consumed = 0;
  let inputEnd = 0;
  let emitted = 0;
  let destinationEnd = 0;
  let originInput = 0;
  let originOutput = 0;
  let nextCommand = 0;
  let work = 0;
  let state: "load" | "align" | "reload" | "overlap" = "load";
  const pushFrame = () => {
    if (emitted > frameStart) {
      budget.allocateMemory(32);
      outputFrames.push({ start: frameStart, end: emitted, pts: (frames[0]?.pts ?? 0) + frameStart, inputEnd });
      frameStart = emitted;
    }
    destinationEnd = emitted;
  };
  const advance = () => {
    previous = current;
    current = { input: previous.input + Math.trunc(tempo * hop), output: previous.output + hop, count: 0 };
    fragments++;
    state = "load";
  };
  const load = (end: number, flushing = false) => {
    const stop = current.input + window;
    consumed = Math.max(consumed, Math.min(end, stop));
    if (!flushing && consumed < stop) return false;
    current.count = Math.max(0, Math.min(window, consumed - current.input));
    return true;
  };
  const align = async () => {
    const drift = Math.trunc((previous.output - originOutput + hop) * tempo - (previous.input - originInput + hop));
    const start = Math.min(window, Math.max(0, -drift));
    const end = Math.max(0, Math.min(window - drift, window - window / 16));
    let correction = -drift;
    let best = -Infinity;
    for (let lag = start; lag < end; lag++) {
      let correlation = 0;
      for (let j = Math.max(0, -current.input); j < Math.min(current.count, previous.count - lag); j++) {
        correlation += (mono[previous.input + j + lag] ?? 0) * mono[current.input + j]!;
        if (++work % 16384 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      }
      const metric = correlation * (drift + lag) * (lag - start) * (end - lag);
      if (metric > best) { best = metric; correction = lag - hop; }
    }
    if (correction) { current.input -= correction; current.count = 0; }
    return correction;
  };
  const emit = (end: number, blend: boolean) => {
    const stop = Math.min(end, destinationEnd);
    const count = Math.max(0, stop - emitted);
    budget.checkDuration(stop / sampleRate);
    budget.allocateMemory(count * channels.length * 12);
    for (let c = 0; c < channels.length; c++) {
      const channel = channels[c]!;
      const dst = output[c]!;
      for (let position = emitted; position < stop; position++) {
        const aIndex = position - previous.output;
        const bIndex = position - current.output;
        // Keep the unsigned byte origin through blending, then normalize the result.
        const a = sampleFormat === "u8" ? (channel[previous.input + aIndex] ?? -1) * 128 + 128 : channel[previous.input + aIndex] ?? 0;
        const b = sampleFormat === "u8" ? (channel[current.input + bIndex] ?? -1) * 128 + 128 : channel[current.input + bIndex] ?? 0;
        // FFmpeg 7 converts inputs and each product to float before summing and truncating PCM16.
        const sample = !blend ? b : current.input + position - emitted < 0 ? a
          : Math.fround(Math.fround(Math.fround(a) * hann[aIndex]!) + Math.fround(Math.fround(b) * hann[bIndex]!));
        dst.push(sampleFormat === "u8" ? Math.trunc(sample) / 128 - 1
          : blend && sampleFormat === "s16" ? Math.trunc(sample * 32768) / 32768 : sample);
      }
    }
    emitted = stop;
  };
  input: for (const frame of frames) {
    // The upstream filter has processed this entire frame, even while part of it is buffered.
    inputEnd = frame.end;
    while (nextCommand < commands.length && commands[nextCommand]!.sample <= frame.start) {
      const command = commands[nextCommand++]!;
      try {
        const value = parseFilterExpression(command.expression, "atempo", {});
        if (value < 0.5 || value > 100) continue;
        tempo = value;
        originInput = previous.input + hop;
        originOutput = previous.output + hop;
      } catch { /* Native keeps the last valid tempo after a rejected command. */ }
    }
    const frameSize = Math.max(1, Math.round((frame.end - frame.start) / tempo));
    while (consumed < frame.end) {
      if (destinationEnd === emitted) destinationEnd = emitted + frameSize;
      while (true) {
        if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        if (state === "load") {
          if (!load(frame.end)) break;
          if (!fragments) { advance(); continue; }
          state = "align";
        }
        if (state === "align") state = await align() ? "reload" : "overlap";
        if (state === "reload") {
          if (!load(frame.end)) break;
          state = "overlap";
        }
        const end = Math.min(previous.output + previous.count, current.output + current.count);
        emit(end, true);
        if (emitted < end) break;
        advance();
      }
      if (destinationEnd === emitted) {
        pushFrame();
        if (outputFrames.length === frameLimit) break input;
      }
    }
  }
  // At EOF a partially loaded fragment is aligned again before the final
  // overlap. Once it reaches the input tail, copy its remaining samples.
  while (fragments && outputFrames.length !== frameLimit) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    if (consumed === current.input + current.count && emitted === current.output + current.count) break;
    if (destinationEnd === emitted) destinationEnd = emitted + window * 3;
    if (current.input + current.count < consumed) {
      load(consumed, true);
      if (await align()) load(consumed, true);
    }
    const overlapEnd = current.output + Math.min(hop, current.count);
    if (emitted < overlapEnd) {
      emit(Math.min(previous.output + previous.count, current.output + current.count), true);
      if (emitted < overlapEnd) { pushFrame(); continue; }
    }
    if (current.input + current.count < consumed) { advance(); pushFrame(); continue; }
    emit(current.output + current.count, false);
    pushFrame();
    if (emitted === current.output + current.count) break;
  }
  pushFrame();
  return { channels: output.map(channel => SampleArray.from(channel)), frames: outputFrames };
}
