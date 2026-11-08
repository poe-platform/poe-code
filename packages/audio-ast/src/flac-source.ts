import { Reader } from "./binary.js";
import { flacStream } from "./flac.js";
import { addVorbisComment } from "./vorbis.js";
import type { AudioProbeSource } from "./wav-source.js";
import type { AudioAst, AudioStream, AudioTags } from "./types.js";

/** UTF-8 comment bytes; block identity preserves replacement across comment blocks. */
export interface FlacCommentSpan { readonly block: number; readonly offset: number; readonly length: number; }

/** Strict FLAC validation without AST/picture/frame models. onComment avoids collecting tag strings. */
export async function probeFlacSource(source: AudioProbeSource, options: { signal?: AbortSignal; onComment?: (span: FlacCommentSpan) => Promise<void> } = {}): Promise<Omit<AudioAst, "data" | "nodes" | "pictures">> {
  const check = (offset: number, length: number, end = source.size) => {
    options.signal?.throwIfAborted();
    if (!Number.isSafeInteger(source.size) || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || length > end - offset)
      throw new Error("Truncated or invalid audio structure");
  };
  const read = async (offset: number, length: number, end = source.size) => {
    check(offset, length, end);
    const bytes = await source.read(offset, length);
    options.signal?.throwIfAborted();
    if (bytes.length !== length) throw new Error("Truncated or invalid audio structure");
    return new Reader(bytes);
  };
  if ((await read(0, 4)).text(0, 4) !== "fLaC") throw new Error("Expected FLAC signature");
  let offset = 4, last = false, stream: AudioStream | undefined;
  const tags: AudioTags = {};
  while (!last) {
    const header = await read(offset, 4), type = header.u8(0) & 127, length = header.u24(1), start = offset + 4, end = start + length;
    last = !!(header.u8(0) & 128);
    check(start, length);
    if (type === 0) {
      if (stream || offset !== 4 || length !== 34) throw new Error("FLAC requires first unique STREAMINFO");
      stream = flacStream(await read(start, 34, end), source.size);
    } else if (type === 4) {
      const vendorLength = (await read(start, 4, end)).u32(0, true);
      check(start + 4, vendorLength, end);
      let pos = start + 4 + vendorLength;
      const count = (await read(pos, 4, end)).u32(0, true); pos += 4;
      if (count > (end - pos) / 4) throw new Error("Invalid Vorbis comment count");
      const blockTags: AudioTags = {};
      for (let i = 0; i < count; i++) {
        const size = (await read(pos, 4, end)).u32(0, true); pos += 4;
        check(pos, size, end);
        if (options.onComment) {
          await options.onComment({ block: offset, offset: pos, length: size });
          options.signal?.throwIfAborted();
        } else {
          // Explicit convenience mode collects tags, but every source transfer remains bounded.
          const decoder = new TextDecoder(); let text = "";
          for (let at = 0; at < size; at += 16384) text += decoder.decode((await read(pos + at, Math.min(16384, size - at), end)).bytes, { stream: true });
          addVorbisComment(blockTags, text + decoder.decode());
        }
        pos += size;
      }
      if (pos !== end) throw new Error("Trailing Vorbis comment bytes");
      Object.assign(tags, blockTags);
    } else if (type === 6) {
      const prefix = await read(start, 8, end), mimeLength = prefix.u32(4);
      check(start + 8, mimeLength, end);
      let pos = start + 8 + mimeLength;
      const descriptionLength = (await read(pos, 4, end)).u32(0); pos += 4;
      check(pos, descriptionLength, end); pos += descriptionLength;
      const size = (await read(pos, 20, end)).u32(16); pos += 20;
      check(pos, size, end);
      if (pos + size !== end) throw new Error("Trailing FLAC picture bytes");
    } else if (type === 3 && length % 18) throw new Error("Invalid FLAC seek table");
    else if (type === 127) throw new Error("Invalid FLAC metadata block");
    offset = end;
  }
  if (!stream) throw new Error("Missing FLAC STREAMINFO");
  options.signal?.throwIfAborted();
  return { format: "flac", streams: [stream], tags, duration: stream.duration, bitrate: stream.bitrate };
}
