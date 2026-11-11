import { MediaBudgetTracker, type MediaDocument, type MediaSample, type ParseMediaOptions, type MediaAstPlugin } from "../types.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import { concatBytes } from "../binary.js";
import { decodeAacTrack } from "../aac.js";
import { decodeMp3Track } from "../mp3.js";
import { decodeVorbisTrack } from "../vorbis.js";

const formats = ["s8", "u8", "s16le", "s16be", "s24le", "s24be", "s32le", "s32be",
  "u16le", "u16be", "u24le", "u24be", "u32le", "u32be",
  "f32le", "f32be", "f64le", "f64be", "mulaw", "alaw"];

// FFmpeg maps PCM16 through a 14-bit G.711 table using midpoint thresholds.
function compandingTable(alaw: boolean): Uint8Array {
  const levels = Array.from({ length: 128 }, (_, code) => {
    const exponent = code >> 4;
    const mantissa = code & 15;
    return alaw ? exponent ? (mantissa * 16 + 264) * 2 ** (exponent - 1) : mantissa * 16 + 8
      : (mantissa * 8 + 132) * 2 ** exponent - 132;
  });
  const table = new Uint8Array(16384);
  let sample = 0;
  for (let code = 0; code < 128; code++) {
    const end = code === 127 ? 8192 : (levels[code]! + levels[code + 1]! + 4) >> 3;
    for (; sample < end; sample++) {
      table[sample] = code ^ (alaw ? 0xd5 : 0xff);
      if (sample > 0) table[16384 - sample] = table[sample]! ^ 128;
    }
  }
  table[8192] = table[8193]!;
  return table;
}

export const mulawTable = compandingTable(false);
export const alawTable = compandingTable(true);

