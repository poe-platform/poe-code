import { Reader, duration } from "./binary.js";
import { parseId3, parseId3v1 } from "./id3.js";
import type { AudioAst, AudioNode, AudioPicture, AudioTags } from "./types.js";

export function parseMp3(bytes: Uint8Array): AudioAst {
  const r = new Reader(bytes),
    nodes: AudioNode[] = [],
    pictures: AudioPicture[] = [];
  let tags: AudioTags = {},
    offset = 0,
    end = bytes.length;
  if (r.text(0, 3) === "ID3") {
    const id3 = parseId3(bytes);
    tags = id3.tags;
    pictures.push(...id3.pictures);
    nodes.push({
      type: "ID3",
      offset: 0,
      size: id3.size,
      data: r.slice(0, id3.size),
      children: id3.nodes,
      fields: { version: id3.version }
    });
    offset = id3.size;
  }
  if (end >= 128 && r.text(end - 128, 3) === "TAG") {
    tags = { ...parseId3v1(r.slice(end - 128, 128)), ...tags };
    nodes.push({ type: "ID3v1", offset: end - 128, size: 128, data: r.slice(end - 128, 128) });
    end -= 128;
  }
  let samples = 0,
    seconds = 0,
    audioBytes = 0,
    sampleRate = 0,
    channels = 0,
    frames = 0;
  while (offset < end) {
    const header = r.u32(offset),
      versionBits = (header >>> 19) & 3,
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
    if (sampleRate && (sampleRate !== rate || channels !== (ch === 3 ? 1 : 2)))
      throw new Error("Inconsistent MPEG stream");
    sampleRate = rate;
    channels = ch === 3 ? 1 : 2;
    const fields: Record<string, unknown> = {
      version,
      layer: 3,
      bitrate,
      sampleRate: rate,
      channels,
      samples: count,
      padding: (header >>> 9) & 1
    };
    const node: AudioNode = {
      type: "MPEG",
      offset,
      size: frameSize,
      data: r.slice(offset, frameSize),
      fields
    };
    nodes.push(node);
    if (!frames) {
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
    samples += count;
    seconds += duration(count, rate);
    audioBytes += frameSize;
    frames++;
    offset += frameSize;
  }
  if (!frames) throw new Error("MP3 contains no MPEG frames");
  const first = nodes.find((n) => n.type === "MPEG")!,
    vbr = first.fields?.vbr as Record<string, unknown> | undefined;
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
  return {
    format: "mp3",
    data: bytes,
    nodes,
    tags,
    pictures,
    streams: [{ codec: "mp3", sampleRate, channels, samples, duration: seconds, bitrate }],
    duration: seconds,
    bitrate: seconds ? (bytes.length * 8) / seconds : 0
  };
}
