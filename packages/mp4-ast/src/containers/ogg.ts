import { readOgg, normalizeVorbisCommentKey, writeAudioMetadata } from "@poe-code/audio-ast";
import { encodeOggAudio } from "@poe-code/media-codecs";
import { decodeOpusPackets } from "../opus.js";
import { concatBytes } from "../binary.js";
import type { MediaDocument, MediaProbeSource, MediaSample, MediaTrack, SerializeMediaOptions } from "../types.js";
import { encodeFlacPackets } from "./flac.js";

function page(packet: Uint8Array, sequence: number, flags: number, granule: number, serial = 1): Uint8Array {
  const segments = Math.floor(packet.length / 255) + 1;
  if (segments > 255) throw new Error("Ogg packet exceeds one-page encoder limit");
  const bytes = new Uint8Array(27 + segments + packet.length);
  bytes.set([79, 103, 103, 83, 0, flags]);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(6, BigInt(granule), true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  bytes[26] = segments;
  bytes.fill(255, 27, 27 + segments - 1);
  bytes[27 + segments - 1] = packet.length % 255;
  bytes.set(packet, 27 + segments);
  view.setUint32(22, oggCrc(bytes), true);
  return bytes;
}

/** Ogg FLAC mapping version 1.0: preserve PCM without introducing a lossy codec. */
export function serializeOggFlac(doc: MediaDocument, compressionLevel?: number, sampleFormat?: string): Uint8Array {
  const [header, ...frames] = encodeFlacPackets(doc, false, compressionLevel, sampleFormat);
  if (!header || header.length !== 42 || frames.length === 0) throw new Error("Ogg FLAC encoding requires decoded PCM audio");
  const identification = new Uint8Array(51);
  identification.set([0x7f, 70, 76, 65, 67, 1, 0, 0, 1]);
  identification.set(header, 9);
  identification[13] = 0; // STREAMINFO is followed by VORBIS_COMMENT
  const comments = new Uint8Array([0x84, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0]);
  const pages = [page(identification, 0, 2, 0), page(comments, 1, 0, 0)];
  const total = Number(new DataView(header.buffer, header.byteOffset + 18, 8).getBigUint64(0) & 0xfffffffffn);
  for (let i = 0; i < frames.length; i++) {
    pages.push(page(frames[i]!, i + 2, i === frames.length - 1 ? 4 : 0, Math.min(total, (i + 1) * 2048)));
  }
  return concatBytes(pages);
}

function oggCrc(bytes: Uint8Array, crc = 0, offset = 0): number {
  for (let i = 0; i < bytes.length; i++) {
    const byte = offset + i >= 22 && offset + i < 26 ? 0 : bytes[i]!;
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ ((crc & 0x80000000) ? 0x04c11db7 : 0);
  }
  return crc >>> 0;
}

export function extractOggFlac(bytes: Uint8Array): Uint8Array | undefined {
  const packets: Uint8Array[] = [];
  let pending: Uint8Array[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 27 > bytes.length) throw new Error("Truncated Ogg page");
    if (bytes[offset] !== 79 || bytes[offset + 1] !== 103 || bytes[offset + 2] !== 103 || bytes[offset + 3] !== 83) throw new Error("Invalid Ogg page");
    const segments = bytes[offset + 26]!;
    const start = offset + 27 + segments;
    if (start > bytes.length) throw new Error("Truncated Ogg lacing table");
    let length = 0;
    for (let i = 0; i < segments; i++) length += bytes[offset + 27 + i]!;
    if (start + length > bytes.length) throw new Error("Truncated Ogg packet");
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, start + length - offset);
    if (view.getUint32(22, true) !== oggCrc(bytes.subarray(offset, start + length))) throw new Error("Ogg CRC mismatch");
    if (Boolean(bytes[offset + 5]! & 1) !== (pending.length > 0)) throw new Error("Invalid Ogg packet continuation");
    let cursor = start;
    for (let i = 0; i < segments; i++) {
      const size = bytes[offset + 27 + i]!;
      pending.push(bytes.subarray(cursor, cursor + size));
      cursor += size;
      if (size < 255) {
        packets.push(concatBytes(pending));
        pending = [];
        if (packets.length === 1) {
          const first = packets[0]!;
          if (first[0] !== 0x7f || first[1] !== 70 || first[2] !== 76 || first[3] !== 65 || first[4] !== 67) return undefined;
        }
      }
    }
    offset = start + length;
  }
  if (pending.length) throw new Error("Truncated Ogg packet");
  const first = packets[0];
  if (!first) return undefined;
  if (first.length !== 51 || first[5] !== 1) throw new Error("Unsupported Ogg FLAC mapping");
  return concatBytes([first.subarray(9), ...packets.slice(1)]);
}


