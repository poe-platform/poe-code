import { BinaryReader } from './binary.js';
import type { MediaBudgetTracker, MediaProbeSource, MediaTrackType } from './types.js';

export interface Mp4TableRange { readonly payloadOffset: number; readonly payloadSize: number }
export type Mp4SampleTables = Partial<Record<'stts' | 'ctts' | 'stsc' | 'stsz' | 'stco' | 'co64' | 'stss', Mp4TableRange>>;
export interface Mp4SampleSpan {
  readonly offset: number; readonly size: number; readonly dts: number; readonly pts: number; readonly cts: number;
  readonly duration: number; readonly isKeyframe: boolean; readonly sampleDescriptionIndex: number;
}
export interface Mp4SampleScanOptions {
  readonly type?: MediaTrackType;
  readonly signal?: AbortSignal;
  readonly budget?: MediaBudgetTracker;
  readonly checkpoint?: () => void | Promise<void>;
  /** Fresh caller-owned membership index for this track. Required for nonempty stss. */
  readonly syncSamples?: { add(sample: number): void | Promise<void>; has(sample: number): boolean | Promise<boolean> };
}

type Step = { kind: 'read'; offset: number; length: number; table?: Mp4TableRange } |
  { kind: 'sync-add'; sample: number } | { kind: 'sync-has'; sample: number } | { kind: 'sample'; sample: Mp4SampleSpan };
type Steps<T> = Generator<Step, T, Uint8Array | boolean | undefined>;

/** One traversal shared by the resident parser and asynchronous caller ranges. */
export function* mp4SampleTableSteps(size: number, tables: Mp4SampleTables, options: Pick<Mp4SampleScanOptions, 'type' | 'budget'> = {}): Steps<void> {
  function* read(table: Mp4TableRange | undefined, offset: number, length: number): Steps<BinaryReader> {
    if (!table || offset >= table.payloadSize) return new BinaryReader(new Uint8Array());
    const bytes = (yield { kind: 'read', table, offset: table.payloadOffset + offset, length: Math.min(length, table.payloadSize - offset) }) as Uint8Array;
    return new BinaryReader(bytes);
  }
  type Table = { table?: Mp4TableRange; count: number; header: BinaryReader; width: number; headerSize: number };
  function* info(table: Mp4TableRange | undefined, width: number, headerSize = 8): Steps<Table> {
    const header = yield* read(table && table.payloadSize >= headerSize ? table : undefined, 0, headerSize);
    const count = header.bytes.length ? new BinaryReader(header.bytes, headerSize - 4).readU32BE() : 0;
    return { ...(table ? { table } : {}), count: Math.min(count, Math.max(0, Math.ceil(((table?.payloadSize ?? 0) - headerSize) / width))), header, width, headerSize };
  }
  function* entry(table: Table, index: number): Steps<BinaryReader> {
    return yield* read(index < table.count ? table.table : undefined, table.headerSize + index * table.width, table.width);
  }
  const timing = yield* info(tables.stts, 8), composition = yield* info(tables.ctts, 8), mapping = yield* info(tables.stsc, 12);
  const sizes = yield* info(tables.stsz, 4, 12);
  sizes.header.skip(4); const uniformSize = sizes.header.readU32BE(), sampleCount = sizes.header.readU32BE();
  if (tables.stsz && tables.stsz.payloadSize >= 12) options.budget?.checkSamples(sampleCount);
  const chunks = yield* info(tables.stco && tables.stco.payloadSize >= 8 ? tables.stco : tables.co64, tables.stco && tables.stco.payloadSize >= 8 ? 4 : 8);
  const sync = yield* info(tables.stss, 4);
  for (let i = 0; i < sync.count; i++) yield { kind: 'sync-add', sample: (yield* entry(sync, i)).readU32BE() };
  if (!sampleCount || !chunks.count || !mapping.count) return;
  let timingIndex = 0, compositionIndex = 0, mappingIndex = 0, sampleIndex = 0, dts = 0;
  let timingEntry = yield* entry(timing, 0), timingLeft = timingEntry.readU32BE(), delta = timing.count ? timingEntry.readU32BE() : 1024;
  let compositionEntry = yield* entry(composition, 0), compositionLeft = compositionEntry.readU32BE();
  const signed = composition.header.bytes[0] === 1;
  let cts = signed ? compositionEntry.readI32BE() : compositionEntry.readU32BE();
  function* nextMapping(): Steps<{ first: number; count: number; description: number }> {
    const row = yield* entry(mapping, mappingIndex);
    return { first: row.readU32BE(), count: row.readU32BE(), description: row.readU32BE() || 1 };
  }
  let next = yield* nextMapping(), current = next;
  for (let chunkIndex = 0; chunkIndex < chunks.count && sampleIndex < sampleCount; chunkIndex++) {
    while (mappingIndex < mapping.count && next.first <= chunkIndex + 1) {
      current = next; mappingIndex++; if (mappingIndex < mapping.count) next = yield* nextMapping();
    }
    const chunk = yield* entry(chunks, chunkIndex);
    let cursor = chunks.width === 4 ? chunk.readU32BE() : chunk.readU64BE();
    for (let within = 0; within < current.count && sampleIndex < sampleCount; within++) {
      options.budget?.checkCpu();
      const declared = uniformSize || (yield* entry(sizes, sampleIndex)).readU32BE();
      while (timingLeft <= 0 && timingIndex + 1 < timing.count) {
        timingEntry = yield* entry(timing, ++timingIndex); timingLeft = timingEntry.readU32BE(); delta = timingEntry.readU32BE();
      }
      if (timingLeft > 0) timingLeft--;
      while (compositionLeft <= 0 && compositionIndex + 1 < composition.count) {
        compositionEntry = yield* entry(composition, ++compositionIndex); compositionLeft = compositionEntry.readU32BE(); cts = signed ? compositionEntry.readI32BE() : compositionEntry.readU32BE();
      }
      if (compositionLeft > 0) compositionLeft--;
      const isKeyframe = !tables.stss ? true : !sync.count ? sampleIndex === 0 : Boolean(yield { kind: 'sync-has', sample: sampleIndex + 1 });
      let offset = Math.max(0, Math.min(size, cursor)), length = Math.max(0, Math.min(size - offset, declared));
      const time = dts; dts += delta; cursor += declared; sampleIndex++;
      if (options.type === 'subtitle' && length >= 2) {
        const bytes = (yield { kind: 'read', offset, length: 2 }) as Uint8Array;
        const textLength = new BinaryReader(bytes).readU16BE();
        if (!textLength) continue;
        if (textLength + 2 <= length) { offset += 2; length = textLength; }
      }
      yield { kind: 'sample', sample: { offset, size: length, dts: time, pts: time + cts, cts, duration: delta, isKeyframe, sampleDescriptionIndex: current.description } };
    }
  }
}

