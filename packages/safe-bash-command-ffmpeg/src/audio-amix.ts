import type { MediaBudgetTracker, MediaTrack } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function mixAudio(
  first: MediaTrack, second: MediaTrack, filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaTrack> {
  const a = first.decodedAudio;
  const b = second.decodedAudio;
  if (!a || !b) throw new Error("amix requires decoded PCM audio");
  if (a.sampleRate !== b.sampleRate || a.channels !== b.channels || a.channelMask !== b.channelMask) {
    throw new Error("amix requires matching sample rates and channel layouts");
  }
  let duration = "longest";
  let transition = 2;
  let normalize = true;
  let weights = [1, 1];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["inputs", "duration", "dropout_transition", "weights", "normalize"][index] : option.slice(0, separator);
    const value = separator < 0 ? option : option.slice(separator + 1);
    if (key === "inputs") {
      if (Number(value) !== 2) throw new Error("amix requires two inputs");
    } else if (key === "duration") {
      duration = ["longest", "shortest", "first"][Number(value)] ?? value;
      if (!value || !["longest", "shortest", "first"].includes(duration)) throw new Error("amix: invalid duration");
    } else if (key === "dropout_transition") {
      transition = Number(value);
      if (!value || !Number.isFinite(transition) || transition < 0) throw new Error("amix: invalid dropout transition");
    } else if (key === "normalize") {
      if (!["0", "1", "false", "true"].includes(value)) throw new Error("amix: invalid normalize");
      normalize = value === "1" || value === "true";
    } else if (key === "weights") {
      weights = value.replaceAll("\t", " ").split(" ").filter(Boolean).slice(0, 2).map(Number);
      if (!weights.length || weights.some(weight => !Number.isFinite(weight))) {
        throw new Error("amix: invalid weights");
      }
      if (weights.length === 1) weights.push(weights[0]!);
    } else throw new Error(`amix: unsupported option ${key}`);
  }
  const inputs = [a, b];
  const lengths = inputs.map(input => input.channelData[0]!.length);
  const length = duration === "first" ? lengths[0]! : duration === "shortest" ? Math.min(...lengths) : Math.max(...lengths);
  budget.checkSamples(length);
  budget.checkDuration(length / a.sampleRate);
  budget.allocateMemory(length * a.channels * 4);
  const channelData = a.channelData.map(() => new Float32Array(length));
  const totalWeight = weights.reduce((sum, weight) => sum + Math.abs(weight), 0);
  const scales = weights.map(weight => totalWeight / Math.abs(weight));
  // Native WAV PCM frames use the largest power of two within 100 ms.
  // amix updates normalization once per frame, including a partial frame at EOF.
  const frameSize = 2 ** Math.floor(Math.log2(Math.max(1, Math.floor(a.sampleRate / 10))));
  for (let start = 0; start < length;) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    budget.checkCpu();
    const end = Math.min(length, start + frameSize - start % frameSize,
      ...lengths.filter(inputLength => inputLength > start));
    const activeWeight = weights.reduce((sum, weight, i) => sum + (start < lengths[i]! ? Math.abs(weight) : 0), 0);
    const gains = weights.map((weight, i) => {
      if (start >= lengths[i]! || weight === 0) return 0;
      const target = activeWeight / Math.abs(weight);
      if (scales[i]! > target) {
        scales[i] = Math.max(target, Math.fround(scales[i]! -
          (totalWeight / Math.abs(weight) / 2) * (end - start) / (transition * a.sampleRate)));
      }
      return normalize ? Math.fround(Math.sign(weight) / scales[i]!) : Math.abs(weight);
    });
    for (let channel = 0; channel < a.channels; channel++) {
      for (let sample = start; sample < end; sample++) {
        if (sample % 4096 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        channelData[channel]![sample] = Math.fround((a.channelData[channel]![sample] ?? 0) * gains[0]!) +
          Math.fround((b.channelData[channel]![sample] ?? 0) * gains[1]!);
      }
    }
    start = end;
  }
  return { ...first, timescale: a.sampleRate, duration: length, samples: [], editList: undefined,
    decodedAudio: { ...a, channelData } };
}
