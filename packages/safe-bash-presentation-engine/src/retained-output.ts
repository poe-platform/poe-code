import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource, ByteSink } from './contracts.js';
import type { RetainedPackageContext } from './retained-package.js';
import { OfficeError } from './errors.js';
import { RetainedValues, literal } from './retained-values.js';

export const rawJson = Symbol('admitted-json');
// This serializer only visits the fixed inventory schema. Collections are async
// iterables; factories produce streamed strings. Raw JSON is internally staged.
export async function* streamJson(value: unknown): ByteSource {
  if (typeof value === 'function') {
    yield* literal('"'); const decoder = new TextDecoder('utf-8', { fatal: true });
    for await (const bytes of value() as ByteSource) for (let offset = 0; offset < bytes.length; offset += 8192) {
      const text = decoder.decode(bytes.subarray(offset, offset + 8192), { stream: true }); yield* literal(JSON.stringify(text).slice(1, -1));
    }
    yield* literal(JSON.stringify(decoder.decode()).slice(1, -1)); yield* literal('"');
  } else if (value && typeof value === 'object') {
    if (rawJson in value) { yield* (value as { [rawJson]: () => ByteSource })[rawJson](); return; }
    if (Array.isArray(value) || Symbol.asyncIterator in value) {
      yield* literal('['); let first = true;
      for await (const item of value as AsyncIterable<unknown>) { if (!first) yield* literal(','); first = false; yield* streamJson(item); }
      yield* literal(']');
    } else {
      yield* literal('{'); let first = true;
      for (const [key, item] of Object.entries(value)) if (item !== undefined) { if (!first) yield* literal(','); first = false; yield* literal(JSON.stringify(key) + ':'); yield* streamJson(item); }
      yield* literal('}');
    }
  } else yield* literal(JSON.stringify(value ?? null));
}

export interface StagedOutput { write(sink: ByteSink): Promise<void>; close(): Promise<void> }
/** Coalesces small schema tokens while bounding owned and outstanding writes. */
export async function* boundedOutput(source: ByteSource, signal: AbortSignal, limit = Infinity): ByteSource {
  let count = 0, used = 0; let buffer = new Uint8Array(16384);
  for await (const bytes of source) {
    signal.throwIfAborted(); count += bytes.length;
    if (!Number.isSafeInteger(count) || count > limit) throw new OfficeError('resource-limit', 'Output limit exceeded.', 'publish');
    for (let offset = 0; offset < bytes.length;) {
      const size = Math.min(buffer.length - used, bytes.length - offset); buffer.set(bytes.subarray(offset, offset + size), used); used += size; offset += size;
      if (used === buffer.length) { yield buffer; buffer = new Uint8Array(16384); used = 0; }
    }
  }
  signal.throwIfAborted(); if (used) yield buffer.subarray(0, used);
}
/** Complete admission precedes the first sink write; the result owns its pages. */
export async function stageRetainedOutput(source: ByteSource, settings: RetainedPackageContext, limit: number): Promise<StagedOutput> {
  const working = { ...settings.workingStorage }, signal = settings.signal ?? new AbortController().signal, cacheBytes = working.cacheBytes ?? 1024 * 1024;
  if (!working.fs || !working.directory?.startsWith('/') || !Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384 || !(limit > 0 && (limit === Infinity || Number.isSafeInteger(limit)))) throw new OfficeError('invalid-value', 'Invalid output storage or byte limit.', 'usage');
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, cacheBytes / 16384);
  let closed = false;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Output is closed.', 'publish'); if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'publish'); };
  const values = new RetainedValues(pages, check, signal);
  const close = () => { closed = true; return pages.close(); };
  try {
    const result = await values.store(boundedOutput(source, signal, limit)); check();
    return Object.freeze({ close, async write(sink: ByteSink) { check(); for await (const bytes of values.read(result)) { check(); await sink.write(bytes); check(); } } });
  } catch (error) { await close().catch(() => {}); throw error; }
}
