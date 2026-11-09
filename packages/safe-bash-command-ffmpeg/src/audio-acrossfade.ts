import type { MediaBudgetTracker, MediaTrack } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseHlsDuration } from "safe-bash-command-ffprobe/media";

export async function acrossfadeAudio(
  first: MediaTrack, second: MediaTrack, filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaTrack> {
  const a = first.decodedAudio;
  const b = second.decodedAudio;
  if (!a || !b) throw new Error("acrossfade requires decoded PCM audio");
  if (a.sampleRate !== b.sampleRate || a.channels !== b.channels || a.channelMask !== b.channelMask) {
    throw new Error("acrossfade requires matching sample rates and channel layouts");
  }
  let samples = 44100;
  let duration = 0;
  let overlap = true;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["ns", "d", "o", "c1", "c2"][index] : option.slice(0, separator);
    const value = separator < 0 ? option : option.slice(separator + 1);
    if (key === "ns" || key === "nb_samples") {
      samples = Number(value);
      if (!Number.isSafeInteger(samples) || samples < 1 || samples > 214748364) throw new Error("acrossfade: invalid sample count");
    } else if (key === "d" || key === "duration") {
      duration = parseHlsDuration(value);
      if (!value || !Number.isFinite(duration) || duration < 0) throw new Error("acrossfade: invalid duration");
    } else if (key === "o" || key === "overlap") {
      if (!["0", "1", "false", "true"].includes(value)) throw new Error("acrossfade: invalid overlap");
      overlap = value === "1" || value === "true";
    } else if (key === "c1" || key === "curve1" || key === "c2" || key === "curve2") {
      if (value !== "tri" && value !== "0") throw new Error("acrossfade: only the triangular curve is supported");
    } else throw new Error(`acrossfade: unsupported option ${key}`);
  }
  if (duration > 0) samples = Math.round(duration * a.sampleRate);
  // FFmpeg ends after the first input when a positive duration rounds to no samples.
  if (samples === 0) return first;
  const aLength = a.channelData[0]!.length;
  const bLength = b.channelData[0]!.length;
  if (samples > aLength || samples > bLength) {
    throw new Error("acrossfade: transition must fit both inputs");
  }
  const length = aLength + bLength - (overlap ? samples : 0);
  budget.checkSamples(length);
  budget.checkDuration(length / a.sampleRate);
  budget.allocateMemory(length * a.channels * 8);
  const channelData = a.channelData.map(() => new Float64Array(length));
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
      const secondValue = secondIndex < 0 ? 0 : b.channelData[channel]![secondIndex]! *
        (secondIndex >= samples ? 1 : secondIndex / samples);
      channelData[channel]![i] = firstValue + secondValue;
    }
  }
  return { ...first, timescale: a.sampleRate, duration: length, samples: [], editList: undefined,
    decodedAudio: { ...a, channelData } };
}
