import { Reader } from "./binary.js";
import { oggCrc } from "./ogg.js";
import type { AudioProbeSource } from "./wav-source.js";

/** A checksum-verified physical page. Payload stays in the caller's source. */
export interface OggPageSpan {
  readonly offset: number;
  readonly size: number;
  readonly payloadOffset: number;
  readonly flags: number;
  readonly granule: bigint;
  readonly serial: number;
  readonly sequence: number;
  readonly checksum: number;
  /** Owned segment lengths, at most 255 bytes; 255 continues the packet. */
  readonly lacing: Uint8Array;
}

/**
 * Scan physical pages without retaining payloads, packet lists or logical-stream
 * state. The consumer owns packet/codec validation and any backing indexes.
 * Ranges and owned byte buffers are at most 16 KiB. A retained source stays open;
 * a sequential iterator is retired on failure or early return. Earlier pages may
 * precede a later error, so publish only after consuming the complete iterator.
 */
export async function* scanOggPages(
  source: AudioProbeSource | AsyncIterable<Uint8Array>,
  options: { signal?: AbortSignal; checkpoint?: () => void | Promise<void> } = {}
): AsyncGenerator<OggPageSpan, void> {
  options.signal?.throwIfAborted();
  const retained = "size" in source ? source : undefined;
  if (retained && (!Number.isSafeInteger(retained.size) || retained.size < 0)) throw new RangeError("Invalid Ogg source size");
  const iterator = !retained && Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : undefined;
  let offset = 0, position = 0, done = false;
  let pending: Uint8Array = new Uint8Array(0);
  const read = async (length: number, eof = false): Promise<Uint8Array> => {
    const out = new Uint8Array(length);
    let used = 0;
    while (used < length) {
      options.signal?.throwIfAborted();
      let chunk: Uint8Array;
      if (retained) {
        if (offset === retained.size && eof && used === 0) return out.subarray(0, 0);
        if (length - used > retained.size - offset) throw new Error("Truncated Ogg page");
        chunk = await retained.read(offset, length - used);
        options.signal?.throwIfAborted();
        if (!chunk.length) throw new Error("Truncated Ogg page");
        if (chunk.length > length - used) throw new Error("Ogg source returned more bytes than requested");
      } else {
        while (position === pending.length) {
          const next = await iterator!.next();
          options.signal?.throwIfAborted();
          if (next.done) {
            done = true;
            if (eof && used === 0) return out.subarray(0, 0);
            throw new Error("Truncated Ogg page");
          }
          pending = next.value;
          position = 0;
          if (!pending.length) {
            await options.checkpoint?.();
            options.signal?.throwIfAborted();
          }
        }
        const length = Math.min(out.length - used, pending.length - position);
        chunk = pending.subarray(position, position + length);
        position += length;
      }
      // Copy borrowed bytes before any further await or iterator advancement.
      out.set(chunk, used);
      used += chunk.length;
      offset += chunk.length;
      if (!Number.isSafeInteger(offset)) throw new RangeError("Invalid Ogg source size");
    }
    await options.checkpoint?.();
    options.signal?.throwIfAborted();
    return out;
  };
  let failed = false;
  const retire = async () => {
    if (iterator && !done) {
      try { await iterator.return?.(); } catch (error) { if (!failed) throw error; }
    }
  };
  try {
    for (;;) {
      const start = offset, header = await read(27, true);
      if (!header.length) return;
      const r = new Reader(header);
      if (r.text(0, 4) !== "OggS" || r.u8(4) !== 0) throw new Error("Invalid Ogg page");
      const flags = r.u8(5);
      if (flags & ~7) throw new Error("Invalid Ogg page flags");
      const lacing = await read(r.u8(26)), payloadOffset = offset;
      let crc = oggCrc(header);
      crc = oggCrc(lacing, crc, 27);
      let remaining = 0;
      for (const length of lacing) remaining += length;
      while (remaining) {
        const pageOffset = offset - start, chunk = await read(Math.min(16384, remaining));
        crc = oggCrc(chunk, crc, pageOffset);
        remaining -= chunk.length;
      }
      const checksum = r.u32(22, true);
      if (crc !== checksum) throw new Error("Ogg checksum mismatch");
      yield { offset: start, size: offset - start, payloadOffset, flags, granule: r.u64(6, true),
        serial: r.u32(14, true), sequence: r.u32(18, true), checksum, lacing };
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await retire();
  }
}
