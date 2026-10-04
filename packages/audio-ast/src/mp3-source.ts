import { Reader, duration } from "./binary.js";
import { parseId3v1 } from "./id3.js";
import { probeId3Source, type Id3TextSpan } from "./id3-source.js";
import { mpegFrame, mpegVbr, mpegStream } from "./mpeg.js";
import type { AudioAst, AudioTags } from "./types.js";
import type { AudioProbeSource } from "./wav-source.js";

/** ID3v1 fields are bounded literals; ID3v2 values remain replayable source spans. */
export type Mp3Tag = Id3TextSpan | { readonly key: string; readonly value: string };

/** Strict MPEG/ID3 validation with bounded reads and no encoded sample or picture payloads.
 * One bounded first-frame descriptor preserves declared VBR byte rates for probe writers.
 * onTag preserves ID3v1 insertion order and subsequent ID3v2 replacement. It may run
 * before later validation fails; keep the caller-owned source alive and publish only on success.
 */
export async function probeMp3Source(source: AudioProbeSource, options: { signal?: AbortSignal; checkpoint?: () => Promise<void>; onTag?: (tag: Mp3Tag) => Promise<void> } = {}): Promise<Omit<AudioAst, "data" | "pictures">> {
  const read = async (offset: number, length: number) => {
    options.signal?.throwIfAborted();
    if (!Number.isSafeInteger(source.size) || source.size < 0 || offset < 0 || length < 0 || length > source.size - offset)
      throw new Error("Truncated or invalid audio structure");
    const bytes = await source.read(offset, length);
    options.signal?.throwIfAborted();
    if (bytes.length !== length) throw new Error("Truncated or invalid audio structure");
    return new Reader(bytes);
  };
  const marker = (await read(0, 3)).text(0, 3);
  let end = source.size, offset = 0;
  const tags: AudioTags = {};
  if (end >= 128) {
    const tail = await read(end - 128, 128);
    if (tail.text(0, 3) === "TAG") {
      const values = parseId3v1(tail.bytes); end -= 128;
      if (options.onTag) for (const [key, value] of Object.entries(values)) { await options.onTag({ key, value }); options.signal?.throwIfAborted(); }
      else Object.assign(tags, values);
    }
  }
  if (marker === "ID3") {
    const id3 = await probeId3Source(source, { ...options, ...(options.onTag ? { onTag: options.onTag } : {}) });
    offset = id3.size; Object.assign(tags, id3.tags);
  }
  let samples = 0, seconds = 0, audioBytes = 0, sampleRate = 0, channels = 0, frames = 0;
  let firstOffset = 0;
  let first = { size: 0, fields: {} as Record<string, unknown> };
  while (offset < end) {
    await options.checkpoint?.(); options.signal?.throwIfAborted();
    const header = (await read(offset, 4)).u32(0), frame = mpegFrame(header, offset, end);
    if (sampleRate && (sampleRate !== frame.rate || channels !== frame.channels)) throw new Error("Inconsistent MPEG stream");
    sampleRate = frame.rate; channels = frame.channels;
    if (!frames) {
      // The complete Xing/Info/LAME or VBRI descriptor occupies at most 182 bytes.
      const metadata = await read(offset, Math.min(192, source.size - offset));
      mpegVbr(new Reader(metadata.bytes.slice()), 0, frame.frameSize, header, frame.fields);
      first = { size: frame.frameSize, fields: frame.fields }; firstOffset = offset;
    }
    samples += frame.count; seconds += duration(frame.count, frame.rate); audioBytes += frame.frameSize;
    frames++; offset += frame.frameSize;
  }
  options.signal?.throwIfAborted();
  const stream = mpegStream({ samples, seconds, audioBytes, sampleRate, channels, frames }, first);
  return { format: "mp3", nodes: [{ type: "MPEG", offset: firstOffset, size: first.size, data: new Uint8Array(), fields: first.fields }], streams: [stream], tags, duration: stream.duration, bitrate: stream.duration ? source.size * 8 / stream.duration : 0 };
}
