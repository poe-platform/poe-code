import { Reader, cleanText } from "./binary.js";
import { id3TagName, id3TextEncoding, synchsafe } from "./id3.js";
import type { AudioTags } from "./types.js";
import type { AudioProbeSource } from "./wav-source.js";

/** Physical source span, decoded independently after ID3 unsynchronization. */
export interface Id3TextSpan {
  readonly key: string;
  readonly offset: number;
  readonly length: number;
  readonly unsynchronized: boolean;
  readonly encoding: number;
}
interface SourceOptions { signal?: AbortSignal; checkpoint?: () => Promise<void>; }

class Cursor {
  private cache = new Uint8Array();
  private cacheOffset = 0;
  constructor(readonly source: AudioProbeSource, public position: number, readonly end: number,
    readonly unsynchronized: boolean, readonly options: SourceOptions) {
    if (!Number.isSafeInteger(source.size) || source.size < 0 || !Number.isSafeInteger(position) || !Number.isSafeInteger(end) || position < 0 || end < position || end > source.size)
      throw new Error("Truncated or invalid audio structure");
  }
  private async fill(): Promise<void> {
    this.options.signal?.throwIfAborted();
    if (this.position >= this.end) throw new Error("Truncated or invalid audio structure");
    if (this.position >= this.cacheOffset && this.position < this.cacheOffset + this.cache.length) return;
    await this.options.checkpoint?.();
    this.options.signal?.throwIfAborted();
    const length = Math.min(16384, this.end - this.position);
    const bytes = await this.source.read(this.position, length);
    this.options.signal?.throwIfAborted();
    if (bytes.length !== length) throw new Error("Truncated or invalid audio structure");
    // A reader may reuse its returned buffer on the next call.
    this.cache = bytes.slice(); this.cacheOffset = this.position;
  }
  async read(length: number, partial = false): Promise<Uint8Array> {
    if (!Number.isSafeInteger(length) || length < 0 || length > 16384) throw new Error("Invalid ID3 header read");
    this.options.signal?.throwIfAborted();
    const result = new Uint8Array(length);
    let count = 0;
    while (count < length && this.position < this.end) {
      await this.fill();
      if (!this.unsynchronized) {
        const size = Math.min(length - count, this.cacheOffset + this.cache.length - this.position);
        result.set(this.cache.subarray(this.position - this.cacheOffset, this.position - this.cacheOffset + size), count);
        count += size; this.position += size;
      } else {
        while (count < length && this.position < this.cacheOffset + this.cache.length) {
          const byte = this.cache[this.position++ - this.cacheOffset]!; result[count++] = byte;
          if (byte === 255 && this.position < this.end) {
            if (this.position === this.cacheOffset + this.cache.length) await this.fill();
            if (this.cache[this.position - this.cacheOffset] === 0) this.position++;
          }
        }
      }
    }
    if (!partial && count !== length) throw new Error("Truncated or invalid audio structure");
    return result.subarray(0, count);
  }
  async skip(length: number, partial = false): Promise<void> {
    this.options.signal?.throwIfAborted();
    if (!Number.isSafeInteger(length) || length < 0) throw new Error("Truncated or invalid audio structure");
    if (!this.unsynchronized) {
      if (!partial && length > this.end - this.position) throw new Error("Truncated or invalid audio structure");
      this.position += Math.min(length, this.end - this.position); return;
    }
    while (length && this.position < this.end) { const bytes = await this.read(Math.min(length, 16384), partial); length -= bytes.length; }
    if (length && !partial) throw new Error("Truncated or invalid audio structure");
  }
  async terminated(start: number, encoding: number): Promise<void> {
    const width = encoding === 1 || encoding === 2 ? 2 : 1;
    await this.skip(start, true);
    while (this.position < this.end) {
      const bytes = await this.read(width, true);
      if (bytes.length < width) break;
      if (bytes[0] === 0 && (width === 1 || bytes[1] === 0)) return;
    }
    throw new Error("Unterminated ID3 text field");
  }
}

/** Replay bounded decoded fragments. The consumer applies NUL termination and trailing trimming. */
export async function* readId3Text(source: AudioProbeSource, span: Id3TextSpan, options: SourceOptions = {}): AsyncGenerator<string> {
  const cursor = new Cursor(source, span.offset, span.offset + span.length, span.unsynchronized, options);
  const first = await cursor.read(Math.min(2, span.length), true);
  const decoder = new TextDecoder(id3TextEncoding(span.encoding, first));
  yield decoder.decode(first, { stream: true });
  while (cursor.position < cursor.end) yield decoder.decode(await cursor.read(16384, true), { stream: true });
  options.signal?.throwIfAborted();
  yield decoder.decode();
}