export function parseRawAudio(bytes: Uint8Array, format: string, options: ParseMediaOptions = {}): MediaDocument {
  const sampleRate = options.sampleRate ?? 44100;
  const channels = options.channels ?? 1;
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 || sampleRate > 0xffffffff ||
      !Number.isSafeInteger(channels) || channels <= 0 || channels > 65535) {
    throw new Error("Invalid raw audio sample rate or channel count");
  }
  const bits = format === "mulaw" || format === "alaw" || format === "vidc" ? 8 : Number.parseInt(format.slice(1), 10);
  const width = bits / 8;
  const frames = Math.floor(bytes.length / (width * channels));
  if (options.decodeAudio !== false && bytes.length > 0 && frames === 0) throw new Error("Incomplete raw audio sample frame");
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.length);
  budget.checkStreams(1);
  budget.checkDuration(frames / sampleRate);
  // FFmpeg targets ten PCM packets per second, rounding down to a power
  // of two complete interleaved sample frames (ff_pcm_default_packet_size).
  const packetFrames = 2 ** Math.floor(Math.log2(Math.max(1, Math.min(
    Math.floor(sampleRate / 10), Math.floor(0x7fffffff / (width * channels))
  ))));
  budget.checkSamples(Math.ceil(bytes.length / (packetFrames * width * channels)));
  const samples: MediaSample[] = [];
  for (let start = 0; start * width * channels < bytes.length; start += packetFrames) {
    budget.checkCpu();
    const duration = Math.min(packetFrames, frames - start);
    const data = bytes.subarray(start * width * channels, (start + packetFrames) * width * channels);
    samples.push({ data, size: data.length, offset: start * width * channels, dts: start, pts: start, cts: 0,
      duration, isKeyframe: true, sampleDescriptionIndex: 1 });
  }
  let channelData: Float64Array[] | undefined;
  if (options.decodeAudio !== false) {
    budget.allocateMemory(frames * channels * 8);
    channelData = Array.from({ length: channels }, () => new Float64Array(frames));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const le = format.endsWith("le");
    const unsigned = format.startsWith("u");
    for (let frame = 0; frame < frames; frame++) {
      if (frame % 4096 === 0) budget.checkCpu();
      for (let ch = 0; ch < channels; ch++) {
        const offset = (frame * channels + ch) * width;
        let value: number;
        if (format.startsWith("f")) value = bits === 32 ? view.getFloat32(offset, le) : view.getFloat64(offset, le);
        else if (format === "mulaw") {
          const code = bytes[offset]! ^ 255;
          const magnitude = ((code & 15) * 8 + 132) * 2 ** ((code >> 4) & 7) - 132;
          // Both G.711 zero codewords decode to positive PCM zero.
          value = (code & 128 ? 0 - magnitude : magnitude) / 32768;
        } else if (format === "vidc") {
          // VIDC stores the sign in bit 0 and the logarithmic magnitude in bits 1–7.
          const code = bytes[offset]!;
          const magnitude = (((code >> 1) & 15) * 8 + 132) * 2 ** (code >> 5) - 132;
          value = (code & 1 ? 0 - magnitude : magnitude) / 32768;
        } else if (format === "alaw") {
          const code = bytes[offset]! ^ 85;
          const exponent = (code >> 4) & 7;
          const magnitude = exponent === 0 ? (code & 15) * 16 + 8 : ((code & 15) * 16 + 264) * 2 ** (exponent - 1);
          value = (code & 128 ? magnitude : -magnitude) / 32768;
        } else if (bits === 8) value = format === "u8" ? (bytes[offset]! - 128) / 128 : view.getInt8(offset) / 128;
        else if (bits === 16) value = (unsigned ? view.getUint16(offset, le) - 32768 : view.getInt16(offset, le)) / 32768;
        else if (bits === 24) {
          const packed = le ? bytes[offset]! | bytes[offset + 1]! << 8 | bytes[offset + 2]! << 16
            : bytes[offset + 2]! | bytes[offset + 1]! << 8 | bytes[offset]! << 16;
          value = (unsigned ? packed - 8388608 : packed << 8 >> 8) / 8388608;
        } else value = (unsigned ? view.getUint32(offset, le) - 2147483648 : view.getInt32(offset, le)) / 2147483648;
        channelData[ch]![frame] = value;
      }
    }
  }
  return {
    containerFormat: format, timescale: sampleRate, duration: frames, durationSeconds: frames / sampleRate,
    metadata: {}, byteLength: bytes.length,
    tracks: [{
      id: 1, type: "audio", handlerType: "soun", timescale: sampleRate, duration: frames, language: "und", enabled: true,
      codecDescriptions: [{ formatFourCC: "raw ", codecName: `pcm_${format}`, sampleRate, channels, bitsPerSample: bits }],
      samples,
      ...(channelData ? { decodedAudio: { sampleRate, channels, channelData } } : {})
    }]
  };
}

