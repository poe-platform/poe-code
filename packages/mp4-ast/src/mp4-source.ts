import { decodeFourCC } from "./binary.js";
import { mp4BoxChildrenOffset, mp4BoxLayout } from "./mp4-box-layout.js";
import type { MediaBudgetTracker, MediaProbeSource } from "./types.js";

/** Physical ranges in the original caller-owned source; payload bytes stay there. */
export interface Mp4BoxSpan {
  readonly type: string;
  readonly offset: number;
  readonly size: number;
  readonly headerSize: number;
  readonly payloadOffset: number;
  readonly payloadSize: number;
  readonly uuid?: Uint8Array;
  readonly children?: { readonly offset: number; readonly length: number; readonly depth: number };
}

export interface Mp4BoxScanOptions {
  readonly offset?: number;
  readonly length?: number;
  readonly depth?: number;
  readonly signal?: AbortSignal;
  readonly budget?: MediaBudgetTracker;
  readonly checkpoint?: () => void | Promise<void>;
}

/**
 * Scan siblings lazily, using at most 16-byte reads and no payload/tree arrays.
 * Pass a returned children range to another scan to inspect that container.
 * The caller owns source lifetime, input admission and any traversal backing.
 * Spans may precede a later I/O failure; callers must finish validation before publication.
 * Like parseMp4Boxes, clips malformed lengths and ignores incomplete headers.
 */
export async function* scanMp4Boxes(source: MediaProbeSource, options: Mp4BoxScanOptions = {}): AsyncGenerator<Mp4BoxSpan, void> {
  options.signal?.throwIfAborted();
  if (!Number.isSafeInteger(source.size) || source.size < 0) throw new RangeError("Invalid MP4 source size");
  let offset = options.offset ?? 0;
  const length = options.length ?? source.size - offset, depth = options.depth ?? 0;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > source.size || length > source.size - offset)
    throw new RangeError("Invalid MP4 box range");
  if (!Number.isSafeInteger(depth) || depth < 0) throw new RangeError("Invalid MP4 box depth");
  options.budget?.checkBoxDepth(depth);
  const end = offset + length;
  const read = async (at: number, size: number): Promise<Uint8Array> => {
    const bytes = new Uint8Array(size);
    for (let used = 0; used < size;) {
      options.signal?.throwIfAborted();
      const chunk = await source.read(at + used, size - used);
      options.signal?.throwIfAborted();
      if (!chunk.length) throw new Error("Truncated MP4 source");
      if (chunk.length > size - used) throw new Error("MP4 source returned more bytes than requested");
      bytes.set(chunk, used); used += chunk.length;
    }
    await options.checkpoint?.(); options.signal?.throwIfAborted();
    return bytes;
  };
  while (end - offset >= 8) {
    options.signal?.throwIfAborted(); options.budget?.checkCpu();
    let prefix = await read(offset, 8);
    if (new DataView(prefix.buffer).getUint32(0) === 1) {
      if (end - offset < 16) break;
      const extended = new Uint8Array(16); extended.set(prefix); extended.set(await read(offset + 8, 8), 8); prefix = extended;
    }
    const layout = mp4BoxLayout(prefix, end - offset);
    if (!layout) break;
    const { type, size, headerSize, uuidOffset } = layout;
    const uuid = uuidOffset === undefined ? undefined : await read(offset + uuidOffset, 16);
    const payloadOffset = offset + headerSize, payloadSize = size - headerSize;
    const metaType = type === "meta" && payloadSize >= 12 ? decodeFourCC(await read(payloadOffset + 8, 4), 0) : undefined;
    const childOffset = mp4BoxChildrenOffset(type, payloadSize, metaType);
    yield { type, offset, size, headerSize, payloadOffset, payloadSize,
      ...(uuid ? { uuid } : {}),
      ...(childOffset === undefined ? {} : { children: { offset: payloadOffset + childOffset, length: payloadSize - childOffset, depth: depth + 1 } }) };
    offset += size;
  }
  options.signal?.throwIfAborted();
}
