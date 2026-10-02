import { encodeOggAudio } from "@poe-code/media-codecs";
import { concatBytes } from "../binary.js";
import type { MediaDocument, SerializeMediaOptions } from "../types.js";
import { encodeFlacPackets } from "./flac.js";

function page(packet: Uint8Array, sequence: number, flags: number, granule: number): Uint8Array {
  const segments = Math.floor(packet.length / 255) + 1;
  if (segments > 255) throw new Error("Ogg packet exceeds one-page encoder limit");
  const bytes = new Uint8Array(27 + segments + packet.length);
  bytes.set([79, 103, 103, 83, 0, flags]);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(6, BigInt(granule), true);
  view.setUint32(14, 1, true);
  view.setUint32(18, sequence, true);
  bytes[26] = segments;
  bytes.fill(255, 27, 27 + segments - 1);
  bytes[27 + segments - 1] = packet.length % 255;
  bytes.set(packet, 27 + segments);
  view.setUint32(22, oggCrc(bytes), true);
  return bytes;
}

/** Ogg FLAC mapping version 1.0: preserve PCM without introducing a lossy codec. */
export function serializeOggFlac(doc: MediaDocument): Uint8Array {
  const [header, ...frames] = encodeFlacPackets(doc);
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

function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = i >= 22 && i < 26 ? 0 : bytes[i]!;
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
  if (codec === "flac") return serializeOggFlac(doc);
  const audio = doc.tracks.find(track => track.type === "audio")?.decodedAudio;
  if (!audio) throw new Error("Ogg encoding requires decoded PCM audio");
  if (codec !== "vorbis" && codec !== "libvorbis" && codec !== "opus" && codec !== "libopus") {
    throw new Error(`Unsupported Ogg audio codec: ${codec}`);
  }
  const encoded = encodeOggAudio(codec === "opus" || codec === "libopus" ? "opus" : "vorbis", audio.sampleRate, audio.channelData);
  const pages = encoded.headers.map((header, index) => page(header, index, index === 0 ? 2 : 0, 0));
  for (let index = 0; index < encoded.packets.length; index++) {
    const packet = encoded.packets[index]!;
    pages.push(page(packet.data, index + encoded.headers.length, index === encoded.packets.length - 1 ? 4 : 0, packet.granule));
  }
  return concatBytes(pages);
}
