import { mpegFrame, mpegVbr, mpegStream } from "./mpeg.js";
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
    const header = r.u32(offset), frame = mpegFrame(header, offset, end);
    const { rate, count, frameSize, fields } = frame;
    if (sampleRate && (sampleRate !== rate || channels !== frame.channels)) throw new Error("Inconsistent MPEG stream");
    sampleRate = rate; channels = frame.channels;
    const node: AudioNode = {
      type: "MPEG",
      offset,
      size: frameSize,
      data: r.slice(offset, frameSize),
      fields
    };
    nodes.push(node);
    if (!frames) mpegVbr(r, offset, frameSize, header, fields);
    samples += count;
    seconds += duration(count, rate);
    audioBytes += frameSize;
    frames++;
    offset += frameSize;
  }
  const first = nodes.find((n) => n.type === "MPEG");
  const stream = mpegStream({ samples, seconds, audioBytes, sampleRate, channels, frames }, { size: first?.size ?? 0, fields: first?.fields ?? {} });
  return {
    format: "mp3",
    data: bytes,
    nodes,
    tags,
    pictures,
    streams: [stream],
    duration: stream.duration,
    bitrate: stream.duration ? (bytes.length * 8) / stream.duration : 0
  };
}