/** Headerless audio requires an explicit format; it cannot be detected from bytes. */
export function rawAudioAsts(): MediaAstPlugin[] {
  return formats.map(format => ({
    id: format,
    formatName: format,
    formatLongName: `Raw ${format} audio`,
    extensions: [],
    mimeTypes: [],
    canDemux: true,
    canMux: true,
    supportedVideoCodecs: [],
    supportedAudioCodecs: [`pcm_${format}`],
    detect: () => false,
    parse(bytes, options) { return parseRawAudio(bytes, format, options); },
    probe(bytes, options = {}) {
      return buildProbeResultFromDoc(parseRawAudio(bytes, format, options), bytes.length, options.filename, { ...options, formatName: format });
    },
    serialize(doc, options = {}) {
      const track = doc.tracks.find(t => t.type === "audio");
      if (!track) throw new Error("Raw audio output requires an audio stream");
      if (options.audioCodec === "copy") {
        const size = track.samples.reduce((total, sample) => total + sample.data.length, 0);
        options.budget?.checkOutputBytes(size);
        return concatBytes(track.samples.map(sample => sample.data));
      }
      // Like FFmpeg, the muxer selects a default codec; an explicit PCM codec overrides it.
      const codec = options.audioCodec?.slice(4) ?? format;
      if (options.audioCodec && !options.audioCodec.startsWith("pcm_") ||
          !formats.includes(codec)) {
        throw new Error(`Unsupported raw audio encoder '${options.audioCodec}'`);
      }
      const sourceCodec = track.codecDescriptions[0]?.codecName;
      const audio = track.decodedAudio ?? (sourceCodec === "aac" ? decodeAacTrack(doc, track)
        : sourceCodec === "mp3" ? decodeMp3Track(track)
        : sourceCodec === "vorbis" ? decodeVorbisTrack(track) : undefined);
      if (!audio) throw new Error("Raw audio encoding requires decoded PCM audio");
      const companded = codec === "mulaw" || codec === "alaw";
      const bits = companded ? 8 : Number.parseInt(codec.slice(1), 10);
      // G.711 decodes to PCM16 despite its 8-bit compressed storage width.
      const truncate = (sourceCodec === "pcm_alaw" || sourceCodec === "pcm_mulaw") ? !companded && bits < 16
        : (sourceCodec?.startsWith("pcm_s") || sourceCodec?.startsWith("pcm_u")) &&
          (track.codecDescriptions[0]?.bitsPerSample ?? 0) > (companded ? 16 : bits);
      const bytesPerSample = bits / 8;
      const channels = audio.channelData.length;
      const frames = audio.channelData[0]?.length ?? 0;
      const size = frames * channels * bytesPerSample;
      options.budget?.checkOutputBytes(size);
      const bytes = new Uint8Array(size);
      const view = new DataView(bytes.buffer);
      const littleEndian = codec.endsWith("le");
      for (let i = 0; i < frames; i++) {
        for (let channel = 0; channel < channels; channel++) {
          const offset = (i * channels + channel) * bytesPerSample;
          const value = audio.channelData[channel]![i] ?? 0;
          if (codec.startsWith("f")) {
            if (bits === 32) view.setFloat32(offset, value, littleEndian);
            else view.setFloat64(offset, value, littleEndian);
            continue;
          }
          const scale = 2 ** ((bits === 24 ? 32 : companded ? 16 : bits) - 1);
          // FFmpeg's float-to-integer conversion maps non-finite samples to
          // zero for PCM16 and INT32_MIN for PCM32 (including PCM24 narrowing).
          const nativeInteger = !companded && (bits === 16 || bits === 32);
          const scaled = Number.isFinite(value) ? (nativeInteger ? value : Math.max(-1, Math.min(1, value))) * scale
            : scale === 2147483648 ? -scale : 0;
          const lower = Math.floor(scaled);
          let rounded = scaled - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(scaled);
          if (nativeInteger) {
            // FFmpeg's x86_64 lrint/llrint returns INT64_MIN on overflow.
            // PCM16 then narrows to int32 before clipping; PCM32 clips int64.
            if (rounded >= 2 ** 63 || rounded < -(2 ** 63)) rounded = -(2 ** 63);
            if (bits === 16) rounded |= 0;
          }
          const sample = Math.max(-scale, Math.min(scale - 1, truncate ? lower : rounded)) +
            (codec.startsWith("u") && bits > 8 ? scale : 0);
          if (companded) {
            bytes[offset] = (codec === "mulaw" ? mulawTable : alawTable)[(sample & 65535) >> 2]!;
          } else if (bits === 8) view.setUint8(offset, codec === "u8" ? sample + 128 : sample);
          else if (bits === 16) view.setInt16(offset, sample, littleEndian);
          else if (bits === 24) {
            const packed = sample >> 8;
            for (let b = 0; b < 3; b++) bytes[offset + b] = packed >> ((littleEndian ? b : 2 - b) * 8) & 255;
          } else view.setInt32(offset, sample, littleEndian);
        }
      }
      return bytes;
    }
  }));
}