/**
 * Replay a classic (non-fragmented) stbl without materializing tables or payloads.
 * At most seven 16 KiB table pages are cached; sync membership belongs to the caller.
 * Input/index lifetime, publication after validation, and fragmented runs remain caller-owned.
 */
export async function* scanMp4SampleTable(source: MediaProbeSource, tables: Mp4SampleTables, options: Mp4SampleScanOptions = {}): AsyncGenerator<Mp4SampleSpan, void> {
  options.signal?.throwIfAborted();
  if (!Number.isSafeInteger(source.size) || source.size < 0) throw new RangeError('Invalid MP4 source size');
  for (const name of ['stts', 'ctts', 'stsc', 'stsz', 'stco', 'co64', 'stss'] as const) { const table = tables[name]; if (table && (!Number.isSafeInteger(table.payloadOffset) || !Number.isSafeInteger(table.payloadSize) || table.payloadOffset < 0 || table.payloadSize < 0 || table.payloadOffset > source.size || table.payloadSize > source.size - table.payloadOffset)) throw new RangeError('Invalid MP4 sample table range'); }
  const cache = new Map<Mp4TableRange, { offset: number; bytes: Uint8Array }>();
  const read = async (offset: number, length: number) => {
    const bytes = new Uint8Array(length);
    for (let used = 0; used < length;) {
      options.signal?.throwIfAborted(); const chunk = await source.read(offset + used, length - used); options.signal?.throwIfAborted();
      if (!chunk.length) throw new Error('Truncated MP4 sample source');
      if (chunk.length > length - used) throw new Error('MP4 sample source returned more bytes than requested');
      bytes.set(chunk, used); used += chunk.length;
    }
    await options.checkpoint?.(); options.signal?.throwIfAborted(); return bytes;
  };
  const steps = mp4SampleTableSteps(source.size, tables, options);
  let answer: Uint8Array | boolean | undefined, work = 0, retainedBytes = 0;
  try {
    for (;;) {
      options.signal?.throwIfAborted();
      if (++work % 256 === 0) { options.budget?.checkCpu(); await options.checkpoint?.(); options.signal?.throwIfAborted(); }
      const next = steps.next(answer); if (next.done) return;
      const step = next.value; answer = undefined;
      if (step.kind === 'sample') { yield step.sample; continue; }
      if (step.kind === 'sync-add' || step.kind === 'sync-has') {
        if (!options.syncSamples) throw new Error('MP4 sync sample index is required');
        if (step.kind === 'sync-add') await options.syncSamples.add(step.sample); else answer = await options.syncSamples.has(step.sample);
        options.signal?.throwIfAborted(); continue;
      }
      if (!step.table) { answer = await read(step.offset, step.length); continue; }
      const bytes = new Uint8Array(step.length); let used = 0;
      while (used < bytes.length) {
        const relative = step.offset + used - step.table.payloadOffset, page = Math.floor(relative / 16384) * 16384;
        let cached = cache.get(step.table);
        if (!cached || cached.offset !== page) {
          if (cached) { retainedBytes -= cached.bytes.length; options.budget?.releaseMemory(cached.bytes.length); cache.delete(step.table); cached = undefined; }
          const length = Math.min(16384, step.table.payloadSize - page);
          retainedBytes += length; options.budget?.allocateMemory(length);
          cached = { offset: page, bytes: await read(step.table.payloadOffset + page, length) }; cache.set(step.table, cached);
        }
        const from = relative - page, take = Math.min(bytes.length - used, cached.bytes.length - from);
        bytes.set(cached.bytes.subarray(from, from + take), used); used += take;
      }
      answer = bytes;
    }
  } finally { cache.clear(); options.budget?.releaseMemory(retainedBytes); steps.return(); }
}
