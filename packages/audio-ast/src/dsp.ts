import type { AudioEffect, AudioStats, PcmAudio } from "./types.js";
import { validatePcm } from "./wav.js";

function seconds(value: number): void {
  if (!Number.isFinite(value) || value < 0)
    throw new Error("Audio time must be finite and non-negative");
}
export function trim(pcm: PcmAudio, startSec: number, durationSec?: number): PcmAudio {
  validatePcm(pcm);
  seconds(startSec);
  if (durationSec !== undefined) seconds(durationSec);
  const start = Math.round(startSec * pcm.sampleRate),
    end = durationSec === undefined ? undefined : start + Math.round(durationSec * pcm.sampleRate);
  return { sampleRate: pcm.sampleRate, channels: pcm.channels.map((ch) => ch.slice(start, end)) };
}
export function concat(buffers: PcmAudio[]): PcmAudio {
  if (!buffers.length) throw new Error("Concatenation needs at least one buffer");
  const first = buffers[0]!,
    lengths = buffers.map(validatePcm);
  if (
    buffers.some(
      (p) => p.sampleRate !== first.sampleRate || p.channels.length !== first.channels.length
    )
  )
    throw new Error("Concatenation requires matching sample rates and channels");
  const channels = first.channels.map((_, ch) => {
    const result = new Float64Array(lengths.reduce((a, b) => a + b, 0));
    let offset = 0;
    buffers.forEach((pcm, i) => {
      result.set(pcm.channels[ch]!, offset);
      offset += lengths[i]!;
    });
    return result;
  });
  return { sampleRate: first.sampleRate, channels };
}
export function pad(pcm: PcmAudio, leadSec: number, trailSec: number): PcmAudio {
  const frames = validatePcm(pcm);
  seconds(leadSec);
  seconds(trailSec);
  const lead = Math.round(leadSec * pcm.sampleRate),
    trail = Math.round(trailSec * pcm.sampleRate);
  return {
    sampleRate: pcm.sampleRate,
    channels: pcm.channels.map((ch) => {
      const out = new Float64Array(lead + frames + trail);
      out.set(ch, lead);
      return out;
    })
  };
}
export function stats(pcm: PcmAudio): AudioStats {
  const frames = validatePcm(pcm);
  let peak = 0,
    sum = 0,
    squares = 0,
    zeroCrossings = 0;
  for (const channel of pcm.channels) {
    let sign = 0;
    for (const value of channel) {
      peak = Math.max(peak, Math.abs(value));
      sum += value;
      squares += value * value;
      const next = Math.sign(value);
      if (next && sign && next !== sign) zeroCrossings++;
      if (next) sign = next;
    }
  }
  const count = frames * pcm.channels.length,
    rms = count ? Math.sqrt(squares / count) : 0;
  return {
    peak,
    rms,
    peakDbfs: 20 * Math.log10(peak),
    rmsDbfs: 20 * Math.log10(rms),
    dcOffset: count ? sum / count : 0,
    crestFactor: rms ? peak / rms : 0,
    zeroCrossings
  };
}
export function normalize(pcm: PcmAudio, targetDb = 0): PcmAudio {
  if (!Number.isFinite(targetDb)) throw new Error("Invalid normalization level");
  const peak = stats(pcm).peak,
    gain = peak ? 10 ** (targetDb / 20) / peak : 1;
  if (!Number.isFinite(gain)) throw new Error("Normalization gain is out of range");
  return {
    sampleRate: pcm.sampleRate,
    channels: pcm.channels.map((ch) => ch.map((v) => v * gain))
  };
}
export function fade(pcm: PcmAudio, inSec: number, outSec: number): PcmAudio {
  const frames = validatePcm(pcm);
  seconds(inSec);
  seconds(outSec);
  const lead = Math.round(inSec * pcm.sampleRate),
    trail = Math.round(outSec * pcm.sampleRate);
  return {
    sampleRate: pcm.sampleRate,
    channels: pcm.channels.map((ch) =>
      ch.map(
        (v, i) =>
          v *
          Math.min(1, lead > 1 ? i / (lead - 1) : 1) *
          Math.min(1, trail > 1 ? (frames - 1 - i) / (trail - 1) : 1)
      )
    )
  };
}
export function remix(pcm: PcmAudio, count: number, matrix?: number[][]): PcmAudio {
  const frames = validatePcm(pcm);
  if (!Number.isInteger(count) || count < 1 || count > 65535)
    throw new Error("Invalid output channel count");
  const weights =
    matrix ??
    Array.from({ length: count }, (_, out) =>
      pcm.channels.map((_, input) =>
        count === 1
          ? 1 / pcm.channels.length
          : pcm.channels.length === 1
            ? 1
            : out === input
              ? 1
              : 0
      )
    );
  if (
    weights.length !== count ||
    weights.some(
      (row) => row.length !== pcm.channels.length || row.some((v) => !Number.isFinite(v))
    )
  )
    throw new Error("Invalid remix matrix");
  return {
    sampleRate: pcm.sampleRate,
    channels: weights.map((row) =>
      Float64Array.from({ length: frames }, (_, i) =>
        row.reduce((sum, w, ch) => sum + w * pcm.channels[ch]![i]!, 0)
      )
    )
  };
}
export function extractChannels(pcm: PcmAudio, indices: number[]): PcmAudio {
  validatePcm(pcm);
  if (
    !indices.length ||
    indices.some((i) => !Number.isInteger(i) || i < 0 || i >= pcm.channels.length)
  )
    throw new Error("Invalid channel selection");
  return { sampleRate: pcm.sampleRate, channels: indices.map((i) => pcm.channels[i]!.slice()) };
}
export function resample(
  pcm: PcmAudio,
  sampleRate: number,
  method: "linear" | "sinc" = "sinc"
): PcmAudio {
  const frames = validatePcm(pcm);
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate <= 0 ||
    sampleRate > 0xffffffff ||
    !["linear", "sinc"].includes(method)
  )
    throw new Error("Invalid resampling settings");
  const ratio = sampleRate / pcm.sampleRate,
    length = Math.round(frames * ratio),
    cutoff = Math.min(1, ratio),
    radius = Math.ceil(24 / cutoff);
  return {
    sampleRate,
    channels: pcm.channels.map((ch) =>
      Float64Array.from({ length }, (_, i) => {
        const position = i / ratio;
        if (!frames) return 0;
        if (method === "linear") {
          const left = Math.min(frames - 1, Math.floor(position)),
            fraction = position - left;
          return ch[left]! * (1 - fraction) + ch[Math.min(left + 1, frames - 1)]! * fraction;
        }
        let sum = 0,
          weight = 0;
        for (
          let j = Math.max(0, Math.ceil(position - radius));
          j <= Math.min(frames - 1, Math.floor(position + radius));
          j++
        ) {
          const distance = position - j,
            x = Math.PI * distance * cutoff;
          const w =
            (x === 0 ? 1 : Math.sin(x) / x) * (0.5 + 0.5 * Math.cos((Math.PI * distance) / radius));
          sum += ch[j]! * w;
          weight += w;
        }
        return weight ? sum / weight : 0;
      })
    )
  };
}
export function transformAudio(pcm: PcmAudio, effects: AudioEffect[]): PcmAudio {
  validatePcm(pcm);
  let result: PcmAudio = {
    sampleRate: pcm.sampleRate,
    channels: pcm.channels.map((ch) => ch.slice())
  };
  for (const effect of effects) {
    switch (effect.type) {
      case "trim":
        result = trim(result, effect.startSec, effect.durationSec);
        break;
      case "pad":
        result = pad(result, effect.leadSec, effect.trailSec);
        break;
      case "rate":
        result = resample(result, effect.sampleRate, effect.method);
        break;
      case "channels":
        result = remix(result, effect.channels, effect.matrix);
        break;
      case "extract":
        result = extractChannels(result, effect.channels);
        break;
      case "normalize":
        result = normalize(result, effect.targetDb);
        break;
      case "fade":
        result = fade(result, effect.inSec, effect.outSec);
        break;
      default:
        throw new Error("Unsupported audio effect");
    }
  }
  return result;
}
