import { MediaBudgetTracker, type ParseMediaOptions, type MediaAstPlugin, type MediaSample } from "../types.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import { rawAudioAsts } from "./raw-audio.js";

const encodings = new Map([["s16le", 2], ["mulaw", 0x20001], ["alaw", 0x10001]]);
const raw = rawAudioAsts();

function littleEndianHeader(bytes: Uint8Array): boolean | undefined {
  if (bytes.length < 4) return undefined;
  const signature = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (signature === 0x0001a364) return true;
  if (signature === 0x64a30100) return false;
  return undefined;
}

function parseIrcam(bytes: Uint8Array, options: ParseMediaOptions = {}) {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const littleEndian = littleEndianHeader(bytes);
  if (bytes.length < 1024 || littleEndian === undefined) {
    throw new Error("Invalid IRCAM header");
  }
  const sampleRate = view.getFloat32(4, littleEndian);
  const channels = view.getUint32(8, littleEndian);
  const encoding = view.getUint32(12, littleEndian);
  const format = encoding === 4 ? `f32${littleEndian ? "le" : "be"}`
    : encoding === 2 ? `s16${littleEndian ? "le" : "be"}`
    : [...encodings].find(([, code]) => code === encoding)?.[0];
  if (!format) throw new Error("Unsupported IRCAM audio encoding");
  const doc = raw.find(plugin => plugin.id === format)!.parse(bytes.subarray(1024),
    { ...options, budget, sampleRate, channels });
  const track = doc.tracks[0]!;
  const frameBytes = channels * track.codecDescriptions[0]!.bitsPerSample! / 8;
  // The IRCAM demuxer targets 25 packets/second, capped at 1024 frames.
  const packetFrames = Math.max(1, Math.min(1024, Math.floor(sampleRate / 25)));
  const data = bytes.subarray(1024);
  budget.checkSamples(Math.ceil(data.length / (packetFrames * frameBytes)));
  const samples: MediaSample[] = [];
  for (let start = 0; start * frameBytes < data.length; start += packetFrames) {
    budget.checkCpu();
    const packet = data.subarray(start * frameBytes, (start + packetFrames) * frameBytes);
    samples.push({ data: packet, size: packet.length, offset: 1024 + start * frameBytes,
      dts: start, pts: start, cts: 0, duration: Math.floor(packet.length / frameBytes),
      isKeyframe: true, sampleDescriptionIndex: 1 });
  }
  return { ...doc, containerFormat: "ircam", byteLength: bytes.length, tracks: [{ ...track, samples }] };
}

export function ircamAst(): MediaAstPlugin {
  return {
    id: "ircam", formatName: "ircam", formatLongName: "Berkeley/IRCAM/CARL Sound Format",
    extensions: ["sf", "ircam"], mimeTypes: [],
    canDemux: true, canMux: true, supportedVideoCodecs: [],
    supportedAudioCodecs: [...encodings.keys()].map(format => `pcm_${format}`),
    detect: bytes => littleEndianHeader(bytes) !== undefined,
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
