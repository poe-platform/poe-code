import { type MediaAstPlugin, type MediaDocument, type ParseMediaOptions, MediaBudgetTracker } from "../types.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import { decodeAuG726 } from "./au-g726.js";
import { rawAudioAsts } from "./raw-audio.js";

const encodings = new Map([[1, "mulaw"], [2, "s8"], [3, "s16be"], [4, "s24be"],
  [5, "s32be"], [6, "f32be"], [7, "f64be"], [27, "alaw"]]);
const adpcmEncodings = new Map([
  [23, { codec: "adpcm_g726le", bits: 4 as const }], [24, { codec: "adpcm_g722", bits: 4 as const }],
  [25, { codec: "adpcm_g726le", bits: 3 as const }], [26, { codec: "adpcm_g726le", bits: 5 as const }]
]);
const raw = rawAudioAsts();

function parseAu(bytes: Uint8Array, options: ParseMediaOptions = {}) {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 24 || view.getUint32(0) !== 0x2e736e64) throw new Error("Invalid AU header");
  const offset = view.getUint32(4);
  const size = view.getUint32(8);
  const format = encodings.get(view.getUint32(12));
  const adpcm = adpcmEncodings.get(view.getUint32(12));
  if (!format && !adpcm) throw new Error("Unsupported AU audio encoding");
  if (offset < 24 || offset > bytes.length) {
    throw new Error("Invalid AU data bounds");
  }
  const sampleRate = view.getUint32(16), channels = view.getUint32(20);
  let doc: MediaDocument;
  if (adpcm) {
    if (!sampleRate || !channels || channels > 65535) throw new Error("Invalid AU sample rate or channel count");
    if (options.decodeAudio !== false && adpcm.codec === "adpcm_g726le" && channels !== 1) throw new Error("G.726 requires a mono channel count");
    const data = bytes.subarray(offset);
    const frames = Math.floor(data.length * 8 / (channels * adpcm.bits));
    budget.checkStreams(1);
    budget.checkSamples(data.length ? 1 : 0);
    budget.checkDuration(frames / sampleRate);
    doc = {
      containerFormat: "au", timescale: sampleRate, duration: frames, durationSeconds: frames / sampleRate,
      metadata: {}, byteLength: bytes.length,
      tracks: [{
        id: 1, type: "audio", handlerType: "soun", timescale: sampleRate, duration: frames, language: "und", enabled: true,
        codecDescriptions: [{ formatFourCC: "", codecName: adpcm.codec, sampleRate, channels, bitsPerSample: adpcm.bits }],
        samples: data.length ? [{ data, size: data.length, dts: 0, pts: 0, cts: 0,
          duration: frames, isKeyframe: true, sampleDescriptionIndex: 1 }] : [],
        ...(options.decodeAudio !== false ? { decodedAudio: { sampleRate, channels,
          channelData: [adpcm.codec === "adpcm_g722" ? decodeG722(data, budget) : decodeAuG726(data, adpcm.bits, budget)] } } : {})
      }]
    };
  } else {
    doc = raw.find(plugin => plugin.id === format)!.parse(
      bytes.subarray(offset, size === 0 && options.decodeAudio !== false ? offset : bytes.length),
      { ...options, budget, sampleRate, channels });
  }
  doc = { ...doc, tracks: doc.tracks.map(track => ({ ...track,
    samples: track.samples.map(sample => ({ ...sample, offset: sample.data.byteOffset - bytes.byteOffset }))
  })) };
  // Probing reads available packets even when the header declares zero duration.
  // Decoding retains FFmpeg's empty-input behavior for an explicit zero size.
  if (size !== 0xffffffff) {
    const track = doc.tracks[0]!;
    const description = track.codecDescriptions[0]!;
    const duration = Math.floor(size / (description.channels! * description.bitsPerSample! / 8));
    budget.checkDuration(duration / track.timescale);
    doc = { ...doc, duration, durationSeconds: duration / track.timescale, tracks: [{ ...track, duration }] };
  }
  const metadata = { ...doc.metadata };
  const annotation = new TextDecoder().decode(bytes.subarray(24, offset)).split("\0")[0]!;
  for (const line of annotation.split("\n")) {
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).toLowerCase();
    if (separator >= 0 && (key === "title" || key === "artist")) metadata[key] = line.slice(separator + 1);
  }
  return { ...doc, metadata, containerFormat: "au", byteLength: bytes.length };
}

export function auAst(): MediaAstPlugin {
  return {
    id: "au", formatName: "au", formatLongName: "Sun AU",
    extensions: ["au", "snd"], mimeTypes: ["audio/basic"],
    canDemux: true, canMux: true, supportedVideoCodecs: [],
    supportedAudioCodecs: [...encodings.values()].map(format => `pcm_${format}`),
    detect: bytes => bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) === 0x2e736e64,
    parse: parseAu,
    probe(bytes, options = {}) {
      const result = buildProbeResultFromDoc(parseAu(bytes, { ...options, decodeAudio: false }), bytes.length, options.filename,
        { ...options, formatName: "au", formatLongName: "Sun AU" });
      const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      // An unknown length needs payload bytes before a sample count can be inferred.
      if (header.getUint32(8) === 0xffffffff && header.getUint32(4) === bytes.length) {
        return { ...result, streams: result.streams.map(stream => ({ ...stream, duration_ts: undefined })) };
      }
      return result;
    },
    serialize(doc, options = {}) {
      const track = doc.tracks.find(track => track.type === "audio");
      if (!track) throw new Error("AU output requires an audio stream");
      const description = track.codecDescriptions[0];
      const codec = options.audioCodec === "copy" ? description?.codecName : options.audioCodec ?? "pcm_s16be";
      const encoding = [...encodings].find(([, format]) => `pcm_${format}` === codec);
      if (!encoding) throw new Error(`Unsupported AU audio codec '${codec}'`);
      const sampleRate = track.decodedAudio?.sampleRate ?? description?.sampleRate;
      const channels = track.decodedAudio?.channels ?? description?.channels;
      if (!sampleRate || !channels) throw new Error("AU output requires sample rate and channels");
      const data = raw.find(plugin => plugin.id === encoding[1])!.serialize(doc, options);
      const metadata = options.metadata ?? doc.metadata;
      const annotation = new TextEncoder().encode((["title", "artist"] as const)
        .filter(key => metadata[key])
        .map(key => `${key[0]!.toUpperCase()}${key.slice(1)}=${metadata[key]}`)
        .join("\n"));
      const offset = 24 + Math.max(8, Math.ceil((annotation.length + 1) / 8) * 8);
      options.budget?.checkOutputBytes(offset + data.length);
      const bytes = new Uint8Array(offset + data.length);
      const view = new DataView(bytes.buffer);
      [0x2e736e64, offset, data.length, encoding[0], sampleRate, channels].forEach((value, i) => view.setUint32(i * 4, value));
      bytes.set(annotation, 24);
      bytes.set(data, offset);
      return bytes;
    }
  };
}
