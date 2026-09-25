import { Reader, duration } from "./binary.js";
import { parseComments, parsePicture } from "./vorbis.js";
import type { AudioAst, AudioNode, AudioTags, AudioPicture, AudioStream } from "./types.js";
export function parseFlac(bytes: Uint8Array): AudioAst {
  const r = new Reader(bytes),
    nodes: AudioNode[] = [],
    pictures: AudioPicture[] = [];
  const tags: AudioTags = {};
  let offset = 4,
    last = false,
    stream: AudioStream | undefined;
  while (!last) {
    const header = r.u8(offset),
      type = header & 127,
      size = r.u24(offset + 1);
    last = !!(header & 128);
    const data = r.slice(offset + 4, size),
      node: AudioNode = {
        type:
          [
            "STREAMINFO",
            "PADDING",
            "APPLICATION",
            "SEEKTABLE",
            "VORBIS_COMMENT",
            "CUESHEET",
            "PICTURE"
          ][type] ?? `BLOCK_${type}`,
        offset,
        size: size + 4,
        data
      };
    nodes.push(node);
    const block = new Reader(data);
    if (type === 0) {
      if (stream || offset !== 4 || size !== 34)
        throw new Error("FLAC requires first unique STREAMINFO");
      const packed = block.u64(10),
        sampleRate = Number(packed >> 44n),
        channels = Number((packed >> 41n) & 7n) + 1,
        bitsPerSample = Number((packed >> 36n) & 31n) + 1,
        samples = Number(packed & 0xfffffffffn);
      const seconds = duration(samples, sampleRate);
      stream = {
        codec: "flac",
        sampleRate,
        channels,
        bitsPerSample,
        samples,
        duration: seconds,
        bitrate: seconds ? (bytes.length * 8) / seconds : 0
      };
      node.fields = {
        minBlockSize: block.u16(0),
        maxBlockSize: block.u16(2),
        minFrameSize: block.u24(4),
        maxFrameSize: block.u24(7),
        sampleRate,
        channels,
        bitsPerSample,
        totalSamples: samples,
        md5: Array.from(block.slice(18, 16), (b) => b.toString(16).padStart(2, "0")).join("")
      };
    } else if (type === 4) {
      const parsed = parseComments(data);
      if (parsed.size !== size) throw new Error("Trailing Vorbis comment bytes");
      Object.assign(tags, parsed.tags);
      node.fields = { vendor: parsed.vendor, comments: parsed.comments };
    } else if (type === 6) pictures.push(parsePicture(data));
    else if (type === 3) {
      if (size % 18) throw new Error("Invalid FLAC seek table");
      const points = [];
      for (let pos = 0; pos < size; pos += 18)
        points.push({
          sample: block.u64(pos),
          offset: block.u64(pos + 8),
          samples: block.u16(pos + 16)
        });
      node.fields = { points };
    } else if (type === 127) throw new Error("Invalid FLAC metadata block");
    offset += 4 + size;
  }
  if (!stream) throw new Error("Missing FLAC STREAMINFO");
  if (offset < bytes.length)
    nodes.push({
      type: "FRAMES",
      offset,
      size: bytes.length - offset,
      data: r.slice(offset, bytes.length - offset)
    });
  return {
    format: "flac",
    data: bytes,
    nodes,
    tags,
    pictures,
    streams: [stream],
    duration: stream.duration,
    bitrate: stream.bitrate
  };
}
