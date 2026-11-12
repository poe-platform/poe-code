import type { MediaBudgetTracker, MediaSample, MediaTrack } from "@poe-code/mp4-ast";
import { convertAudioSampleFormat, resampleAudio } from "./audio-resample.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterBoolean } from "./filter-boolean.js";
import { parseFilterExpression } from "./filter-expression.js";
import { audioFadeCurves } from "./audio-fade-curves.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";
import { parseHlsDuration } from "safe-bash-command-ffprobe/media";

export async function acrossfadeAudio(
  first: MediaTrack, second: MediaTrack, filter: string, budget: MediaBudgetTracker, signal?: AbortSignal, simultaneousEof = false, sampleFormat?: string, eofSamples?: number
): Promise<MediaTrack> {
  const a = first.decodedAudio;
  const b = second.decodedAudio;
  if (!a || !b) throw new Error("acrossfade requires decoded PCM audio");
  const defaultLayouts = [0, 4, 3, 0xb, 0x107, 0x37, 0x3f, 0x70f, 0x63f];
  const layoutA = a.channelMask || defaultLayouts[a.channels];
  const layoutB = b.channelMask || defaultLayouts[b.channels];
  const remix = layoutA !== layoutB && [a, b].every((audio, index) => {
    const layout = index === 0 ? layoutA : layoutB;
    return layout !== undefined && (layout === defaultLayouts[audio.channels] ||
      audio.channels === 6 && layout === 0x60f);
  });
  if (!remix && (a.channels !== b.channels || layoutA !== layoutB)) {
    throw new Error("acrossfade requires matching channel layouts");
  }
  let samples = 44100;
  let duration = 0;
  let overlap = true;
  let curve1 = audioFadeCurves.tri!;
  let curve2 = audioFadeCurves.tri!;
  const curves = Object.entries(audioFadeCurves);
  const curveNames = {
    ...Object.fromEntries(curves.map(([name], index) => [name, index - 1])),
    min: -1, max: curves.length - 2, default: 0
  };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const options = argument ? argument.split(":") : [];
  if (argument.endsWith(":")) options.pop();
  let position = 0;
  for (const option of options) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["ns", "d", "o", "c1", "c2"][position] : option.slice(0, separator).trim();
    // FFmpeg restarts shorthand after a named option, skipping the slot just
    // visited if it was first. The named key itself does not select that slot.
    if (separator < 0) position++;
    else position = position === 0 ? 1 : 0;
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "threads" || key === "thread_type" || key === "extra_hw_frames") {
      // Scheduling and hardware reservations do not change decoded PCM samples.
      validateWeaveGenericOption(key, value, "acrossfade");
    } else if (key === "ns" || key === "nb_samples") {
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
      const number = parseFilterExpression(value, "acrossfade", curveNames);
      if (number < -1 || number > curves.length - 2) throw new Error("acrossfade: invalid curve");
      // Curve options use FFmpeg's integer rounding, including ties to even.
      const floor = Math.floor(number);
      const index = number - floor === 0.5 ? floor + Math.abs(floor % 2) : Math.round(number);
      const curve = curves[index + 1]![1];
      if (key === "c1" || key === "curve1") curve1 = curve;
      else curve2 = curve;
    } else throw new Error(`acrossfade: unsupported option ${key}`);
  }
  // Restore FFmpeg's integer microseconds before rescaling so exact half-samples round up.
  if (duration > 0) samples = Math.round(Math.round(duration * 1_000_000) * a.sampleRate / 1_000_000);
  // FFmpeg ends after the first input when a positive duration rounds to no samples.
  if (samples === 0) return first;
  const pcm16 = sampleFormat === "s16" || sampleFormat === undefined && ["pcm_s16le", "pcm_s16be"].includes(first.codecDescriptions[0]?.codecName ?? "");
  let secondChannels = b.channelData;
  const ratio = a.sampleRate / b.sampleRate;
  if (ratio !== 1) {
    const resampledLength = Math.ceil(b.channelData[0]!.length * ratio);
    budget.checkSamples(resampledLength);
    budget.checkDuration(resampledLength / a.sampleRate);
    budget.allocateMemory(resampledLength * b.channels * Float32Array.BYTES_PER_ELEMENT);
    secondChannels = await resampleAudio(b.channelData, resampledLength, b.sampleRate, a.sampleRate, budget, signal);
    // Automatic S16 conversion rounds resampled floats to nearest even, just
    // like an explicit aresample=osf=s16, before the fade consumes them.
    if (pcm16) secondChannels = await convertAudioSampleFormat(secondChannels, "flt", "s16", budget, signal);
  }
  const aLength = a.channelData[0]!.length;
  const bLength = secondChannels[0]!.length;
  if (samples < 1) throw new Error("acrossfade: invalid sample count");
  // FFmpeg 7 checks second-input EOF before starting the transition, even
  // when enough PCM is queued on both unbuffered branches of a split.
  const length = simultaneousEof || samples > aLength || samples > bLength
    ? Math.max(0, Math.min(aLength, eofSamples ?? aLength) - samples)
    : aLength + bLength - (overlap ? samples : 0);
  budget.checkSamples(length);
  budget.checkDuration(length / a.sampleRate);
  budget.allocateMemory(length * a.channels * 8);
  const channelData = a.channelData.map(() => new Float64Array(length));
  // FFmpeg negotiates the first input's precision and converts the second before fading.
  const pcm32 = sampleFormat === "s32" || sampleFormat === undefined && ["pcm_s24le", "pcm_s24be", "pcm_s32le", "pcm_s32be"].includes(first.codecDescriptions[0]?.codecName ?? "");
  const float32 = sampleFormat === "flt" || sampleFormat === undefined && ["pcm_f32le", "pcm_f32be"].includes(first.codecDescriptions[0]?.codecName ?? "");
  const secondPcm32 = ["pcm_s32le", "pcm_s32be", "pcm_s24le", "pcm_s24be"]
    .includes(second.codecDescriptions[0]?.codecName ?? "");
  // Speaker order follows the WAV mask: FL, FR, FC, LFE, BL, BR, ..., BC, SL, SR.
  // Build once, then use the same routing for every sample in the second input.
  let matrix: number[][] | undefined;
  if (remix) {
    const speakers = Array.from({ length: 11 }, (_, bit) => 1 << bit);
    const inputs = speakers.filter(speaker => layoutB! & speaker);
    const outputs = speakers.filter(speaker => layoutA! & speaker);
    matrix = outputs.map(output => inputs.map(input => output === input ? 1 : 0));
    const add = (output: number, input: number, gain: number): void => {
      const row = outputs.indexOf(output), column = inputs.indexOf(input);
      if (row >= 0 && column >= 0) matrix![row]![column]! += gain;
    };
    const missing = layoutB! & ~layoutA!;
    if (missing & 4) {
      add(1, 4, Math.SQRT1_2);
      add(2, 4, Math.SQRT1_2);
    }
    if (missing & 3) {
      add(4, 1, Math.SQRT1_2);
      add(4, 2, Math.SQRT1_2);
    }
    if (missing & 256) {
      if (layoutA! & 16) { add(16, 256, Math.SQRT1_2); add(32, 256, Math.SQRT1_2); }
      else if (layoutA! & 512) { add(512, 256, Math.SQRT1_2); add(1024, 256, Math.SQRT1_2); }
      else if (layoutA! & 1) { add(1, 256, 0.5); add(2, 256, 0.5); }
      else add(4, 256, 0.5);
    }
    for (const [left, right, otherLeft, otherRight] of [[16, 32, 512, 1024], [512, 1024, 16, 32]] as const) {
      if (!(missing & left)) continue;
      // Back speakers prefer back center; side speakers prefer back left/right.
      if (layoutA! & 256 && (left === 16 || !(layoutA! & otherLeft))) {
        add(256, left, Math.SQRT1_2); add(256, right, Math.SQRT1_2);
      } else if (layoutA! & otherLeft) {
        const gain = layoutB! & otherLeft ? Math.SQRT1_2 : 1;
        add(otherLeft, left, gain); add(otherRight, right, gain);
      } else if (layoutA! & 1) {
        add(1, left, Math.SQRT1_2); add(2, right, Math.SQRT1_2);
      } else { add(4, left, 0.5); add(4, right, 0.5); }
    }
    // LFE is silent when absent from the output. Integer rematrixing normalizes
    // every row by the largest row sum, then carries Q15 rounding error forward.
    if (pcm16 || pcm32) {
      const peak = Math.max(1, ...matrix.map(row => row.reduce((sum, gain) => sum + gain, 0)));
      matrix = matrix.map(row => {
        // SWR's generic mixer rounds independently for rows with >2 inputs;
        // its specialized 5.1/7.1-to-stereo paths retain error diffusion.
        const diffuse = row.filter(gain => gain !== 0).length <= 2 ||
          layoutA === 3 && (b.channels === 6 || b.channels === 8);
        let remainder = 0;
        return row.map(gain => {
          if (!pcm16) return gain / peak;
          const target = gain / peak * 32768 + (diffuse ? remainder : 0);
          const rounded = Math.fround(target);
          const floor = Math.floor(rounded);
          const coefficient = rounded - floor === 0.5 ? floor + Math.abs(floor % 2) : Math.round(rounded);
          remainder += target - coefficient;
          return gain === 0 ? 0 : coefficient / 32768;
        });
      });
    }
  }
  for (let i = 0; i < length; i++) {
    if (i % 4096 === 0) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      budget.checkCpu();
    }
    const transition = i - (aLength - samples);
    const secondIndex = i - (overlap ? aLength - samples : aLength);
    const firstGain = i >= aLength ? 0 : transition < 0 ? 1 : curve1((samples - 1 - transition) / samples);
    const secondGain = secondIndex < 0 ? 0 : secondIndex >= samples ? 1 : curve2(secondIndex / samples);
    for (let channel = 0; channel < a.channels; channel++) {
      const firstSample = i >= aLength ? 0 : a.channelData[channel]![i]!;
      // Upstream resamplers can retain fractional PCM internally. Materialize
      // the negotiated S16 input before applying the fade's truncating cast.
      const firstValue = (pcm16
        ? Math.max(-32768, Math.min(32767, Math.round(firstSample * 32768))) / 32768
        : firstSample) * firstGain;
      let secondSample = 0;
      if (secondIndex >= 0) {
        if (!remix) secondSample = secondChannels[channel]![secondIndex]!;
        else secondSample = matrix![channel]!.reduce((sum, gain, input) =>
          sum + gain * secondChannels[input]![secondIndex]!, 0);
      }
      // Integer narrowing discards low bits, including for negative samples.
      if (pcm16 && secondPcm32 && ratio === 1 && !remix) {
        secondSample = Math.floor(secondSample * 32768) / 32768;
      }
      // Materialize PCM32 before the fade's truncating cast, rounding ties to even.
      if (pcm32) {
        const scaled = secondSample * 2147483648;
        const lower = Math.floor(scaled);
        const rounded = scaled - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(scaled);
        secondSample = Math.max(-2147483648, Math.min(2147483647, rounded)) / 2147483648;
      }
      // Explicit and automatic rate/layout conversion both negotiate S16.
      const secondValue = (pcm16
        ? Math.max(-32768, Math.min(32767, Math.round(secondSample * 32768))) / 32768
        : secondSample) * secondGain;
      // Store the mixed sample at the negotiated precision before output conversion.
      const value = firstValue + secondValue;
      if (pcm32) {
        const integer = Math.trunc(value * 2147483648);
        // Native x86-64 conversion returns INT32_MIN when the truncated sum
        // cannot fit in S32, rather than wrapping its low 32 bits.
        channelData[channel]![i] = integer >= -2147483648 && integer <= 2147483647
          ? integer / 2147483648 : -1;
      } else {
        channelData[channel]![i] = pcm16 ? (Math.trunc(value * 32768) << 16 >> 16) / 32768
          : float32 ? Math.fround(value) : value;
      }
    }
  }
  const frames: MediaSample[] = [];
  let pts = 0;
  function appendFrame(count: number, tags?: MediaSample["tags"]): void {
    count = Math.min(count, length - pts);
    if (count <= 0) return;
    budget.allocateMemory(96);
    frames.push({ data: new Uint8Array(0), size: 0, dts: pts, pts, cts: 0,
      duration: count, isKeyframe: true, sampleDescriptionIndex: 1, ...(tags ? { tags } : {}) });
    pts += count;
  }
  // Filter-produced frames arrive individually; release only the excess over
  // the retained fade window each time. Demuxed packets are already queued.
  if (first.samples[0]?.size === 0) {
    let received = 0;
    let sourceIndex = 0;
    let sourceStart = 0;
    for (let n = 0; n < first.samples.length && received < aLength; n++) {
      if (n % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      const packet = first.samples[n]!;
      received = Math.min(aLength, received + Math.max(0,
        Math.round(packet.duration * a.sampleRate / first.timescale)
        - (packet.skipSamples ?? 0) - (packet.discardPadding ?? 0)));
      // A released frame inherits the first buffered frame it consumes, which
      // can precede the newly received packet and span several input frames.
      while (sourceIndex < n) {
        const source = first.samples[sourceIndex]!;
        const end = sourceStart + Math.max(0, Math.round(source.duration * a.sampleRate / first.timescale)
          - (source.skipSamples ?? 0) - (source.discardPadding ?? 0));
        if (end > pts) break;
        sourceStart = end;
        sourceIndex++;
      }
      appendFrame(received - samples - pts, first.samples[sourceIndex]?.tags);
    }
  }
  appendFrame(aLength - samples - pts, first.samples[0]?.tags);
  // Emit one transition frame, or two fades when overlap is disabled.
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
    appendFrame(end - Math.max(emitted, samples), packet?.tags);
    emitted = end;
  }
  appendFrame(bLength - Math.max(emitted, samples));
  const codecName = sampleFormat === "s16" ? "pcm_s16le" : sampleFormat === "s32" ? "pcm_s32le"
    : sampleFormat === "flt" ? "pcm_f32le" : sampleFormat === "dbl" ? "pcm_f64le" : undefined;
  return { ...first,
    codecDescriptions: codecName === undefined ? first.codecDescriptions : first.codecDescriptions.map(description => ({
      ...description, codecName, bitsPerSample: pcm16 ? 16 : sampleFormat === "dbl" ? 64 : 32
    })), timescale: a.sampleRate, duration: length, samples: frames, editList: undefined,
    decodedAudio: { ...a, channelData } };
}
