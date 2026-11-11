import { encodeId3 } from "@poe-code/audio-ast";
import { MediaBudgetTracker, type MediaAstPlugin, type MediaDocument, type MediaSample, type ParseMediaOptions, type SerializeMediaOptions } from "../types.js";
import { buildProbeResultFromDoc, concatMp4, sliceMp4 } from "../mp4.js";
import { rawAudioAsts } from "./raw-audio.js";
import { parseImaQt } from "./aiff-ima.js";
import { encodeImaQt } from "./aiff-ima-encoder.js";
import { parseId3 } from "@poe-code/audio-ast";

const pcm = rawAudioAsts();
const codecs = ["pcm_s16be", "pcm_s8", "pcm_s24be", "pcm_s32be", "pcm_s16le", "pcm_f32be", "pcm_f64be", "pcm_alaw", "pcm_mulaw", "adpcm_ima_qt"];

export function parseAiff(bytes: Uint8Array, options: ParseMediaOptions = {}): MediaDocument {
  const budget = options.budget ?? new MediaBudgetTracker(options.limits);
  budget.checkInputBytes(bytes.length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (bytes.length < 12 || text(0, 4) !== "FORM" || !["AIFF", "AIFC"].includes(text(8, 4))) throw new Error("Invalid or unsupported AIFF header");
  const end = Math.min(view.getUint32(4) + 8, bytes.length);
  if (end < 12) throw new Error("Truncated AIFF FORM");
  const compressed = text(8, 4) === "AIFC";
  let littleEndian = false;
  let compressedFormat: string | undefined;
  let channelLayout: string | undefined;
  let channelMask: number | undefined;
  let channels = 0, frames = 0, bits = 0, sampleRate = 0;
  let sound: Uint8Array | undefined;
  const metadata: { title?: string; copyright?: string; comment?: string; custom?: Record<string, string> } = {};
  for (let offset = 12; offset < end;) {
    budget.checkCpu();
    // FORM limits chunk starts; complete chunks may extend beyond its declared size.
    if (offset + 8 > bytes.length) {
      if (channels && sound) break;
      throw new Error("Truncated AIFF chunk header");
    }
    const id = text(offset, 4), size = view.getUint32(offset + 4), start = offset + 8;
    if (id !== "SSND" && start + size + size % 2 > bytes.length) {
      // A damaged unknown trailer does not invalidate audio already read.
      if (channels && sound && !["COMM", "NAME", "AUTH", "(c) ", "ANNO"].includes(id)) break;
      throw new Error("Truncated AIFF chunk");
    }
    if (id === "COMM") {
      if (size < (compressed ? 22 : 18)) throw new Error("Invalid AIFF COMM chunk");
      if (compressed) {
        const compression = text(start + 18, 4);
        if (!["sowt", "NONE", "fl32", "fl64", "alaw", "ulaw", "ima4"].includes(compression)) throw new Error(`Unsupported AIFF-C compression: ${compression}`);
        littleEndian = compression === "sowt";
        compressedFormat = compression === "fl32" ? "f32be" : compression === "fl64" ? "f64be"
          : compression === "ima4" ? "ima4" : compression === "alaw" ? "alaw" : compression === "ulaw" ? "mulaw" : undefined;
      }
      channels = view.getUint16(start);
      frames = view.getUint32(start + 2);
      bits = view.getUint16(start + 6);
      const exponent = view.getUint16(start + 8);
      const mantissa = view.getUint32(start + 10) * 2 ** 32 + view.getUint32(start + 14);
      sampleRate = Math.round(mantissa * 2 ** (exponent - 16383 - 63));
      if (exponent & 0x8000 || !Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new Error("Invalid AIFF sample rate");
    } else if (id === "CHAN" && size >= 12) {
      const tag = view.getUint32(start);
      // Core Audio's bitmap uses the WAVE speaker positions for its low 18 bits.
      const bitmap = view.getUint32(start + 4);
      channelMask = tag === 0x10000 && bitmap > 0 && bitmap < 0x40000 ? bitmap : undefined;
      channelLayout = tag === 0x00640001 ? "mono" : tag === 0x00650002 ? "stereo" : undefined;
    } else if (id === "ID3 ") {
      Object.assign(metadata, parseId3(bytes.subarray(start, start + size)).tags);
    } else if (["NAME", "AUTH", "(c) ", "ANNO"].includes(id)) {
      const value = new TextDecoder().decode(bytes.subarray(start, start + size)).split("\0", 1)[0]!;
      if (id === "NAME") metadata.title = value;
      else if (id === "AUTH") metadata.custom = { author: value };
      else if (id === "(c) ") metadata.copyright = value;
      else metadata.comment = value;
    } else if (id === "SSND") {
      if (options.seekable === false && !channels) throw new Error("AIFF file is not seekable: SSND precedes COMM");
      const available = Math.min(size, bytes.length - start);
      if (available < 8) throw new Error("Invalid AIFF SSND chunk");
      const skip = view.getUint32(start);
      sound = bytes.subarray(start + 8 + skip, start + available);
      // Pipes cannot seek back after scanning later sound chunks.
      if (channels && ["-", "pipe:", "pipe:0"].includes(options.filename ?? "")) break;
    }
    offset = start + size + size % 2;
  }
  if (!channels || !sound || (!compressedFormat && (bits < 1 || bits > 32))) throw new Error("Missing or unsupported AIFF audio format");
  const speakers = ["FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC", "BC", "SL", "SR", "TC", "TFL", "TFC", "TFR", "TBL", "TBC", "TBR"]
    .filter((_, bit) => ((channelMask ?? 0) & (1 << bit)) !== 0);
  if (speakers.length !== channels) channelMask = undefined;
  const layouts: Record<number, string> = {
    4: "mono", 3: "stereo", 11: "2.1", 7: "3.0", 259: "3.0(back)",
    15: "3.1", 263: "4.0", 51: "quad", 1539: "quad(side)",
    271: "4.1", 55: "5.0", 1543: "5.0(side)", 63: "5.1", 1551: "5.1(side)",
    1799: "6.0", 1807: "6.1", 1591: "7.0", 1599: "7.1", 255: "7.1(wide)"
  };
  if (channelMask !== undefined) channelLayout = layouts[channelMask] ?? `${channels} channels (${speakers.join("+")})`;
  if (compressedFormat === "ima4") {
    const doc = parseImaQt(sound, channels, sampleRate, frames, options, budget);
    return { ...doc, metadata, byteLength: bytes.length, tracks: doc.tracks.map(track => ({ ...track, declaredSampleCount: frames,
      codecDescriptions: track.codecDescriptions.map(desc => ({ ...desc, channelLayout })),
      ...(track.decodedAudio && channelMask ? { decodedAudio: { ...track.decodedAudio, channelMask } } : {}),
      samples: track.samples.map(sample => ({ ...sample, offset: sample.data.byteOffset - bytes.byteOffset }))
    })) };
  }
  bits = Math.ceil(bits / 8) * 8;
  budget.checkDuration(frames / sampleRate);
  const format = compressedFormat ?? (bits === 8 ? "s8" : `s${bits}${littleEndian ? "le" : "be"}`);
  const doc = pcm.find(plugin => plugin.id === format)!.parse(sound, { ...options, budget, channels, sampleRate });
  // COMM describes duration; SSND determines the available PCM samples.
  return { ...doc, duration: frames, durationSeconds: frames / sampleRate,
    tracks: doc.tracks.map(track => {
      const bytesPerFrame = channels * track.codecDescriptions[0]!.bitsPerSample! / 8;
      // AIFF reads up to 4096 bytes, rounded down to complete sample frames.
      const packetFrames = Math.max(1, Math.floor(4096 / bytesPerFrame));
      budget.checkSamples(Math.ceil(sound.length / (packetFrames * bytesPerFrame)));
      const samples: MediaSample[] = [];
      for (let start = 0; start * bytesPerFrame < sound.length; start += packetFrames) {
        budget.checkCpu();
        const data = sound.subarray(start * bytesPerFrame, (start + packetFrames) * bytesPerFrame);
        samples.push({ data, size: data.length, offset: data.byteOffset - bytes.byteOffset,
          dts: start, pts: start, cts: 0, duration: Math.floor(data.length / bytesPerFrame),
          isKeyframe: true, sampleDescriptionIndex: 1 });
      }
      return { ...track, duration: frames, declaredSampleCount: frames, samples,
        codecDescriptions: track.codecDescriptions.map(desc => ({ ...desc, channelLayout,
          ...(!compressed ? { formatFourCC: "\0\0\0\0" } : {}) })),
        ...(track.decodedAudio && channelMask ? { decodedAudio: { ...track.decodedAudio, channelMask } } : {}),
        ...(options.decodeAudio !== false && sound.length % bytesPerFrame ? {
          decodeErrors: [`Invalid PCM packet: ${sound.length % bytesPerFrame} trailing bytes cannot form a ${bytesPerFrame}-byte sample frame`]
        } : {})
      };
    }), metadata: { ...doc.metadata, ...metadata }, containerFormat: "aiff", byteLength: bytes.length };
}

export function serializeAiff(doc: MediaDocument, options: SerializeMediaOptions = {}): Uint8Array {
  const version = options.id3v2Version ?? 4;
  if (version !== 3 && version !== 4) throw new Error("Invalid AIFF ID3v2 version: expected 3 or 4");
  const tags = Object.fromEntries(Object.entries(options.metadata ?? doc.metadata)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""));
  const id3 = options.writeId3v2 ? encodeId3(tags, [], [], version) : undefined;
  const track = doc.tracks.find(item => item.type === "audio");
  if (!track) throw new Error("AIFF output requires an audio stream");
  const desc = track.codecDescriptions[0];
  const codec = options.audioCodec === "copy" ? desc?.codecName : options.audioCodec ?? "pcm_s16be";
  if (!codec || !codecs.includes(codec)) throw new Error(`Codec ${codec} not supported in AIFF format`);
  const raw = pcm.find(plugin => `pcm_${plugin.id}` === codec)!;
  const ima = codec === "adpcm_ima_qt";
  let data: Uint8Array;
  if (ima && options.audioCodec === "copy") {
    const size = track.samples.reduce((sum, sample) => sum + sample.data.length, 0);
    options.budget?.checkOutputBytes(size);
    options.budget?.allocateMemory(size);
    data = new Uint8Array(size);
    let offset = 0;
    for (const sample of track.samples) {
      options.budget?.checkCpu();
      data.set(sample.data, offset);
      offset += sample.data.length;
    }
  } else if (ima) {
    if (!track.decodedAudio) throw new Error("QuickTime IMA encoding requires decoded audio");
    data = encodeImaQt(track.decodedAudio.channelData, options.budget);
  } else {
    data = raw.serialize(doc, { ...options, audioCodec: options.audioCodec === "copy" ? "copy" : codec });
  }
  const channels = track.decodedAudio?.channels ?? desc?.channels ?? 0;
  const sampleRate = track.decodedAudio?.sampleRate ?? desc?.sampleRate ?? 0;
  const g711 = codec === "pcm_alaw" || codec === "pcm_mulaw";
  const bits = ima ? 4 : g711 ? 8 : Number.parseInt(codec.slice(5), 10);
  const frames = ima ? data.length / (channels * 34) : data.length / (channels * bits / 8);
  if (!Number.isSafeInteger(frames) || channels < 1 || channels > 65535 ||
      !Number.isSafeInteger(sampleRate) || sampleRate < 1 || sampleRate > 0xffffffff || frames > 0xffffffff) {
    throw new Error("Invalid AIFF audio dimensions");
  }
  const metadata = options.metadata ?? doc.metadata;
  const textChunks = [
    ["NAME", metadata.title], ["AUTH", metadata.custom?.author],
    ["(c) ", metadata.copyright], ["ANNO", metadata.comment]
  ].flatMap(([id, value]) => value ? [{ id: id!, data: new TextEncoder().encode(value) }] : []);
  const compression = ima ? "ima4" : g711 ? (codec === "pcm_alaw" ? "alaw" : "ulaw") : codec === "pcm_s16le" ? "sowt" : codec.startsWith("pcm_f") ? `fl${bits}` : undefined;
  let textOffset = compression ? 24 : 12;
  const comm = textOffset + textChunks.reduce((sum, chunk) => sum + 8 + chunk.data.length + chunk.data.length % 2, 0);
  const sound = comm + (compression ? 32 : 26);
  const id3Offset = sound + 16 + data.length + data.length % 2;
  const size = id3Offset + (id3 ? 8 + id3.length + id3.length % 2 : 0);
  if (size - 8 > 0xffffffff) throw new Error("AIFF output exceeds FORM size limit");
  options.budget?.checkOutputBytes(size);
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
  text(0, "FORM"); view.setUint32(4, options.seekable === false ? 0 : size - 8); text(8, compression ? "AIFC" : "AIFF");
  if (compression) {
    text(12, "FVER"); view.setUint32(16, 4); view.setUint32(20, 0xa2805140);
    text(comm + 26, compression); // Followed by an empty, padded Pascal compression name.
  }
  text(comm, "COMM"); view.setUint32(comm + 4, compression ? 24 : 18);
  view.setUint16(comm + 8, channels); view.setUint32(comm + 10, options.seekable === false ? 0 : frames); view.setUint16(comm + 14, bits);
  const exponent = Math.floor(Math.log2(sampleRate));
  const mantissa = sampleRate * 2 ** (63 - exponent);
  view.setUint16(comm + 16, exponent + 16383);
  view.setUint32(comm + 18, Math.floor(mantissa / 2 ** 32)); view.setUint32(comm + 22, mantissa % 2 ** 32);
  text(sound, "SSND"); view.setUint32(sound + 4, options.seekable === false ? 0 : data.length + 8);
  bytes.set(data, sound + 16);
  for (const chunk of textChunks) {
    text(textOffset, chunk.id); view.setUint32(textOffset + 4, chunk.data.length);
    bytes.set(chunk.data, textOffset + 8);
    textOffset += 8 + chunk.data.length + chunk.data.length % 2;
  }
  if (id3) {
    text(id3Offset, "ID3 "); view.setUint32(id3Offset + 4, id3.length);
    bytes.set(id3, id3Offset + 8);
  }
  return bytes;
}

export function aiffAst(): MediaAstPlugin {
  return {
    id: "aiff", formatName: "aiff", formatLongName: "Audio IFF",
    extensions: ["aiff", "aif"], mimeTypes: ["audio/aiff", "audio/x-aiff"],
    canDemux: true, canMux: true, supportedVideoCodecs: [], supportedAudioCodecs: codecs,
    detect(bytes) {
      return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "FORM" &&
        ["AIFF", "AIFC"].includes(String.fromCharCode(...bytes.subarray(8, 12)));
    },
    parse: parseAiff, serialize: serializeAiff,
    probe(bytes, options) {
      const doc = parseAiff(bytes, { ...options, decodeAudio: false });
      const probe = buildProbeResultFromDoc(doc, bytes.length, options?.filename, {
        ...options, formatName: "aiff", formatLongName: "Audio IFF"
      });
      return { ...probe, packetData: probe.packets && new Map(probe.packets.map((packet, index) =>
        [`${packet.pos}:${packet.size}`, doc.tracks[0]!.samples[index]!.data])) };
    },
    concat: concatMp4, slice: sliceMp4
  };
}
