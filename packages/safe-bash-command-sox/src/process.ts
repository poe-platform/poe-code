import {
  probeAudio,
  decodePcm,
  encodeWav,
  trim,
  pad,
  concat,
  normalize,
  remix,
  resample,
  stats,
  type PcmAudio,
  type WavOptions
} from "@poe-code/audio-ast";
export interface FormatOptions {
  rate?: number;
  channels?: number;
  bits?: number;
  encoding?: string;
  type?: "wav";
}
export const effects = new Set([
  "trim",
  "pad",
  "norm",
  "gain",
  "rate",
  "channels",
  "remix",
  "fade",
  "reverse",
  "stat",
  "stats",
  "synth"
]);
export function numeric(text: string | undefined, label: string): number {
  if (text === undefined || text.trim() === "") throw new Error(`Missing ${label}`);
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`Invalid ${label}: ${text}`);
  return value;
}
function seconds(text: string | undefined, rate: number): number {
  if (text?.endsWith("s")) return numeric(text.slice(0, -1), "sample position") / rate;
  if (text?.includes(":"))
    return text.split(":").reduce((sum, part) => sum * 60 + numeric(part, "time"), 0);
  return numeric(text, "time");
}
export function processAudio(
  inputs: Uint8Array[],
  args: readonly string[],
  output: FormatOptions,
  limits: { maxSamples: number; maxWorkSamples?: number },
  inputOptions: FormatOptions[] = []
): { bytes: Uint8Array; stderr: string } {
  const bound = (frames: number, channels: number) => {
    if (
      !Number.isSafeInteger(frames) ||
      frames < 0 ||
      !Number.isSafeInteger(channels) ||
      channels < 1 ||
      channels > 64 ||
      frames * channels > limits.maxSamples
    )
      throw new Error("Audio sample limit exceeded");
  };
  let work = 0;
  const charge = (samples: number) => {
    work += samples;
    if (!Number.isSafeInteger(work) || work > (limits.maxWorkSamples ?? 128 * 1024 * 1024))
      throw new Error("Audio work limit exceeded");
  };
  let total = 0;
  const buffers = inputs.map((data, index) => {
    const metadata = probeAudio(data, { maxAtomDepth: 64 }),
      stream = metadata.streams[0];
    if (!stream) throw new Error("No audio stream");
    bound(stream.samples, stream.channels);
    charge(stream.samples * stream.channels);
    total += stream.samples * stream.channels;
    bound(total, 1);
    const pcm = decodePcm(data),
      options = inputOptions[index];
    if (options?.encoding) {
      const encoding =
        stream.codec === "pcm_float"
          ? "floating-point"
          : stream.bitsPerSample === 8
            ? "unsigned-integer"
            : "signed-integer";
      if (options.encoding !== encoding)
        throw new Error("Input encoding override disagrees with WAV header");
    }
    if (options?.rate) pcm.sampleRate = options.rate;
    if (options?.channels !== undefined && options.channels !== pcm.channels.length)
      throw new Error("Input channel override disagrees with WAV header");
    if (options?.bits !== undefined && options.bits !== stream.bitsPerSample)
      throw new Error("Input precision override disagrees with WAV header");
    return pcm;
  });
  let pcm: PcmAudio = buffers.length
    ? concat(buffers)
    : {
        sampleRate: output.rate ?? 48000,
        channels: Array.from({ length: output.channels ?? 1 }, () => new Float64Array(0))
      };
  let stderr = "";
  const frames = () => pcm.channels[0]!.length;
  const time = (v: string | undefined) => {
    const n = seconds(v, pcm.sampleRate);
    if (n < 0) throw new Error("Negative time");
    return n;
  };
  const check = (length = frames(), channels = pcm.channels.length) => bound(length, channels);
  check();
  const admitRate = (rate: number) => {
    if (!Number.isInteger(rate) || rate <= 0) throw new Error("Invalid sample rate");
    const length = Math.round((frames() * rate) / pcm.sampleRate);
    check(length);
    charge(
      length * pcm.channels.length * (2 * Math.ceil(24 / Math.min(1, rate / pcm.sampleRate)) + 1)
    );
  };
  for (let i = 0; i < args.length; i++) {
    charge(Math.max(1, frames() * pcm.channels.length));
    const effect = args[i]!;
    const next = () => args[++i];
    const optional = () => i + 1 < args.length && !effects.has(args[i + 1]!);
    if (effect === "trim") {
      const start = time(next()),
        duration = optional() ? time(next()) : undefined;
      pcm = trim(pcm, start, duration);
    } else if (effect === "pad") {
      const lead = time(next()),
        trail = optional() ? time(next()) : 0;
      check(frames() + Math.round((lead + trail) * pcm.sampleRate));
      pcm = pad(pcm, lead, trail);
    } else if (effect === "norm" || effect === "gain") {
      if (effect === "gain" && next() !== "-n") throw new Error("Only gain -n is supported");
      pcm = normalize(pcm, optional() ? numeric(next(), "gain") : 0);
    } else if (effect === "rate") {
      const rate = numeric(next(), "sample rate");
      admitRate(rate);
      pcm = resample(pcm, rate);
    } else if (effect === "channels") {
      const count = numeric(next(), "channels");
      check(frames(), count);
      pcm = remix(pcm, count);
    } else if (effect === "remix") {
      const matrix: number[][] = [];
      while (optional()) {
        const list = next()!.split(",");
        const row = new Array<number>(pcm.channels.length).fill(0);
        for (const item of list) {
          const channel = numeric(item, "channel");
          if (channel === 0 && list.length === 1) continue;
          if (!Number.isInteger(channel) || channel < 1 || channel > row.length)
            throw new Error("Invalid remix channel");
          row[channel - 1] = 1 / list.length;
        }
        matrix.push(row);
      }
      check(frames(), matrix.length);
      pcm = remix(pcm, matrix.length, matrix);
    } else if (effect === "reverse")
      pcm = { ...pcm, channels: pcm.channels.map((ch) => ch.slice().reverse()) };
    else if (effect === "fade") {
      let shape = "l";
      if (["q", "h", "t", "l", "p"].includes(args[i + 1] ?? "")) shape = next()!;
      const fadeIn = time(next());
      const hasStop = optional();
      const stop = hasStop ? time(next()) : frames() / pcm.sampleRate;
      const fadeOut = optional() ? time(next()) : hasStop ? fadeIn : 0;
      if (stop > 0) {
        check(Math.round(stop * pcm.sampleRate));
        pcm =
          stop < frames() / pcm.sampleRate
            ? trim(pcm, 0, stop)
            : pad(pcm, 0, stop - frames() / pcm.sampleRate);
      }
      const lead = Math.round(fadeIn * pcm.sampleRate),
        trail = Math.round(fadeOut * pcm.sampleRate),
        length = frames();
      const curve = (v: number) =>
        shape === "q"
          ? Math.sin((v * Math.PI) / 2)
          : shape === "h"
            ? (1 - Math.cos(v * Math.PI)) / 2
            : shape === "p"
              ? Math.log10(1 + 9 * v)
              : shape === "t"
                ? 10 ** (5 * (v - 1))
                : v;
      pcm = {
        ...pcm,
        channels: pcm.channels.map((ch) =>
          ch.map(
            (value, index) =>
              value *
              curve(Math.min(1, lead ? index / lead : 1)) *
              curve(Math.min(1, trail ? (length - 1 - index) / trail : 1))
          )
        )
      };
    } else if (effect === "synth") {
      const duration = time(next()),
        kind = next(),
        frequency = numeric(next(), "frequency");
      if (frequency < 0 || frequency > pcm.sampleRate / 2)
        throw new Error("Frequency exceeds Nyquist limit");
      if (!["sine", "square", "triangle", "sawtooth"].includes(kind ?? ""))
        throw new Error("Unsupported synth waveform");
      const length = Math.round(duration * pcm.sampleRate);
      check(length);
      pcm = {
        ...pcm,
        channels: pcm.channels.map(() =>
          Float64Array.from({ length }, (_, index) => {
            const phase = (index * frequency) / pcm.sampleRate;
            return kind === "sine"
              ? Math.sin(2 * Math.PI * phase)
              : kind === "square"
                ? phase % 1 < 0.5
                  ? 1
                  : -1
                : kind === "triangle"
                  ? 1 - 4 * Math.abs(Math.round(phase) - phase)
                  : 2 * (phase - Math.floor(phase + 0.5));
          })
        )
      };
    } else if (effect === "stat" || effect === "stats") {
      const s = stats(pcm);
      if (effect === "stat")
        stderr += `Samples read:      ${frames() * pcm.channels.length}\nLength (seconds): ${(frames() / pcm.sampleRate).toFixed(6)}\nMaximum amplitude: ${s.peak.toFixed(6)}\nRMS amplitude:     ${s.rms.toFixed(6)}\nMean amplitude:    ${s.dcOffset.toFixed(6)}\n`;
      else
        stderr += `DC offset   ${s.dcOffset.toFixed(6)}\nPk lev dB   ${s.peakDbfs.toFixed(2)}\nRMS lev dB  ${s.rmsDbfs.toFixed(2)}\nCrest factor ${s.crestFactor.toFixed(2)}\nNum samples ${frames()}\nLength s    ${(frames() / pcm.sampleRate).toFixed(6)}\n`;
    } else throw new Error(`Unsupported effect ${effect}`);
    check();
  }
  if (output.rate !== undefined && output.rate !== pcm.sampleRate) {
    admitRate(output.rate);
    pcm = resample(pcm, output.rate);
  }
  if (output.channels !== undefined && output.channels !== pcm.channels.length) {
    check(frames(), output.channels);
    pcm = remix(pcm, output.channels);
  }
  const bits =
      output.bits ??
      (output.encoding === "floating-point" ? 32 : output.encoding === "unsigned-integer" ? 8 : 16),
    floating = output.encoding === "floating-point";
  if (
    ![8, 16, 24, 32, 64].includes(bits) ||
    (floating && bits !== 32 && bits !== 64) ||
    (!floating && bits === 64)
  )
    throw new Error("Unsupported WAV precision");
  if (
    output.encoding &&
    !["signed-integer", "unsigned-integer", "floating-point"].includes(output.encoding)
  )
    throw new Error("Unsupported encoding");
  if (
    (output.encoding === "unsigned-integer" && bits !== 8) ||
    (output.encoding === "signed-integer" && bits === 8)
  )
    throw new Error("WAV uses unsigned 8-bit and signed 16/24/32-bit PCM");
  return {
    bytes: encodeWav(pcm, {
      bitsPerSample: bits as WavOptions["bitsPerSample"] & number,
      float: floating
    }),
    stderr
  };
}
