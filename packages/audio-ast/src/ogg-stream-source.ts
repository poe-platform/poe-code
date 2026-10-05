import { Reader } from "./binary.js";
import { oggIdentification, oggStream } from "./ogg-stream.js";
import type { AudioProbeSource } from "./wav-source.js";
import type { AudioStream, AudioTags } from "./types.js";

/** Raw UTF-8 comment within the logical comment packet, including its field name. */
export interface OggCommentSpan { readonly offset: number; readonly length: number; }

/**
 * Inspect one already-indexed Opus/Vorbis logical stream. Physical Ogg validation,
 * stream ordering, aggregate tags/pictures and source lifetime belong to callers.
 * onComment avoids materializing comments; without it, raw stream tags are collected.
 */
export async function probeOggStreamSource(input: {
  readonly head: AudioProbeSource;
  readonly comments?: AudioProbeSource | undefined;
  readonly granule: bigint;
  readonly size: number;
}, options: {
  signal?: AbortSignal;
  checkpoint?: () => void | Promise<void>;
  onComment?: (span: OggCommentSpan) => void | Promise<void>;
} = {}): Promise<AudioStream> {
  const check = (source: AudioProbeSource, offset: number, length: number) => {
    options.signal?.throwIfAborted();
    if (!Number.isSafeInteger(source.size) || source.size < 0 || offset < 0 || length < 0 || length > source.size - offset)
      throw new Error("Truncated or invalid audio structure");
  };
  const read = async (source: AudioProbeSource, offset: number, length: number) => {
    check(source, offset, length);
    const bytes = new Uint8Array(length);
    for (let at = 0; at < length;) {
      const part = await source.read(offset + at, length - at);
      options.signal?.throwIfAborted();
      if (!part.length || part.length > length - at) throw new Error("Truncated or invalid audio structure");
      bytes.set(part, at); at += part.length;
    }
    await options.checkpoint?.();
    options.signal?.throwIfAborted();
    return new Reader(bytes);
  };
  options.signal?.throwIfAborted();
  if (!Number.isSafeInteger(input.size) || input.size < 0 || input.granule < 0n) throw new RangeError("Invalid Ogg stream size or granule");
  check(input.head, 0, 0);
  const identification = oggIdentification((await read(input.head, 0, Math.min(input.head.size, 276))).bytes, input.head.size);
  const { comments } = input, opus = identification.codec === "opus", prefix = opus ? 8 : 7;
  const missing = opus ? "Missing OpusTags" : "Missing Vorbis comments";
  if (!comments) throw new Error(missing);
  const marker = await read(comments, 0, prefix);
  if (opus ? marker.text(0, 8) !== "OpusTags" : marker.u8(0) !== 3 || marker.text(1, 6) !== "vorbis") throw new Error(missing);
  const vendorLength = (await read(comments, prefix, 4)).u32(0, true);
  check(comments, prefix + 4, vendorLength);
  let offset = prefix + 4 + vendorLength;
  const count = (await read(comments, offset, 4)).u32(0, true); offset += 4;
  if (count > (comments.size - offset) / 4) throw new Error("Invalid Vorbis comment count");
  const tags: AudioTags = {};
  for (let i = 0; i < count; i++) {
    const length = (await read(comments, offset, 4)).u32(0, true); offset += 4;
    check(comments, offset, length);
    if (options.onComment) {
      await options.onComment({ offset, length });
      options.signal?.throwIfAborted();
    } else {
      const decoder = new TextDecoder(); let text = "";
      for (let at = 0; at < length; at += 16384) text += decoder.decode((await read(comments, offset + at, Math.min(16384, length - at))).bytes, { stream: true });
      text += decoder.decode();
      const split = text.indexOf("=");
      if (split > 0) {
        const key = text.slice(0, split), value = text.slice(split + 1);
        tags[key] = tags[key] ? `${tags[key]};${value}` : value;
      }
    }
    offset += length;
  }
  if (!opus && (offset === comments.size || !((await read(comments, offset, 1)).u8(0) & 1)))
    throw new Error("Missing Vorbis comment framing bit");
  return { tags, ...oggStream(identification, input.granule, input.size) };
}
