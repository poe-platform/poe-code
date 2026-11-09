import type { MediaBudgetTracker, MediaTrack } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { resampleAudio } from "./audio-resample.js";
import { parseFilterExpression } from "./filter-expression.js";
import { parseFilterBoolean } from "./filter-boolean.js";

export async function mixAudio(
  first: MediaTrack, second: MediaTrack, filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaTrack> {
  const a = first.decodedAudio;
  let b = second.decodedAudio;
  if (!a || !b) throw new Error("amix requires decoded PCM audio");
  if (a.channels !== b.channels || a.channelMask !== b.channelMask) {
    throw new Error("amix requires matching channel layouts");
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
      const inputs = parseFilterExpression(value, "amix", {});
      // Native integer options round to nearest, with halfway values going to even.
      const rounded = inputs % 1 === 0.5 ? 2 * Math.round(inputs / 2) : Math.round(inputs);
      if (rounded !== 2) throw new Error("amix requires two inputs");
    } else if (key === "duration") {
      const numeric = parseFilterExpression(value, "amix", { longest: 0, shortest: 1, first: 2 });
      if (numeric < 0 || numeric > 2) throw new Error("amix: invalid duration");
      const rounded = numeric % 1 === 0.5 ? 2 * Math.round(numeric / 2) : Math.round(numeric);
      duration = ["longest", "shortest", "first"][rounded]!;
    } else if (key === "dropout_transition") {
      transition = parseFilterExpression(value, "amix", {});
      if (transition < 0 || transition > 2147483647) throw new Error("amix: invalid dropout transition");
      transition = Math.fround(transition);
    } else if (key === "normalize") {
      normalize = parseFilterBoolean(value, "amix: invalid normalize");
    } else if (key === "weights") {
      weights = parseWeights(value);
    } else throw new Error(`amix: unsupported option ${key}`);
  }
  if (a.sampleRate !== b.sampleRate) {
    const length = Math.ceil(b.channelData[0]!.length * a.sampleRate / b.sampleRate);
    budget.checkSamples(length);
    budget.checkDuration(length / a.sampleRate);
    budget.allocateMemory(length * b.channels * Float32Array.BYTES_PER_ELEMENT);
    b = { ...b, sampleRate: a.sampleRate,
      channelData: await resampleAudio(b.channelData, length, b.sampleRate, a.sampleRate, budget, signal) };
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
      // Zero total weight must retain the native 0/0 normalization and NaN samples.
      if (start >= lengths[i]!) return 0;
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

function parseWeights(source: string): number[] {
  const weights: number[] = [];
  let offset = 0;
  while (weights.length < 2) {
    const start = offset;
    while (source[offset] && " \t\n\r\v\f".includes(source[offset]!)) offset++;
    const numberStart = offset;
    if (source[offset] === "+" || source[offset] === "-") offset++;
    const hexadecimal = source.slice(offset, offset + 2).toLowerCase() === "0x";
    // av_strtod uses strtoul for a leading 0x, otherwise strtod (including signed hex floats).
    const hexInteger = hexadecimal && start === offset;
    if (hexadecimal) offset += 2;
    let digits = 0;
    let fractionDigits = 0;
    let fraction = false;
    let value = 0;
    for (; offset < source.length; offset++) {
      const character = source[offset]!.toLowerCase();
      const digit = "0123456789abcdef".indexOf(character);
      if (digit >= 0 && digit < (hexadecimal ? 16 : 10)) {
        value = value * (hexadecimal ? 16 : 10) + digit;
        digits++;
        if (fraction) fractionDigits++;
      } else if (character === "." && !fraction && !hexInteger) fraction = true;
      else break;
    }
    if (!digits) throw new Error("amix: invalid weights");
    if (hexadecimal) {
      value /= 16 ** fractionDigits;
      if (source[numberStart] === "-") value = -value;
    }
    const exponentMarker = hexadecimal ? "p" : "e";
    if (!hexInteger && source[offset]?.toLowerCase() === exponentMarker) {
      let end = offset + 1;
      if (source[end] === "+" || source[end] === "-") end++;
      const exponentStart = end;
      while (source[end] && source[end]! >= "0" && source[end]! <= "9") end++;
      if (end > exponentStart) {
        if (hexadecimal) value *= 2 ** Number(source.slice(offset + 1, end));
        offset = end;
      }
    }
    if (!hexadecimal) value = Number(source.slice(numberStart, offset));
    // Numeric prefixes and suffixes follow av_strtod, not AVOption expressions.
    if (source.startsWith("dB", offset)) {
      value = 10 ** (value / 20);
      offset += 2;
    } else {
      const exponents: Record<string, number> = { y: -24, z: -21, a: -18, f: -15, p: -12, n: -9, u: -6, m: -3, c: -2, d: -1, h: 2, k: 3, K: 3, M: 6, G: 9, T: 12, P: 15, E: 18, Z: 21, Y: 24 };
      const exponent = exponents[source[offset]!];
      if (exponent !== undefined) {
        offset++;
        const binary = source[offset] === "i";
        value *= binary ? 2 ** (exponent / 0.3) : 10 ** exponent;
        if (binary) offset++;
      }
    }
    if (source[offset] === "B") {
      value *= 8;
      offset++;
    }
    value = Math.fround(value);
    if (!Number.isFinite(value)) throw new Error("amix: invalid weights");
    weights.push(value);
    if (offset === source.length) {
      if (weights.length === 1) weights.push(value);
      break;
    }
    // amix skips exactly one separator, even when it is not whitespace.
    offset++;
  }
  return weights;
}
