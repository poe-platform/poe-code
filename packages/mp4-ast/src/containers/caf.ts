import { MediaBudgetTracker, type MediaSample, type MediaAstPlugin, type ParseMediaOptions } from "../types.js";
import { buildProbeResultFromDoc, concatMp4, sliceMp4 } from "../mp4.js";
import { rawAudioAsts } from "./raw-audio.js";

const raw = rawAudioAsts();
const cafAudio = rawAudioAsts().filter(plugin => plugin.id !== "u8");
const pcm = raw.filter(plugin => plugin.id !== "u8" && !["mulaw", "alaw"].includes(plugin.id));

function parseCaf(bytes: Uint8Array, options: ParseMediaOptions = {}) {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || view.getUint32(0) !== 0x63616666 || view.getUint16(4) !== 1) {
    throw new Error("Invalid CAF header");
  }
  let sampleRate = 0, channels = 0;
  let framesPerPacket = 0, bytesPerPacket = 0;
  let format: string | undefined;
  let data: Uint8Array | undefined;
  const metadata: { title?: string; artist?: string } = {};
  for (let offset = 8; offset < bytes.length;) {
    budget.checkCpu();
    if (offset + 12 > bytes.length) throw new Error("Truncated CAF chunk header");
    const id = view.getUint32(offset), start = offset + 12;
    if (offset === 8 && id !== 0x64657363) throw new Error("CAF description must be the first chunk");
    const length = view.getBigInt64(offset + 4);
    // A data chunk can declare more bytes than remain in a truncated file.
    // Like unknown-length data, consume the available payload through EOF.
    const size = id === 0x64617461 && (length === -1n || length > BigInt(bytes.length - start))
      ? bytes.length - start : Number(length);
    if (size < 0 || !Number.isSafeInteger(size) || size > bytes.length - start) throw new Error("Invalid CAF chunk bounds");
    if (id === 0x64657363) {
      if (format || size !== 32) throw new Error("Invalid CAF description");
      // FFmpeg exposes the CAF double as an integer sample rate.
      sampleRate = Math.trunc(view.getFloat64(start));
      const flags = view.getUint32(start + 12);
      channels = view.getUint32(start + 24);
      const bits = view.getUint32(start + 28);
      const encoding = view.getUint32(start + 8);
      if (encoding === 0x756c6177 || encoding === 0x616c6177) {
        if (flags !== 0 || bits !== 8) throw new Error("Unsupported CAF audio encoding");
        format = encoding === 0x756c6177 ? "mulaw" : "alaw";
      } else {
        // The explicit signed-integer bit (4) does not change LPCM byte order.
        format = `${flags & 1 ? "f" : "s"}${bits}${bits === 8 ? "" : flags & 2 ? "le" : "be"}`;
        if (encoding !== 0x6c70636d || flags > 7 || !pcm.some(plugin => plugin.id === format)) {
          throw new Error("Unsupported CAF audio encoding");
        }
      }
      framesPerPacket = view.getUint32(start + 20);
      bytesPerPacket = view.getUint32(start + 16);
      if (framesPerPacket === 0 || bytesPerPacket === 0 ||
          bytesPerPacket !== framesPerPacket * channels * bits / 8) {
        throw new Error("Unsupported CAF audio encoding");
      }
    } else if (id === 0x696e666f) {
      if (size < 4) throw new Error("Invalid CAF info chunk");
      const info = bytes.subarray(start + 4, start + size);
      const decoder = new TextDecoder();
      let cursor = 0;
      for (let entry = 0; entry < view.getUint32(start); entry++) {
        budget.checkCpu();
        const keyEnd = info.indexOf(0, cursor);
        const valueEnd = keyEnd < 0 ? -1 : info.indexOf(0, keyEnd + 1);
        if (valueEnd < 0) throw new Error("Truncated CAF info entry");
        const key = decoder.decode(info.subarray(cursor, keyEnd));
        if (key === "title" || key === "artist") {
          metadata[key] = decoder.decode(info.subarray(keyEnd + 1, valueEnd));
        }
        cursor = valueEnd + 1;
      }
    } else if (id === 0x64617461) {
      if (size < 4) throw new Error("Invalid CAF data chunk");
      // Seekable CAF input uses the final data chunk, matching FFmpeg.
      data = bytes.subarray(start + 4, start + size);
    }
    offset = start + size;
  }
  if (!format || !data) throw new Error("Missing CAF description or data");
  // CAF batches single-frame packets into at most 4096 bytes, aligned to
  // complete frames; multi-frame packets retain their declared boundaries.
  const packetBytes = framesPerPacket === 1
    ? Math.max(1, Math.floor(4096 / bytesPerPacket)) * bytesPerPacket : bytesPerPacket;
  budget.checkSamples(Math.ceil(data.length / packetBytes));
  const doc = raw.find(plugin => plugin.id === format)!.parse(data, { ...options, budget, sampleRate, channels });
  const samples: MediaSample[] = [];
  for (let start = 0; start < data.length; start += packetBytes) {
    budget.checkCpu();
    const packet = data.subarray(start, start + packetBytes);
    const pts = start * framesPerPacket / bytesPerPacket;
    samples.push({
      data: packet, size: packet.length, offset: data.byteOffset - bytes.byteOffset + start,
      dts: pts, pts, cts: 0, duration: Math.floor(packet.length * framesPerPacket / bytesPerPacket),
      isKeyframe: true, sampleDescriptionIndex: 1
    });
  }
  // CAF estimates stream duration from bytes, while packet durations and
  // decoded audio count only complete sample frames.
  const duration = Math.round(data.length * framesPerPacket / bytesPerPacket);
  budget.checkDuration(duration / sampleRate);
  return { ...doc, duration, durationSeconds: duration / sampleRate,
    metadata: { ...doc.metadata, ...metadata }, containerFormat: "caf", byteLength: bytes.length,
    tracks: doc.tracks.map(track => ({ ...track, duration,
      samples
    })) };
}

