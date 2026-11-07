import type { MediaAstPlugin } from "../types.js";
import { concatBytes } from "../binary.js";
import { decodeAacTrack } from "../aac.js";
import { decodeMp3Track } from "../mp3.js";
import { decodeVorbisTrack } from "../vorbis.js";

const formats = ["s8", "u8", "s16le", "s16be", "s24le", "s24be", "s32le", "s32be",
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

const mulawTable = compandingTable(false);
const alawTable = compandingTable(true);

/** Output-only muxers: raw audio has no signature or self-describing stream metadata. */
export function rawAudioAsts(): MediaAstPlugin[] {
  return formats.map(format => ({
    id: format,
    formatName: format,
    formatLongName: `Raw ${format} audio`,
    extensions: [],
    mimeTypes: [],
    canDemux: false,
    canMux: true,
    supportedVideoCodecs: [],
    supportedAudioCodecs: [`pcm_${format}`],
    detect: () => false,
    parse() { throw new Error("Raw audio input requires explicit stream parameters"); },
    probe() { throw new Error("Raw audio has no stream metadata"); },
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
          const scale = 2 ** ((bits === 24 ? 32 : bits === 8 ? 16 : bits) - 1);
          const scaled = Math.max(-1, Math.min(1, value)) * scale;
          const lower = Math.floor(scaled);
          const rounded = scaled - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(scaled);
          const sample = Math.min(scale - 1, rounded);
          if (companded) {
            bytes[offset] = (codec === "mulaw" ? mulawTable : alawTable)[(sample & 65535) >> 2]!;
          } else if (bits === 8) view.setUint8(offset, (sample >> 8) + (codec === "u8" ? 128 : 0));
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
