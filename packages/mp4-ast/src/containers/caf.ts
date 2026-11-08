import { MediaBudgetTracker, type MediaAstPlugin, type ParseMediaOptions } from "../types.js";
import { buildProbeResultFromDoc, concatMp4, sliceMp4 } from "../mp4.js";
import { rawAudioAsts } from "./raw-audio.js";

const raw = rawAudioAsts();
const pcm = raw.filter(plugin => plugin.id !== "u8" && !["mulaw", "alaw"].includes(plugin.id));

function parseCaf(bytes: Uint8Array, options: ParseMediaOptions = {}) {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || view.getUint32(0) !== 0x63616666 || view.getUint16(4) !== 1) {
    throw new Error("Invalid CAF header");
  }
  let sampleRate = 0, channels = 0;
  let format: string | undefined;
  let data: Uint8Array | undefined;
  for (let offset = 8; offset < bytes.length;) {
    budget.checkCpu();
    if (offset + 12 > bytes.length) throw new Error("Truncated CAF chunk header");
    const id = view.getUint32(offset), start = offset + 12;
    const length = view.getBigInt64(offset + 4);
    const size = length === -1n && id === 0x64617461 ? bytes.length - start : Number(length);
    if (size < 0 || !Number.isSafeInteger(size) || size > bytes.length - start) throw new Error("Invalid CAF chunk bounds");
    if (id === 0x64657363) {
      if (format || size !== 32) throw new Error("Invalid CAF description");
      sampleRate = view.getFloat64(start);
      const flags = view.getUint32(start + 12);
      channels = view.getUint32(start + 24);
      const bits = view.getUint32(start + 28);
      const encoding = view.getUint32(start + 8);
      if (encoding === 0x756c6177 || encoding === 0x616c6177) {
        if (flags !== 0 || bits !== 8) throw new Error("Unsupported CAF audio encoding");
        format = encoding === 0x756c6177 ? "mulaw" : "alaw";
      } else {
        format = `${flags & 1 ? "f" : "s"}${bits}${bits === 8 ? "" : flags & 2 ? "le" : "be"}`;
        if (encoding !== 0x6c70636d || flags > 3 || !pcm.some(plugin => plugin.id === format)) {
          throw new Error("Unsupported CAF audio encoding");
        }
      }
      if (view.getUint32(start + 20) !== 1 ||
          view.getUint32(start + 16) !== channels * bits / 8) {
        throw new Error("Unsupported CAF audio encoding");
      }
    } else if (id === 0x64617461) {
      if (data || size < 4) throw new Error("Invalid CAF data chunk");
      data = bytes.subarray(start + 4, start + size);
    }
    offset = start + size;
  }
  if (!format || !data) throw new Error("Missing CAF description or data");
  const doc = raw.find(plugin => plugin.id === format)!.parse(data, { ...options, budget, sampleRate, channels });
  return { ...doc, containerFormat: "caf", byteLength: bytes.length };
}

export function cafAst(): MediaAstPlugin {
  return {
    id: "caf", formatName: "caf", formatLongName: "Apple CAF (Core Audio Format)",
    extensions: ["caf"], mimeTypes: ["audio/x-caf"],
    canDemux: true, canMux: true, supportedVideoCodecs: [],
    supportedAudioCodecs: pcm.map(plugin => `pcm_${plugin.id}`),
    detect: bytes => bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) === 0x63616666,
    parse: parseCaf,
    probe(bytes, options = {}) {
      return buildProbeResultFromDoc(parseCaf(bytes, { ...options, decodeAudio: false }), bytes.length, options.filename,
        { ...options, formatName: "caf", formatLongName: "Apple CAF (Core Audio Format)" });
    },
    serialize(doc, options = {}) {
      const track = doc.tracks.find(track => track.type === "audio");
      if (!track) throw new Error("CAF output requires an audio stream");
      const desc = track.codecDescriptions[0];
      const codec = options.audioCodec === "copy" ? desc?.codecName : options.audioCodec ?? "pcm_s16be";
      const raw = pcm.find(plugin => `pcm_${plugin.id}` === codec);
      if (!raw) throw new Error(`Unsupported CAF audio codec '${codec}'`);
      const sampleRate = track.decodedAudio?.sampleRate ?? desc?.sampleRate ?? 0;
      const channels = track.decodedAudio?.channels ?? desc?.channels ?? 0;
      if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 || sampleRate > 0xffffffff ||
          !Number.isSafeInteger(channels) || channels <= 0 || channels > 65535) throw new Error("Invalid CAF audio dimensions");
      const data = raw.serialize(doc, options);
      const bits = Number.parseInt(raw.id.slice(1), 10);
      const frameSize = channels * bits / 8;
      if (data.length % frameSize) throw new Error("Incomplete CAF sample frame");
      options.budget?.checkOutputBytes(68 + data.length);
      const bytes = new Uint8Array(68 + data.length), view = new DataView(bytes.buffer);
      view.setUint32(0, 0x63616666); view.setUint16(4, 1);
      view.setUint32(8, 0x64657363); view.setBigInt64(12, 32n);
      view.setFloat64(20, sampleRate); view.setUint32(28, 0x6c70636d);
      view.setUint32(32, (raw.id.startsWith("f") ? 1 : 0) | (raw.id.endsWith("le") ? 2 : 0));
      view.setUint32(36, frameSize); view.setUint32(40, 1);
      view.setUint32(44, channels); view.setUint32(48, bits);
      view.setUint32(52, 0x64617461); view.setBigInt64(56, BigInt(data.length + 4));
      bytes.set(data, 68);
      return bytes;
    },
    concat: concatMp4, slice: sliceMp4
  };
}