export function cafAst(): MediaAstPlugin {
  return {
    id: "caf", formatName: "caf", formatLongName: "Apple CAF (Core Audio Format)",
    extensions: ["caf"], mimeTypes: ["audio/x-caf"],
    canDemux: true, canMux: true, supportedVideoCodecs: [],
    supportedAudioCodecs: cafAudio.map(plugin => `pcm_${plugin.id}`),
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
      const raw = cafAudio.find(plugin => `pcm_${plugin.id}` === codec);
      if (!raw) throw new Error(`Unsupported CAF audio codec '${codec}'`);
      const sampleRate = track.decodedAudio?.sampleRate ?? desc?.sampleRate ?? 0;
      const channels = track.decodedAudio?.channels ?? desc?.channels ?? 0;
      if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 || sampleRate > 0xffffffff ||
          !Number.isSafeInteger(channels) || channels <= 0 || channels > 65535) throw new Error("Invalid CAF audio dimensions");
      const data = raw.serialize(doc, options);
      const companded = raw.id === "mulaw" || raw.id === "alaw";
      const bits = companded ? 8 : Number.parseInt(raw.id.slice(1), 10);
      const frameSize = channels * bits / 8;
      const metadata = options.metadata ?? doc.metadata;
      const entries: Uint8Array[] = [];
      for (const key of ["title", "artist"] as const) {
        const value = metadata[key];
        if (value === undefined) continue;
        if (value.includes("\0")) throw new Error("CAF metadata cannot contain null bytes");
        entries.push(new TextEncoder().encode(`${key}\0${value}\0`));
      }
      const infoSize = entries.length ? 16 + entries.reduce((size, entry) => size + entry.length, 0) : 0;
      options.budget?.checkOutputBytes(68 + infoSize + data.length);
      const bytes = new Uint8Array(68 + infoSize + data.length), view = new DataView(bytes.buffer);
      view.setUint32(0, 0x63616666); view.setUint16(4, 1);
      view.setUint32(8, 0x64657363); view.setBigInt64(12, 32n);
      view.setFloat64(20, sampleRate); view.setUint32(28, raw.id === "mulaw" ? 0x756c6177 : raw.id === "alaw" ? 0x616c6177 : 0x6c70636d);
      view.setUint32(32, (raw.id.startsWith("f") ? 1 : 0) | (raw.id.endsWith("le") ? 2 : 0));
      view.setUint32(36, frameSize); view.setUint32(40, 1);
      view.setUint32(44, channels); view.setUint32(48, bits);
      if (infoSize) {
        view.setUint32(52, 0x696e666f); view.setBigInt64(56, BigInt(infoSize - 12));
        view.setUint32(64, entries.length);
        let offset = 68;
        for (const entry of entries) { bytes.set(entry, offset); offset += entry.length; }
      }
      view.setUint32(52 + infoSize, 0x64617461); view.setBigInt64(56 + infoSize, BigInt(data.length + 4));
      bytes.set(data, 68 + infoSize);
      return bytes;
    },
    concat: concatMp4, slice: sliceMp4
  };
}