/** Validate ID3 through bounded ranges. onTag emits replayable spans instead of building tag or picture models.
 * Callbacks can precede a later validation error; publish only after this operation succeeds.
 */
export async function probeId3Source(source: AudioProbeSource, options: SourceOptions & { onTag?: (span: Id3TextSpan) => Promise<void> } = {}): Promise<{ size: number; version: number; tags: AudioTags }> {
  const input = new Cursor(source, 0, source.size, false, options), header = new Reader(await input.read(10));
  const version = header.u8(3), flags = header.u8(5), length = synchsafe(header, 6);
  if (![2,3,4].includes(version)) throw new Error("Unsupported ID3 version");
  if (version === 2 && flags & 64) throw new Error("Compressed ID3v2.2 tag unsupported");
  const footer = version === 4 && flags & 16 ? 10 : 0, size = 10 + length + footer;
  if (size > source.size) throw new Error("Truncated or invalid audio structure");
  const cursor = new Cursor(source, 10, 10 + length, !!(flags & 128 && version < 4), options), tags: AudioTags = {};
  if (version >= 3 && flags & 64) {
    const prefix = new Reader(await cursor.read(4)), extended = version === 4 ? synchsafe(prefix, 0) : prefix.u32(0) + 4;
    if (extended >= 4) await cursor.skip(extended - 4);
    if (extended < (version === 3 ? 10 : 6)) throw new Error("Invalid ID3 extended header");
  }
  while (cursor.position < cursor.end) {
    options.signal?.throwIfAborted();
    await options.checkpoint?.();
    const first = await cursor.read(1);
    if (first[0] === 0) break;
    const headerSize = version === 2 ? 6 : 10, bytes = new Uint8Array(headerSize);
    bytes.set(first); bytes.set(await cursor.read(headerSize - 1), 1);
    const r = new Reader(bytes), id = r.text(0, version === 2 ? 3 : 4);
    const frameSize = version === 2 ? r.u24(3) : version === 4 ? synchsafe(r, 4) : r.u32(4), frameFlags = version === 2 ? 0 : r.u16(8);
    const offset = cursor.position; await cursor.skip(frameSize);
    const frame = new Cursor(source, offset, cursor.position, cursor.unsynchronized || !!(version === 4 && (flags & 128 || frameFlags & 2)), options);
    const unsupported = version === 3 ? frameFlags & 0x00c0 : frameFlags & 0x000c;
    if (unsupported || !frameSize) continue;
    let prefix = 0;
    if (version === 3 && frameFlags & 32) prefix++;
    if (version === 4 && frameFlags & 64) prefix++;
    if (version === 4 && frameFlags & 1) prefix += 4;
    await frame.skip(prefix, true);
    let key: string | undefined, encoding: number | undefined;
    if (id.startsWith("T") && id !== "TXXX" && id !== "TXX") {
      key = id3TagName(id); encoding = (await frame.read(1, true))[0];
    } else if (id === "COMM" || id === "COM") {
      encoding = (await frame.read(1, true))[0];
      await frame.terminated(3, encoding!); key = "comment";
    } else if (id === "APIC" || id === "PIC") {
      encoding = (await frame.read(1, true))[0];
      if (id === "PIC") await frame.read(3);
      else await frame.terminated(0, 0);
      await frame.skip(1, true);
      await frame.terminated(0, encoding!);
      id3TextEncoding(encoding!, new Uint8Array());
    }
    if (key !== undefined) {
      id3TextEncoding(encoding!, new Uint8Array());
      const span: Id3TextSpan = { key, offset: frame.position, length: frame.end - frame.position, unsynchronized: frame.unsynchronized, encoding: encoding! };
      if (options.onTag) { await options.onTag(span); options.signal?.throwIfAborted(); }
      else { let value = ""; for await (const text of readId3Text(source, span, options)) value += text; tags[key] = cleanText(value); }
    }
  }
  if (footer) {
    const tail = new Cursor(source, 10 + length, size, false, options);
    if (new Reader(await tail.read(3)).text(0, 3) !== "3DI") throw new Error("Missing ID3 footer");
  }
  options.signal?.throwIfAborted();
  return { size, version, tags };
}
