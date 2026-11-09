import { buildProbeResultFromDoc } from "../mp4.js";
import { MediaBudgetTracker, type MediaAstPlugin, type MediaDocument, type MediaSample, type ParseMediaOptions } from "../types.js";

/** AC-3 syncinfo and the channel fields at the start of bitstream information. */
export function readAc3Header(bytes: Uint8Array, offset: number) {
  if (offset + 7 > bytes.length || bytes[offset] !== 0x0b || bytes[offset + 1] !== 0x77) {
    throw new Error("Invalid AC-3 frame header");
  }
  const code = bytes[offset + 4]! & 63, rateCode = bytes[offset + 4]! >>> 6;
  const bsid = bytes[offset + 5]! >>> 3;
  if (code > 37 || rateCode === 3 || bsid > 10) throw new Error("Invalid or unsupported AC-3 frame header");
  const bitrate = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512, 576, 640][code >>> 1]!;
  const size = rateCode === 0 ? bitrate * 4 : rateCode === 2 ? bitrate * 6 :
    (Math.floor(bitrate * 320 / 147) + (code & 1)) * 2;
  const sampleRate = [48000, 44100, 32000][rateCode]! / 2 ** Math.max(0, bsid - 8);
  const mode = bytes[offset + 6]! >>> 5;
  // cmixlev, surmixlev, and dsurmod are present only for their channel modes.
  const lfeBit = 4 - ((mode & 1) && mode !== 1 ? 2 : 0) - (mode & 4 ? 2 : 0) - (mode === 2 ? 2 : 0);
  const lfe = (bytes[offset + 6]! >>> lfeBit) & 1;
  const channels = [2, 1, 2, 3, 3, 4, 4, 5][mode]! + lfe;
  const channelLayout = (lfe
    ? ["2.1", "2 channels (FC+LFE)", "2.1", "3.1", "4 channels (FL+FR+LFE+BC)", "4.1", "5 channels (FL+FR+LFE+SL+SR)", "5.1(side)"]
    : ["stereo", "mono", "stereo", "3.0", "3.0(back)", "4.0", "quad(side)", "5.0(side)"])[mode]!;
  return { size, sampleRate, channels, channelLayout };
}

function parseAc3(bytes: Uint8Array, options: ParseMediaOptions = {}): MediaDocument {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.length);
  budget.checkStreams(1);
  const first = readAc3Header(bytes, 0);
  const samples: MediaSample[] = [];
  let offset = 0, pts = 0;
  while (offset < bytes.length) {
    budget.checkCpu();
    const header = readAc3Header(bytes, offset);
    if (offset + header.size > bytes.length) throw new Error("Truncated AC-3 frame");
    const duration = Math.floor(1536 * 90000 / header.sampleRate);
    budget.checkSamples(samples.length + 1);
    budget.checkDuration((pts + duration) / 90000);
    budget.allocateMemory(128);
    samples.push({ data: bytes.subarray(offset, offset + header.size), offset, size: header.size,
      dts: pts, pts, cts: 0, duration, isKeyframe: true, sampleDescriptionIndex: 1 });
    offset += header.size;
    pts += duration;
  }
  return {
    containerFormat: "ac3", timescale: 90000, duration: pts, durationSeconds: pts / 90000,
    byteLength: bytes.length, metadata: {},
    tracks: [{ id: 1, type: "audio", handlerType: "soun", timescale: 90000, duration: pts,
      language: "und", enabled: true,
      codecDescriptions: [{ formatFourCC: "ac-3", codecName: "ac3", sampleRate: first.sampleRate,
        channels: first.channels, channelLayout: first.channelLayout, bitsPerSample: 0 }], samples }]
  };
}

export function ac3Ast(): MediaAstPlugin {
  return {
    id: "ac3", formatName: "ac3", formatLongName: "raw AC-3",
    extensions: ["ac3"], mimeTypes: ["audio/ac3"], canDemux: true, canMux: false,
    supportedVideoCodecs: [], supportedAudioCodecs: ["ac3"],
    detect(bytes) {
      try { readAc3Header(bytes, 0); return true; } catch { return false; }
    },
    parse: parseAc3,
    serialize() { throw new Error("AC-3 output is not supported"); },
    probe(bytes, options) {
      return buildProbeResultFromDoc(parseAc3(bytes, options), bytes.length, options?.filename ?? "input.ac3", {
        ...options, formatName: "ac3", formatLongName: "raw AC-3"
      });
    }
  };
}
