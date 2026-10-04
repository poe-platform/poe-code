import { Reader, duration } from "./binary.js";
import type { AudioStream } from "./types.js";

/** Shared strict frame validation for resident parsing and bounded source probing. */
export function mpegFrame(header: number, offset: number, end: number) {
  const versionBits = (header >>> 19) & 3,
    layer = (header >>> 17) & 3,
    bitrateIndex = (header >>> 12) & 15,
    rateIndex = (header >>> 10) & 3;
  if (
    header >>> 21 !== 0x7ff ||
    versionBits === 1 ||
    layer !== 1 ||
    !bitrateIndex ||
    bitrateIndex === 15 ||
    rateIndex === 3
  )
    throw new Error(`Invalid MPEG Layer III frame at ${offset}`);
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
  const rate = [44100, 48000, 32000][rateIndex]! / (version === 1 ? 1 : version === 2 ? 2 : 4);
  const bitrate =
    (version === 1
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[bitrateIndex]! * 1000;
  const count = version === 1 ? 1152 : 576,
    frameSize = Math.floor(((version === 1 ? 144 : 72) * bitrate) / rate) + ((header >>> 9) & 1),
    ch = (header >>> 6) & 3;
  if (frameSize > end - offset) throw new Error("Truncated MPEG frame");
  const channels = ch === 3 ? 1 : 2;
  const fields: Record<string, unknown> = {
    version,
    layer: 3,
    bitrate,
    sampleRate: rate,
    channels,
    samples: count,
    padding: (header >>> 9) & 1
  };
  return { version, rate, count, frameSize, channels, fields };
}

export function mpegVbr(r: Reader, offset: number, frameSize: number, header: number, fields: Record<string, unknown>): void {
  const version = Number(fields.version), channels = Number(fields.channels);
  const side = version === 1 ? (channels === 1 ? 17 : 32) : channels === 1 ? 9 : 17,
    crc = header & 0x10000 ? 0 : 2;
  const xing = offset + 4 + crc + side;
  if (xing + 8 <= offset + frameSize && ["Xing", "Info"].includes(r.text(xing, 4))) {
    const flags = r.u32(xing + 4);
    let pos = xing + 8;
    const vbr: Record<string, unknown> = { type: r.text(xing, 4), flags };
    if (flags & 1) {
      vbr.frames = r.u32(pos);
      pos += 4;
    }
    if (flags & 2) {
      vbr.bytes = r.u32(pos);
      pos += 4;
    }
    if (flags & 4) {
      vbr.toc = r.slice(pos, 100);
      pos += 100;
    }
    if (flags & 8) {
      vbr.quality = r.u32(pos);
      pos += 4;
    }
    if (pos > offset + frameSize) throw new Error("Xing header exceeds frame");
    fields.vbr = vbr;
    if (pos + 24 <= offset + frameSize && ["LAME", "Lavc", "Lavf"].includes(r.text(pos, 4))) {
      const packed = r.u24(pos + 21);
      fields.encoderDelay = packed >>> 12;
      fields.encoderPadding = packed & 4095;
    }
  }
  const vbri = offset + 36;
  if (vbri + 26 <= offset + frameSize && r.text(vbri, 4) === "VBRI")
    fields.vbr = {
      type: "VBRI",
      version: r.u16(vbri + 4),
      delay: r.u16(vbri + 6),
      quality: r.u16(vbri + 8),
      bytes: r.u32(vbri + 10),
      frames: r.u32(vbri + 14),
      entries: r.u16(vbri + 18),
      scale: r.u16(vbri + 20),
      entryBytes: r.u16(vbri + 22),
      framesPerEntry: r.u16(vbri + 24)
    };
}

export function mpegStream(state: { samples: number; seconds: number; audioBytes: number; sampleRate: number; channels: number; frames: number }, first: { size: number; fields: Record<string, unknown> }): AudioStream {
  let { samples, seconds, audioBytes } = state;
  const { sampleRate, channels, frames } = state;
  if (!frames) throw new Error("MP3 contains no MPEG frames");
  const vbr = first.fields?.vbr as Record<string, unknown> | undefined;
  const declared = vbr?.frames;
  if (typeof declared === "number" && declared > 0) {
    if (declared !== frames && declared !== frames - 1)
      throw new Error("MPEG VBR frame count mismatch");
    const encodedSamples = declared * (sampleRate >= 32000 ? 1152 : 576);
    const delay = Number(first.fields?.encoderDelay ?? 0),
      padding = Number(first.fields?.encoderPadding ?? 0);
    if (delay + padding > encodedSamples) throw new Error("Invalid MPEG encoder delay/padding");
    samples = encodedSamples - delay - padding;
    seconds = duration(samples, sampleRate);
    if (declared === frames - 1) audioBytes -= first.size;
    first.fields!.encodedSamples = encodedSamples;
  }
  const encodedSeconds = duration(Number(first.fields?.encodedSamples ?? samples), sampleRate);
  const bitrate = encodedSeconds ? (audioBytes * 8) / encodedSeconds : 0;
  return { codec: "mp3", sampleRate, channels, samples, duration: seconds, bitrate };
}
