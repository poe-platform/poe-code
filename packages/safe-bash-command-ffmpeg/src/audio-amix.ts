import type { MediaBudgetTracker, MediaSample, MediaTrack } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { resampleAudio } from "./audio-resample.js";
import { parseFilterExpression } from "./filter-expression.js";
import { parseFilterBoolean } from "./filter-boolean.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";

export async function mixAudio(
  tracks: MediaTrack[], filter: string, budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { action: string; expression: string }[] = []
): Promise<MediaTrack> {
  const inputs = tracks.map(track => {
    if (!track.decodedAudio) throw new Error("amix requires decoded PCM audio");
    return track.decodedAudio;
  });
  const a = inputs[0];
  if (!a) throw new Error("amix requires decoded PCM audio");
  const layouts = inputs.map(input => input.channelMask ||
    (input.channels === 1 ? 4 : input.channels === 2 ? 3 : input.channels === 6 ? 0x3f : undefined));
  const remix = inputs.map((input, index) => input.channels !== a.channels &&
    [layouts[0], layouts[index]].every(layout => layout === 4 || layout === 3 || layout === 0x3f || layout === 0x60f));
  // Single-channel inputs mix at unity regardless of their speaker labels.
  if (inputs.some((input, index) => !remix[index] &&
    (input.channels !== a.channels || input.channels > 1 && layouts[index] !== layouts[0]))) {
    throw new Error("amix requires matching channel layouts");
  }
  let count = 2;
  let duration = "longest";
  let transition = 2;
  let normalize = true;
  let weights = [1];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const options = argument ? argument.split(":") : [];
  if (options.at(-1) === "") options.pop();
  for (const [index, option] of options.entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["inputs", "duration", "dropout_transition", "weights", "normalize"][index] : option.slice(0, separator);
    const value = separator < 0 ? option : option.slice(separator + 1);
    if (key === "inputs") {
      const numeric = parseFilterExpression(value, "amix", {});
      if (numeric < 1 || numeric > 32767) throw new RangeError("amix: invalid inputs");
      // Native integer options round to nearest, with halfway values going to even.
      count = numeric % 1 === 0.5 ? 2 * Math.round(numeric / 2) : Math.round(numeric);
    } else if (key === "duration") {
      const numeric = parseFilterExpression(value, "amix", { longest: 0, shortest: 1, first: 2, max: 2, default: 0 });
      if (numeric < 0 || numeric > 2) throw new RangeError("amix: invalid duration");
      const rounded = numeric % 1 === 0.5 ? 2 * Math.round(numeric / 2) : Math.round(numeric);
      duration = ["longest", "shortest", "first"][rounded]!;
    } else if (key === "dropout_transition") {
      transition = parseFilterExpression(value, "amix", {});
      if (transition < 0 || transition > 2147483647) throw new RangeError("amix: invalid dropout transition");
      transition = Math.fround(transition);
    } else if (key === "normalize") {
      normalize = parseFilterBoolean(value, "amix: invalid normalize");
    } else if (key === "weights") {
      weights = parseWeights(value, tracks.length);
    } else if (key === "threads" || key === "thread_type" || key === "extra_hw_frames") {
      validateWeaveGenericOption(key, value, "amix");
    } else throw new Error(`amix: unsupported option ${key}`);
  }
  if (count !== inputs.length) throw new Error("amix: inputs must match the number of connected inputs");
  // Apply commands delivered while upstream inputs were buffered, before mixing.
  // Failed runtime commands leave the current options in place.
  for (const command of commands) {
    try {
      if (command.action === "normalize") normalize = parseFilterBoolean(command.expression, "amix: invalid normalize");
      else if (command.action === "weights") weights = parseWeights(command.expression, count);
    } catch { /* FFmpeg reports a declined command without aborting the graph. */ }
  }
  while (weights.length < count) weights.push(weights[weights.length - 1]!);
  for (const [index, input] of inputs.entries()) {
    if (input.sampleRate === a.sampleRate) continue;
    const length = Math.ceil(input.channelData[0]!.length * a.sampleRate / input.sampleRate);
    budget.checkSamples(length);
    budget.checkDuration(length / a.sampleRate);
    budget.allocateMemory(length * input.channels * Float32Array.BYTES_PER_ELEMENT);
    inputs[index] = { ...input, sampleRate: a.sampleRate,
      channelData: await resampleAudio(input.channelData, length, input.sampleRate, a.sampleRate, budget, signal) };
  }
  const lengths = inputs.map(input => input.channelData[0]!.length);
  const length = duration === "first" ? lengths[0]! : duration === "shortest" ? Math.min(...lengths) : Math.max(...lengths);
  budget.checkSamples(length);
  budget.checkDuration(length / a.sampleRate);
  budget.allocateMemory(length * a.channels * 4);
  const channelData = a.channelData.map(() => new Float32Array(length));
  const frames: MediaSample[] = [];
  const totalWeight = weights.reduce((sum, weight) => sum + Math.abs(weight), 0);
  const scales = weights.map(weight => totalWeight / Math.abs(weight));
  const packetIndices = tracks.map(() => 0);
  const frameEnds = tracks.map(() => 0);
  const fallbackFrameSize = 2 ** Math.floor(Math.log2(Math.max(1, Math.floor(a.sampleRate / 10))));
  const startPts = Math.round((tracks[0]!.samples[0]?.pts ?? 0) * a.sampleRate / tracks[0]!.timescale);
  for (let start = 0; start < length;) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    budget.checkCpu();
    for (const [index, track] of tracks.entries()) {
      if (start >= lengths[index]!) continue;
      while (frameEnds[index]! <= start) {
        const packet = track.samples[packetIndices[index]!++];
        frameEnds[index]! += packet
          ? Math.max(0, Math.round(packet.duration * a.sampleRate / track.timescale)
            - Math.round(((packet.skipSamples ?? 0) + (packet.discardPadding ?? 0)) * a.sampleRate / track.decodedAudio!.sampleRate))
          : fallbackFrameSize;
      }
    }
    // The first input sets the mixer frames until EOF; then drain the remaining inputs.
    // Split at input EOF so normalization recovers over the actual partial frame.
    const frameEnd = start < lengths[0]! ? frameEnds[0]!
      : Math.min(...frameEnds.filter((_, index) => start < lengths[index]!));
    const end = Math.min(length, frameEnd, ...lengths.filter(inputLength => inputLength > start));
    const activeWeight = weights.reduce((sum, weight, i) => sum + (start < lengths[i]! ? Math.abs(weight) : 0), 0);
    const gains = weights.map((weight, i) => {
      // Zero total weight must retain the native 0/0 normalization and NaN samples.
      if (start >= lengths[i]!) return 0;
      const target = activeWeight / Math.abs(weight);
      if (scales[i]! > target) {
        scales[i] = Math.max(target, Math.fround(scales[i]! -
          (totalWeight / Math.abs(weight) / count) * (end - start) / (transition * a.sampleRate)));
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
        let mixed = 0;
        for (let input = 0; input < count; input++) {
          const audio = inputs[input]!;
          let value = audio.channelData[remix[input] ? 0 : channel]![sample] ?? 0;
          if (remix[input]) {
            // FFmpeg remixes in float with equal-power gains, without PCM clipping.
            if (a.channels === 6) {
              value = audio.channels === 1 ? (channel === 2 ? value : 0)
                : channel < 2 ? (audio.channelData[channel]![sample] ?? 0) : 0;
            } else if (a.channels === 2 && audio.channels === 6) {
              // Front left/right stay at unity; center and the matching surround are -3 dB.
              value = Math.fround((audio.channelData[channel]![sample] ?? 0) +
                Math.fround((audio.channelData[2]![sample] ?? 0) * Math.fround(Math.SQRT1_2)));
              value = Math.fround(value +
                Math.fround((audio.channelData[channel + 4]![sample] ?? 0) * Math.fround(Math.SQRT1_2)));
            } else {
              value = Math.fround(value * Math.fround(Math.SQRT1_2));
              if (audio.channels >= 2) value = Math.fround(value +
                Math.fround((audio.channelData[1]![sample] ?? 0) * Math.fround(Math.SQRT1_2)));
              if (audio.channels === 6) {
                value = Math.fround(value + (audio.channelData[2]![sample] ?? 0));
                // Center is unity, surrounds are -6 dB, and LFE is excluded.
                for (let surround = 4; surround < 6; surround++) value = Math.fround(value +
                  Math.fround((audio.channelData[surround]![sample] ?? 0) * 0.5));
              }
            }
          }
          mixed = Math.fround(mixed + Math.fround(value * gains[input]!));
        }
        channelData[channel]![sample] = mixed;
      }
    }
    // Keep the mixer frames for every downstream filter, including partial EOF frames.
    budget.allocateMemory(96);
    frames.push({ data: new Uint8Array(0), size: 0, dts: startPts + start, pts: startPts + start, cts: 0,
      duration: end - start, isKeyframe: true, sampleDescriptionIndex: 1 });
    start = end;
  }
  return { ...tracks[0]!, timescale: a.sampleRate, duration: length, samples: frames, editList: undefined,
    decodedAudio: { ...a, channelData } };
}

function parseWeights(source: string, count: number): number[] {
  const weights: number[] = [];
  let offset = 0;
  while (weights.length < count) {
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
    if (!digits) {
      // Failed av_strtod conversion returns zero without consuming input;
      // amix then skips one character before reading the next weight.
      weights.push(0);
      offset = start + 1;
      continue;
    }
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
      break;
    }
    // amix skips exactly one separator, even when it is not whitespace.
    offset++;
  }
  return weights;
}