export function serializeOgg(doc: MediaDocument, options: SerializeMediaOptions = {}): Uint8Array {
  const codec = options.audioCodec ?? (options.format === "opus" ? "opus" : "vorbis");
  if (codec === "flac") return serializeOggFlac(doc, options.compressionLevel, options.sampleFormat);
  if (codec === "copy") {
    const track = doc.tracks[0];
    if (doc.tracks.length === 1 && track?.codecDescriptions[0]?.codecName === "vorbis" && !track.codecDescriptions[0].extraData) {
      const tags = Object.fromEntries(Object.entries(track.metadata ?? doc.metadata).filter(([, value]) => typeof value === "string"));
      return writeAudioMetadata(concatBytes(track.samples.map(sample => sample.data)), tags);
    }
    const headers: Uint8Array[] = [], bodies: Uint8Array[] = [];
    for (const [index, track] of doc.tracks.entries()) {
      const description = track.codecDescriptions[0];
      if (description?.codecName !== "opus" || !description.extraData) throw new Error("Ogg stream copy requires Opus packets");
      const serial = index + 1;
      headers.push(page(description.extraData, 0, 2, 0, serial));
      const comments = Object.entries(track.metadata ?? doc.metadata).map(([key, value]) => new TextEncoder().encode(`${key}=${value}`));
      const tags = new Uint8Array(16 + comments.reduce((size, comment) => size + 4 + comment.length, 0));
      tags.set(new TextEncoder().encode("OpusTags"));
      const view = new DataView(tags.buffer);
      view.setUint32(12, comments.length, true);
      let offset = 16;
      for (const comment of comments) {
        view.setUint32(offset, comment.length, true); tags.set(comment, offset + 4); offset += 4 + comment.length;
      }
      headers.push(page(tags, 1, 0, 0, serial));
      let granule = 0;
      for (const [sampleIndex, sample] of track.samples.entries()) {
        granule += opusPacketDuration(sample.data) - Math.round((sample.discardPaddingNs ?? 0) * 48000 / 1e9);
        bodies.push(page(sample.data, sampleIndex + 2, sampleIndex === track.samples.length - 1 ? 4 : 0, granule, serial));
      }
    }
    // All identification pages must precede the remaining headers and audio.
    return concatBytes([...headers.filter((_, index) => index % 2 === 0), ...headers.filter((_, index) => index % 2 === 1), ...bodies]);
  }
  const audio = doc.tracks.find(track => track.type === "audio")?.decodedAudio;
  if (!audio) throw new Error("Ogg encoding requires decoded PCM audio");
  if (codec !== "vorbis" && codec !== "libvorbis" && codec !== "opus" && codec !== "libopus") {
    throw new Error(`Unsupported Ogg audio codec: ${codec}`);
  }
  const encoded = encodeOggAudio(codec === "opus" || codec === "libopus" ? "opus" : "vorbis", audio.sampleRate,
    audio.channelData.map(channel => channel instanceof Float32Array ? channel : Float32Array.from(channel)), options.audioBitrate);
  const pages = encoded.headers.map((header, index) => page(header, index, index === 0 ? 2 : 0, 0));
  for (let index = 0; index < encoded.packets.length; index++) {
    const packet = encoded.packets[index]!;
    pages.push(page(packet.data, index + encoded.headers.length, index === encoded.packets.length - 1 ? 4 : 0, packet.granule));
  }
  const tags = Object.fromEntries(Object.entries(options.metadata ?? doc.metadata).filter(([, value]) => typeof value === "string"));
  const bytes = concatBytes(pages);
  return Object.keys(tags).length ? writeAudioMetadata(bytes, tags) : bytes;
}

/** Read the existing FLAC mapping without retaining packets or encoded audio. */
export async function readOggFlacHeader(source: MediaProbeSource, options: { signal?: AbortSignal; checkpoint?: () => void | Promise<void> } = {}): Promise<{ header: Uint8Array; size: number } | undefined> {
  options.signal?.throwIfAborted();
  if (!Number.isSafeInteger(source.size) || source.size < 0) throw new RangeError("Invalid Ogg source size");
  const identification = new Uint8Array(51);
  let offset = 0, packetSize = 0, firstSize = -1, payloadSize = 0, mapped = false;
  const read = async (length: number) => {
    if (length > source.size - offset) throw new Error("Truncated Ogg page");
    const bytes = new Uint8Array(length);
    for (let used = 0; used < length;) {
      options.signal?.throwIfAborted();
      const chunk = await source.read(offset, length - used);
      options.signal?.throwIfAborted();
      if (!chunk.length) throw new Error("Truncated Ogg page");
      if (chunk.length > length - used) throw new Error("Ogg source returned more bytes than requested");
      bytes.set(chunk, used); used += chunk.length; offset += chunk.length;
    }
    await options.checkpoint?.(); options.signal?.throwIfAborted();
    return bytes;
  };
  while (offset < source.size) {
    const start = offset, header = await read(27);
    if (header[0] !== 79 || header[1] !== 103 || header[2] !== 103 || header[3] !== 83) throw new Error("Invalid Ogg page");
    const lacing = await read(header[26]!);
    let checksum = oggCrc(lacing, oggCrc(header), 27);
    const continuation = Boolean(header[5]! & 1) !== (packetSize > 0);
    let remaining = 0, chunk: Uint8Array = new Uint8Array(), used = 0;
    for (const length of lacing) remaining += length;
    for (const length of lacing) {
      for (let pending = length; pending;) {
        if (used === chunk.length) {
          chunk = await read(Math.min(16384, remaining)); used = 0;
          checksum = oggCrc(chunk, checksum, offset - start - chunk.length);
          remaining -= chunk.length;
        }
        const take = Math.min(pending, chunk.length - used);
        if (firstSize < 0 && packetSize < identification.length) identification.set(chunk.subarray(used, used + Math.min(take, identification.length - packetSize)), packetSize);
        packetSize += take; payloadSize += take; used += take; pending -= take;
      }
      if (length < 255) {
        if (firstSize < 0) {
          firstSize = packetSize;
          mapped = firstSize >= 5 && identification[0] === 127 && identification[1] === 70 && identification[2] === 76 && identification[3] === 65 && identification[4] === 67;
        }
        packetSize = 0;
      }
    }
    if (checksum !== new DataView(header.buffer).getUint32(22, true)) throw new Error("Ogg CRC mismatch");
    if (continuation) throw new Error("Invalid Ogg packet continuation");
    if (firstSize >= 0 && !mapped) return undefined;
  }
  if (packetSize) throw new Error("Truncated Ogg packet");
  if (firstSize < 0) return undefined;
  if (firstSize !== 51 || identification[5] !== 1) throw new Error("Unsupported Ogg FLAC mapping");
  return { header: identification.subarray(9), size: payloadSize - 9 };
}

