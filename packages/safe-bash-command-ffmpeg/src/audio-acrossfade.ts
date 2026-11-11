import type { MediaBudgetTracker, MediaSample, MediaTrack } from "@poe-code/mp4-ast";
import { resampleAudio } from "./audio-resample.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterBoolean } from "./filter-boolean.js";
import { parseFilterExpression } from "./filter-expression.js";
import { audioFadeCurves } from "./audio-fade-curves.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";
import { parseHlsDuration } from "safe-bash-command-ffprobe/media";

export async function acrossfadeAudio(
  first: MediaTrack, second: MediaTrack, filter: string, budget: MediaBudgetTracker, signal?: AbortSignal, simultaneousEof = false
): Promise<MediaTrack> {
  const a = first.decodedAudio;
  const b = second.decodedAudio;
  if (!a || !b) throw new Error("acrossfade requires decoded PCM audio");
  const layoutA = a.channelMask || (a.channels === 1 ? 4 : a.channels === 2 ? 3 : a.channels === 4 ? 0x107 : a.channels === 6 ? 0x3f : undefined);
  const layoutB = b.channelMask || (b.channels === 1 ? 4 : b.channels === 2 ? 3 : b.channels === 4 ? 0x107 : b.channels === 6 ? 0x3f : undefined);
  const remix = a.channels !== b.channels && Math.min(a.channels, b.channels) <= 2 &&
    [a, b].every((audio, index) => {
      const layout = index === 0 ? layoutA : layoutB;
      return audio.channels === 1 && layout === 4 || audio.channels === 2 && layout === 3 ||
        audio.channels === 4 && layout === 0x107 || audio.channels === 6 && (layout === 0x3f || layout === 0x60f);
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
  // FFmpeg 7 checks second-input EOF before starting the transition, even
  // when enough PCM is queued on both unbuffered branches of a split.
  const length = simultaneousEof || samples > aLength || samples > bLength
    ? Math.max(0, aLength - samples)
    : aLength + bLength - (overlap ? samples : 0);
  budget.checkSamples(length);
  budget.checkDuration(length / a.sampleRate);
  budget.allocateMemory(length * a.channels * 8);
  const channelData = a.channelData.map(() => new Float64Array(length));
  // FFmpeg negotiates the first input's precision and converts the second before fading.
  const pcm16 = ["pcm_s16le", "pcm_s16be"].includes(first.codecDescriptions[0]?.codecName ?? "");
  const pcm32 = ["pcm_s24le", "pcm_s24be", "pcm_s32le", "pcm_s32be"].includes(first.codecDescriptions[0]?.codecName ?? "");
  const secondPcm32 = ["pcm_s32le", "pcm_s32be", "pcm_s24le", "pcm_s24be"]
    .includes(second.codecDescriptions[0]?.codecName ?? "");
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
      const firstValue = i >= aLength ? 0 : a.channelData[channel]![i]! * firstGain;
      let secondSample = 0;
      if (secondIndex >= 0) {
        if (!remix) secondSample = secondChannels[channel]![secondIndex]!;
        else if (a.channels === 4 || a.channels === 6) {
          // Mono occupies front center; stereo occupies FL/FR. Other speakers are silent.
          secondSample = b.channels === 1
            ? channel === 2 ? secondChannels[0]![secondIndex]! : 0
            : channel < 2 ? secondChannels[channel]![secondIndex]! : 0;
        } else if (b.channels === 4) {
          const center = secondChannels[2]![secondIndex]!;
          const back = secondChannels[3]![secondIndex]!;
          if (a.channels === 1) {
            const front = secondChannels[0]![secondIndex]! + secondChannels[1]![secondIndex]!;
            secondSample = pcm16 ? (front * 7951 + center * 11244 + back * 5622) / 32768
              : front * Math.SQRT1_2 + center + back / 2;
          } else {
            const front = secondChannels[channel]![secondIndex]!;
            secondSample = pcm16 ? (front * 14847 + center * 10498 + back * 7423) / 32768
              : front + center * Math.SQRT1_2 + back / 2;
          }
        } else if (b.channels === 6) {
          const center = secondChannels[2]![secondIndex]!;
          if (a.channels === 1) {
            const front = secondChannels[0]![secondIndex]! + secondChannels[1]![secondIndex]!;
            const surround = secondChannels[4]![secondIndex]! + secondChannels[5]![secondIndex]!;
            secondSample = pcm16 ? (front * 6786 + center * 9598 + surround * 4799) / 32768
              : front * Math.SQRT1_2 + center + surround / 2;
          } else {
            const front = secondChannels[channel]![secondIndex]!;
            const surround = secondChannels[channel + 4]![secondIndex]!;
            // S16 stereo rematrixing distributes Q15 rounding between center and surrounds.
            secondSample = pcm16 ? (front * 13573 + center * 9597 + surround * 9598) / 32768
              : front + (center + surround) * Math.SQRT1_2;
          }
        } else secondSample = b.channels === 1
          ? secondChannels[0]![secondIndex]! * (pcm16 ? 23170 / 32768 : Math.SQRT1_2)
          : (secondChannels[0]![secondIndex]! + secondChannels[1]![secondIndex]!) / 2;
      }
      // Integer narrowing discards low bits, including for negative samples.
      if (pcm16 && secondPcm32 && ratio === 1 && !remix) {
        secondSample = Math.floor(secondSample * 32768) / 32768;
      }
      // Automatic rate/layout conversion negotiates S16 before the fade's truncating cast.
      const secondValue = (pcm16 && (ratio !== 1 || remix)
        ? Math.max(-32768, Math.min(32767, Math.round(secondSample * 32768))) / 32768
        : secondSample) * secondGain;
      // Native integer fades truncate the mixed sample before encoding.
      const value = firstValue + secondValue;
      channelData[channel]![i] = pcm16 ? (Math.trunc(value * 32768) << 16 >> 16) / 32768
        : pcm32 ? (Math.trunc(value * 2147483648) | 0) / 2147483648 : value;
    }
  }
  const frames: MediaSample[] = [];
  let pts = 0;
  function appendFrame(count: number): void {
    count = Math.min(count, length - pts);
    if (count <= 0) return;
    budget.allocateMemory(96);
    frames.push({ data: new Uint8Array(0), size: 0, dts: pts, pts, cts: 0,
      duration: count, isKeyframe: true, sampleDescriptionIndex: 1 });
    pts += count;
  }
  // Filter-produced frames arrive individually; release only the excess over
  // the retained fade window each time. Demuxed packets are already queued.
  if (first.samples[0]?.size === 0) {
    let received = 0;
    for (let n = 0; n < first.samples.length && received < aLength; n++) {
      if (n % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      const packet = first.samples[n]!;
      received = Math.min(aLength, received + Math.max(0,
        Math.round(packet.duration * a.sampleRate / first.timescale)
        - (packet.skipSamples ?? 0) - (packet.discardPadding ?? 0)));
      appendFrame(received - samples - pts);
    }
  }
  appendFrame(aLength - samples - pts);
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
    appendFrame(end - Math.max(emitted, samples));
    emitted = end;
  }
  appendFrame(bLength - Math.max(emitted, samples));
  return { ...first, timescale: a.sampleRate, duration: length, samples: frames, editList: undefined,
    decodedAudio: { ...a, channelData } };
}
