import type { MediaBudgetTracker, MediaSample, MediaTrack } from "@poe-code/mp4-ast";
import { resampleAudio } from "./audio-resample.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterBoolean } from "./filter-boolean.js";
import { parseFilterExpression } from "./filter-expression.js";
import { parseHlsDuration } from "safe-bash-command-ffprobe/media";

export async function acrossfadeAudio(
  first: MediaTrack, second: MediaTrack, filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaTrack> {
  const a = first.decodedAudio;
  const b = second.decodedAudio;
  if (!a || !b) throw new Error("acrossfade requires decoded PCM audio");
  if (a.channels !== b.channels || a.channelMask !== b.channelMask) {
    throw new Error("acrossfade requires matching channel layouts");
  }
  let samples = 44100;
  let duration = 0;
  let overlap = true;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["ns", "d", "o", "c1", "c2"][index] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "ns" || key === "nb_samples") {
      samples = parseFilterExpression(value, "acrossfade", {});
      if (samples < 1 || samples > 214748364) throw new Error("acrossfade: invalid sample count");
      // Native integer options validate bounds before rounding ties to even.
      const floor = Math.floor(samples);
      samples = samples - floor === 0.5 ? floor + floor % 2 : Math.round(samples);
    } else if (key === "d" || key === "duration") {
      duration = parseHlsDuration(value);
      if (!value || !Number.isFinite(duration) || duration < 0) throw new Error("acrossfade: invalid duration");
    } else if (key === "o" || key === "overlap") {
      overlap = parseFilterBoolean(value, "acrossfade: invalid overlap");
    } else if (key === "c1" || key === "curve1" || key === "c2" || key === "curve2") {
      if (parseFilterExpression(value, "acrossfade", { tri: 0 }) !== 0) throw new Error("acrossfade: only the triangular curve is supported");
    } else throw new Error(`acrossfade: unsupported option ${key}`);
  }
  if (duration > 0) samples = Math.round(duration * a.sampleRate);
  // FFmpeg ends after the first input when a positive duration rounds to no samples.
  if (samples === 0) return first;
  let secondChannels = b.channelData;
  const ratio = a.sampleRate / b.sampleRate;
  if (ratio !== 1) {
    const resampledLength = Math.ceil(b.channelData[0]!.length * ratio);
    budget.checkSamples(resampledLength);
    budget.checkDuration(resampledLength / a.sampleRate);
    budget.allocateMemory(resampledLength * b.channels * Float32Array.BYTES_PER_ELEMENT);
    secondChannels = await resampleAudio(b.channelData, resampledLength, b.sampleRate, a.sampleRate, budget, signal);
  }
  const aLength = a.channelData[0]!.length;
  const bLength = secondChannels[0]!.length;
  if (samples < 1) throw new Error("acrossfade: invalid sample count");
  // FFmpeg 7 ends before the transition if either input cannot fill it.
  const length = samples > aLength || samples > bLength
    ? Math.max(0, aLength - samples)
    : aLength + bLength - (overlap ? samples : 0);
  budget.checkSamples(length);
  budget.checkDuration(length / a.sampleRate);
  budget.allocateMemory(length * a.channels * 8);
  const channelData = a.channelData.map(() => new Float64Array(length));
  const pcm16 = [first, second].every(track =>
    ["pcm_s16le", "pcm_s16be"].includes(track.codecDescriptions[0]?.codecName ?? ""));
  for (let i = 0; i < length; i++) {
    if (i % 4096 === 0) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      budget.checkCpu();
    }
    for (let channel = 0; channel < a.channels; channel++) {
      const transition = i - (aLength - samples);
      const secondIndex = i - (overlap ? aLength - samples : aLength);
      const firstValue = i >= aLength ? 0 : a.channelData[channel]![i]! *
        (transition < 0 ? 1 : (samples - 1 - transition) / samples);
      const secondSample = secondIndex < 0 ? 0 : secondChannels[channel]![secondIndex]!;
      // Automatic rate conversion negotiates S16 before the fade's truncating cast.
      const secondValue = (pcm16 && ratio !== 1
        ? Math.max(-32768, Math.min(32767, Math.round(secondSample * 32768))) / 32768
        : secondSample) *
        (secondIndex >= samples ? 1 : secondIndex / samples);
      // Native S16 fades cast the mixed sample to int16 before encoding.
      const value = firstValue + secondValue;
      channelData[channel]![i] = pcm16 ? Math.trunc(value * 32768) / 32768 : value;
    }
  }
  const frames: MediaSample[] = [];
  let pts = 0;
  function appendFrame(count: number): void {
    if (count <= 0) return;
    budget.allocateMemory(96);
    frames.push({ data: new Uint8Array(0), size: 0, dts: pts, pts, cts: 0,
      duration: count, isKeyframe: true, sampleDescriptionIndex: 1 });
    pts += count;
  }
  // Both inputs are already buffered: emit the first input before the fade,
  // then one transition frame (two separate fades when overlap is disabled).
  appendFrame(aLength - samples);
  appendFrame(samples);
  if (!overlap) appendFrame(samples);
  // Consuming the transition can split a second-input frame. Preserve its
  // remainder and every following frame instead of regrouping the PCM.
  const filterLength = 2 * Math.ceil(16 / Math.min(0.97 * ratio, 1));
  let emitted = 0;
  for (let start = 0, n = 0; start < b.channelData[0]!.length; n++) {
    if (n % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
    const packet = second.samples[n];
    const count = packet ? Math.max(0, Math.round(packet.duration * b.sampleRate / second.timescale)
      - (packet.skipSamples ?? 0) - (packet.discardPadding ?? 0)) : 1024;
    start = Math.min(b.channelData[0]!.length, start + count);
    if (ratio !== 1 && start <= filterLength) continue;
    const end = Math.min(bLength, Math.max(0, Math.ceil((start - (ratio === 1 ? 0 : filterLength / 2)) * ratio)));
    appendFrame(end - Math.max(emitted, samples));
    emitted = end;
  }
  appendFrame(bLength - Math.max(emitted, samples));
  return { ...first, timescale: a.sampleRate, duration: length, samples: frames, editList: undefined,
    decodedAudio: { ...a, channelData } };
}