function opusPacketDuration(data: Uint8Array): number {
  const toc = data[0];
  if (toc === undefined) throw new Error("Empty Opus packet");
  const config = toc >>> 3;
  const frameSamples = config >= 16 ? 120 * 2 ** (config & 3)
    : config >= 12 ? 480 * 2 ** (config & 1) : [480, 960, 1920, 2880][config & 3]!;
  const frames = (toc & 3) === 0 ? 1 : (toc & 3) === 3 ? (data[1] ?? 0) & 63 : 2;
  const duration = frames * frameSamples;
  if (!duration || duration > 5760) throw new Error("Invalid Opus packet duration");
  return duration;
}

/** Keep simultaneous logical streams separate and join compatible sequential links. */
export function demuxOggOpus(bytes: Uint8Array, doc: MediaDocument, decodeAudio = false): MediaDocument {
  const { packets } = readOgg(bytes);
  const lanes: typeof packets[] = [];
  const serialLanes = new Map<number, number>();
  const active = new Set<number>();
  const tracks: MediaTrack[] = [];
  let ordinal = 0, streamIndex = 0;
  for (const packet of packets) {
    if (packet.bos) {
      if (!active.size) ordinal = 0;
      const lane = ordinal++;
      serialLanes.set(packet.serial, lane);
      active.add(packet.serial);
      if (!lanes[lane]) {
        lanes[lane] = [];
        tracks[lane] = doc.tracks[streamIndex]!;
      } else {
        tracks[lane] = { ...tracks[lane]!, duration: tracks[lane]!.duration + doc.tracks[streamIndex]!.duration };
      }
      streamIndex++;
    }
    lanes[serialLanes.get(packet.serial)!]!.push(packet);
    if (packet.eos) active.delete(packet.serial);
  }
  return { ...doc, tracks: lanes.map((packets, index) => {
    const head = packets[0]!.data;
    const preSkip = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint16(10, true);
    const samples: MediaSample[] = [];
    let serial: number | undefined, ended = true, headerIndex = 0, position = 0, pts = -preSkip;
    for (const packet of packets) {
      if (packet.bos) {
        if (!ended || packet.data.length !== head.length || packet.data.some((byte, index) => byte !== head[index])) {
          throw new Error("Unsupported multiplexed or incompatible chained Ogg Opus streams");
        }
        serial = packet.serial;
        ended = false;
        headerIndex = 0;
        position = 0;
      }
      if (packet.serial !== serial) throw new Error("Unsupported multiplexed Ogg Opus streams");
      if (headerIndex++ < 2) continue;
      const data = packet.data, duration = opusPacketDuration(data);
      position += duration;
      const padding = packet.eos ? position - Number(packet.granule) : 0;
      if (padding < 0 || padding > duration) throw new Error("Invalid Opus final granule");
      samples.push({ data, pts, dts: pts, cts: 0, duration: duration - padding,
        size: data.length, isKeyframe: true, sampleDescriptionIndex: 1,
        ...(padding ? { discardPaddingNs: Math.round(padding * 1e9 / 48000) } : {}) });
      pts += duration - padding;
      ended = packet.eos;
    }
    const track = tracks[index]!;
    return { ...track, id: index + 1, samples,
      ...(decodeAudio ? { decodedAudio: decodeOpusPackets(packets) } : {}),
      metadata: Object.fromEntries(Object.entries(track.metadata ?? {}).map(([key, value]) => [normalizeVorbisCommentKey(key), value])),
      codecDelayNs: preSkip * 1e9 / 48000, seekPreRollNs: 80_000_000,
      codecDescriptions: [{ ...track.codecDescriptions[0]!, extraData: head }]
    };
  }) };
}
