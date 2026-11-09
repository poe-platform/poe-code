import { MediaBudgetTracker, type MediaAstPlugin, type ParseMediaOptions } from "../types.js";
import { buildProbeResultFromDoc } from "../mp4.js";
import { concatBytes } from "../binary.js";
import { rawAudioAsts } from "./raw-audio.js";

const signature = new TextEncoder().encode("Creative Voice File\x1a");
const encodings = new Map([[0, "u8"], [4, "s16le"], [6, "alaw"], [7, "mulaw"]]);
const raw = rawAudioAsts();

function detect(bytes: Uint8Array): boolean {
  return bytes.length >= 26 && signature.every((byte, index) => bytes[index] === byte);
}

function parseVoc(bytes: Uint8Array, options: ParseMediaOptions = {}) {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.length);
  if (!detect(bytes)) throw new Error("Invalid VOC header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = view.getUint16(20, true);
  if (offset < 26 || offset > bytes.length) throw new Error("Invalid VOC data offset");
  let format: string | undefined;
  let sampleRate = 0, channels = 0, size = 0;
  const parts: Uint8Array[] = [];
  while (offset < bytes.length) {
    budget.checkCpu();
    const type = bytes[offset++]!;
    if (type === 0) break;
    if (offset + 3 > bytes.length) throw new Error("Truncated VOC block header");
    const length = bytes[offset]! + bytes[offset + 1]! * 256 + bytes[offset + 2]! * 65536;
    offset += 3;
    const end = offset + length;
    if (end > bytes.length) throw new Error("Truncated VOC block");
    if (type === 9) {
      if (length < 12) throw new Error("Invalid VOC sound block");
      const nextFormat = encodings.get(view.getUint16(offset + 6, true));
      const rate = view.getUint32(offset, true), count = bytes[offset + 5]!;
      if (!nextFormat || bytes[offset + 4] !== (nextFormat === "s16le" ? 16 : 8)) {
        throw new Error("Unsupported VOC audio encoding");
      }
      if (!rate || !count) throw new Error("Invalid VOC sample rate or channel count");
      if (format && (format !== nextFormat || sampleRate !== rate || channels !== count)) {
        throw new Error("Changing VOC audio format is not supported");
      }
      format = nextFormat;
      sampleRate = rate;
      channels = count;
      offset += 12;
    } else if (type !== 2) {
      // Marker and text blocks carry no audio. Other block types require
      // timing or codec handling and must not silently discard samples.
      if (type !== 4 && type !== 5) throw new Error(`Unsupported VOC block type ${type}`);
      offset = end;
      continue;
    }
    if (!format) throw new Error("VOC continuation without sound format");
    size += end - offset;
    budget.checkSamples(parts.length + 1);
    parts.push(bytes.subarray(offset, end));
    offset = end;
  }
  if (!format) throw new Error("VOC contains no audio");
  budget.allocateMemory(size);
  const doc = raw.find(plugin => plugin.id === format)!.parse(concatBytes(parts),
    { ...options, budget, sampleRate, channels });
  return { ...doc, containerFormat: "voc", byteLength: bytes.length };
}

export function vocAst(): MediaAstPlugin {
  return {
    id: "voc", formatName: "voc", formatLongName: "Creative Voice",
    extensions: ["voc"], mimeTypes: ["audio/x-voc"],
    canDemux: true, canMux: true, supportedVideoCodecs: [],
    supportedAudioCodecs: [...encodings.values()].map(format => `pcm_${format}`),
    detect, parse: parseVoc,
    probe(bytes, options = {}) {
      return buildProbeResultFromDoc(parseVoc(bytes, { ...options, decodeAudio: false }), bytes.length, options.filename,
        { ...options, formatName: "voc", formatLongName: "Creative Voice" });
    },
    serialize(doc, options = {}) {
      const track = doc.tracks.find(track => track.type === "audio");
      if (!track) throw new Error("VOC output requires an audio stream");
      const description = track.codecDescriptions[0];
      const codec = options.audioCodec === "copy" ? description?.codecName : options.audioCodec ?? "pcm_s16le";
      const encoding = [...encodings].find(([, format]) => `pcm_${format}` === codec);
      if (!encoding) throw new Error(`Unsupported VOC audio codec '${codec}'`);
      const sampleRate = track.decodedAudio?.sampleRate ?? description?.sampleRate;
      const channels = track.decodedAudio?.channels ?? description?.channels;
      if (!Number.isInteger(sampleRate) || !sampleRate || sampleRate < 1 || sampleRate > 0x7fffffff ||
          !Number.isInteger(channels) || !channels || channels < 1 || channels > 255) {
        throw new Error("Invalid VOC sample rate or channel count");
      }
      const data = raw.find(plugin => plugin.id === encoding[1])!.serialize(doc, options);
      const bits = encoding[1] === "s16le" ? 16 : 8;
      const frameBytes = channels * bits / 8;
      if (data.length % frameBytes) throw new Error("Incomplete VOC audio frame");
      // Block lengths are 24-bit and include the twelve-byte sound description.
      const blockBytes = Math.floor((0xffffff - 12) / frameBytes) * frameBytes;
      const blocks = Math.max(1, Math.ceil(data.length / blockBytes));
      const size = 26 + blocks * 16 + data.length + 1;
      options.budget?.checkOutputBytes(size);
      options.budget?.allocateMemory(size);
      const bytes = new Uint8Array(size);
      const view = new DataView(bytes.buffer);
      bytes.set(signature);
      view.setUint16(20, 26, true);
      view.setUint16(22, 0x0114, true);
      view.setUint16(24, (~0x0114 + 0x1234) & 0xffff, true);
      let offset = 26;
      for (let block = 0; block < blocks; block++) {
        options.budget?.checkCpu();
        const start = block * blockBytes;
        const payload = data.subarray(start, start + blockBytes);
        const length = 12 + payload.length;
        bytes[offset] = 9;
        bytes[offset + 1] = length & 255;
        bytes[offset + 2] = (length >> 8) & 255;
        bytes[offset + 3] = length >> 16;
        view.setUint32(offset + 4, sampleRate, true);
        bytes[offset + 8] = bits;
        bytes[offset + 9] = channels;
        view.setUint16(offset + 10, encoding[0], true);
        bytes.set(payload, offset + 16);
        offset += 16 + payload.length;
      }
      return bytes;
    }
  };
}
