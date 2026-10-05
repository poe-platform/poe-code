import { Reader } from "./binary.js";
import type { AudioStream } from "./types.js";

export interface OggIdentification {
  codec: "opus" | "vorbis";
  sampleRate: number;
  channels: number;
  preSkip: number;
}

/** Identification needs at most 276 bytes, even with the largest Opus mapping. */
export function oggIdentification(head: Uint8Array, size = head.length): OggIdentification {
  const r = new Reader(head);
  if (head.length >= 8 && r.text(0, 8) === "OpusHead") {
    if (size < 19 || r.u8(8) > 15) throw new Error("Invalid Opus identification");
    const channels = r.u8(9), preSkip = r.u16(10, true), mapping = r.u8(18);
    if (mapping === 0 && channels > 2) throw new Error("Invalid Opus channels");
    if (mapping !== 0) r.check(19, 2 + channels);
    return { codec: "opus", sampleRate: 48000, channels, preSkip };
  }
  if (head.length >= 7 && r.u8(0) === 1 && r.text(1, 6) === "vorbis") {
    if (size !== 30 || r.u32(7, true) !== 0 || !(r.u8(29) & 1)) throw new Error("Invalid Vorbis identification");
    return { codec: "vorbis", sampleRate: r.u32(12, true), channels: r.u8(11), preSkip: 0 };
  }
  throw new Error("Unsupported Ogg codec");
}

export function oggStream(identification: OggIdentification, final: bigint, size: number): AudioStream {
  const { codec, sampleRate, channels, preSkip } = identification;
  if (!channels || !sampleRate) throw new Error("Invalid Ogg audio stream");
  if (final > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Ogg granule exceeds safe precision");
  const samples = Math.max(0, Number(final) - preSkip), duration = samples / sampleRate;
  return { codec, sampleRate, channels, samples, duration, bitrate: duration ? (size * 8) / duration : 0 };
}
