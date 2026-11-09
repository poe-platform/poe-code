import { encodeUtf8 } from "../binary.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import { MediaBudgetTracker, type MediaAstPlugin, type MediaDocument, type MediaSample, type ParseMediaOptions } from "../types.js";

const variants = [
  { header: new TextEncoder().encode("#!AMR\n"), codecName: "amr_nb", formatFourCC: "samr", sampleRate: 8000,
    sizes: [13, 14, 16, 18, 20, 21, 27, 32, 6, 0, 0, 0, 0, 0, 0, 1] },
  { header: new TextEncoder().encode("#!AMR-WB\n"), codecName: "amr_wb", formatFourCC: "sawb", sampleRate: 16000,
    sizes: [18, 24, 33, 37, 41, 47, 51, 59, 61, 6, 0, 0, 0, 0, 1, 1] }
];

function detectVariant(bytes: Uint8Array) {
  return variants.find(variant => variant.header.every((byte, index) => bytes[index] === byte));
}

function parseAmr(bytes: Uint8Array, options: ParseMediaOptions = {}): MediaDocument {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.length);
  budget.checkStreams(1);
  const variant = detectVariant(bytes);
  if (!variant) throw new Error("Invalid AMR header");
  const { sampleRate, codecName, formatFourCC } = variant;
  const duration = sampleRate / 50;
  const samples: MediaSample[] = [];
  let offset = variant.header.length, pts = 0;
  while (offset < bytes.length) {
    budget.checkCpu();
    const header = bytes[offset]!;
    const size = variant.sizes[(header >>> 3) & 15]!;
    if ((header & 0x83) || !size) throw new Error("Invalid AMR frame header");
    if (offset + size > bytes.length) throw new Error("Truncated AMR frame");
    budget.checkSamples(samples.length + 1);
    budget.checkDuration((pts + duration) / sampleRate);
    budget.allocateMemory(128);
    samples.push({ data: bytes.subarray(offset, offset + size), offset, size,
      dts: pts, pts, cts: 0, duration, isKeyframe: true, sampleDescriptionIndex: 1 });
    offset += size;
    pts += duration;
  }
  return { containerFormat: "amr", timescale: sampleRate, duration: pts, durationSeconds: pts / sampleRate,
    byteLength: bytes.length, metadata: {},
    tracks: [{ id: 1, type: "audio", handlerType: "soun", timescale: sampleRate, duration: pts,
      language: "und", enabled: true,
      codecDescriptions: [{ formatFourCC, codecName, sampleRate, channels: 1, channelLayout: "mono", bitsPerSample: 0 }], samples }] };
}

export function amrAst(): MediaAstPlugin {
  return {
    id: "amr", formatName: "amr", formatLongName: "3GPP AMR",
    extensions: ["amr", "awb"], mimeTypes: ["audio/amr", "audio/amr-wb"],
    canDemux: true, canMux: true, supportedVideoCodecs: [], supportedAudioCodecs: ["amr_nb", "amr_wb"],
    detect: bytes => detectVariant(bytes) !== undefined,
    parse: parseAmr,
    serialize(doc, options = {}) {
      const track = doc.tracks[0];
      if (doc.tracks.length !== 1 || track?.type !== "audio") {
        throw new Error("AMR output requires exactly one audio stream");
      }
      const codec = track.codecDescriptions[0]?.codecName;
      if ((codec !== "amr_nb" && codec !== "amr_wb") || track.codecDescriptions.some(
        description => description.codecName !== codec || description.channels !== 1
      )) {
        throw new Error("AMR output requires mono AMR-NB or AMR-WB packets");
      }
      const budget = options.budget ?? new MediaBudgetTracker(options.limits);
      const header = encodeUtf8(codec === "amr_wb" ? "#!AMR-WB\n" : "#!AMR\n");
      let size = header.length;
      for (const sample of track.samples) {
        budget.checkCpu();
        size += sample.data.length;
      }
      budget.checkOutputBytes(size);
      budget.allocateMemory(size);
      const bytes = new Uint8Array(size);
      bytes.set(header);
      let offset = header.length;
      for (const sample of track.samples) {
        budget.checkCpu();
        bytes.set(sample.data, offset);
        offset += sample.data.length;
      }
      return bytes;
    },
    probe(bytes, options = {}) {
      return buildProbeResultFromDoc(parseAmr(bytes, options), bytes.length, options.filename,
        { ...options, formatName: "amr", formatLongName: "3GPP AMR" });
    }
  };
}
