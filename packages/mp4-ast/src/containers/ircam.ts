import { MediaBudgetTracker, type ParseMediaOptions, type MediaAstPlugin } from "../types.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import { rawAudioAsts } from "./raw-audio.js";

const encodings = new Map([["s16le", 2], ["mulaw", 0x20001], ["alaw", 0x10001]]);
const raw = rawAudioAsts();

function parseIrcam(bytes: Uint8Array, options: ParseMediaOptions = {}) {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 1024 || view.getUint32(0, true) !== 0x0001a364) {
    throw new Error("Invalid IRCAM header");
  }
  const sampleRate = view.getFloat32(4, true);
  const channels = view.getUint32(8, true);
  const format = [...encodings].find(([, code]) => code === view.getUint32(12, true))?.[0];
  if (!format) throw new Error("Unsupported IRCAM audio encoding");
  const doc = raw.find(plugin => plugin.id === format)!.parse(bytes.subarray(1024),
    { ...options, budget, sampleRate, channels });
  return { ...doc, containerFormat: "ircam", byteLength: bytes.length,
    tracks: doc.tracks.map(track => ({ ...track, samples: track.samples.map(sample => ({ ...sample,
      offset: sample.data.byteOffset - bytes.byteOffset
    })) })) };
}

export function ircamAst(): MediaAstPlugin {
  return {
    id: "ircam", formatName: "ircam", formatLongName: "Berkeley/IRCAM/CARL Sound Format",
    extensions: ["sf", "ircam"], mimeTypes: [],
    canDemux: true, canMux: true, supportedVideoCodecs: [],
    supportedAudioCodecs: [...encodings.keys()].map(format => `pcm_${format}`),
    detect: bytes => bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === 0x0001a364,
    parse: parseIrcam,
    probe(bytes, options = {}) {
      return buildProbeResultFromDoc(parseIrcam(bytes, { ...options, decodeAudio: false }), bytes.length, options.filename,
        { ...options, formatName: "ircam", formatLongName: "Berkeley/IRCAM/CARL Sound Format" });
    },
    serialize(doc, options = {}) {
      const track = doc.tracks.find(track => track.type === "audio");
      if (!track) throw new Error("IRCAM output requires an audio stream");
      const description = track.codecDescriptions[0];
      const codec = options.audioCodec === "copy" ? description?.codecName : options.audioCodec ?? "pcm_s16le";
      const format = codec?.startsWith("pcm_") ? codec.slice(4) : "";
      const encoding = encodings.get(format);
      if (encoding === undefined) throw new Error(`Unsupported IRCAM audio codec '${codec}'`);
      const sampleRate = track.decodedAudio?.sampleRate ?? description?.sampleRate;
      const channels = track.decodedAudio?.channels ?? description?.channels;
      if (!sampleRate || !channels) throw new Error("IRCAM output requires sample rate and channels");
      const data = raw.find(plugin => plugin.id === format)!.serialize(doc, options);
      options.budget?.checkOutputBytes(1024 + data.length);
      const bytes = new Uint8Array(1024 + data.length);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, 0x0001a364, true);
      view.setFloat32(4, sampleRate, true);
      view.setUint32(8, channels, true);
      view.setUint32(12, encoding, true);
      bytes.set(data, 1024);
      return bytes;
    }
  };
}
