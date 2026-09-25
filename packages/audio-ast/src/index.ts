export * from "./types.js";
export { decodePcm, encodeWav } from "./wav.js";
export * from "./dsp.js";
export type { MetadataOptions } from "./metadata.js";
import { Reader } from "./binary.js";
import { parseWav } from "./wav.js";
import { parseMp3 } from "./mp3.js";
import { parseFlac } from "./flac.js";
import { parseOgg } from "./ogg.js";
import { parseMp4 } from "./mp4.js";
import { rewriteMetadata } from "./metadata.js";
import type { MetadataOptions } from "./metadata.js";
import type { AudioAst, AudioTags } from "./types.js";
export function parseAudio(data: Uint8Array): AudioAst {
  const reader = new Reader(data),
    marker = reader.text(0, 4);
  if (marker === "RIFF") return parseWav(data);
  if (marker === "fLaC") return parseFlac(data);
  if (marker === "OggS") return parseOgg(data);
  if (data.length >= 8 && reader.text(4, 4) === "ftyp") return parseMp4(data);
  if (marker.startsWith("ID3") || (reader.u8(0) === 255 && (reader.u8(1) & 224) === 224))
    return parseMp3(data);
  throw new Error("Unsupported audio container");
}
export function probeAudio(data: Uint8Array): Omit<AudioAst, "data" | "nodes" | "pictures"> {
  const { format, streams, tags, duration, bitrate } = parseAudio(data);
  return { format, streams, tags, duration, bitrate };
}
export function writeAudioMetadata(
  data: Uint8Array | AudioAst,
  tags: AudioTags,
  options: MetadataOptions = {}
): Uint8Array {
  const ast = data instanceof Uint8Array ? parseAudio(data) : data;
  return rewriteMetadata(ast, tags, options);
}
