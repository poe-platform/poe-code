import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource } from '@poe-code/office-package';
import { OfficeError } from './office-errors.js';
import { resolveOfficeResources, type RetainedXmlContext } from './office-resources.js';
import { openRetainedXml, type RetainedXml, type XmlRange } from './retained-xml.js';
import { openRetainedXmlDocument } from './retained-xml-document.js';
import { RetainedValues } from './retained-values.js';

export interface RetainedXmlEdit {
  /** Original decoded UTF-8 coordinates. Edits must be ordered and disjoint;
   * consecutive zero-length insertions at the same coordinate preserve order. */
  readonly range: XmlRange;
  /** Borrowed UTF-8 replacement, consumed before the next edit is requested. */
  readonly replacement: ByteSource;
}
export interface StagedXmlMutation {
  readonly byteLength: number;
  bytes(): ByteSource;
  write(sink: { write(bytes: Uint8Array): Promise<void> }): Promise<void>;
  close(): Promise<void>;
}

/** Encode the admitted UTF-8 view back to its original encoding and BOM. */
async function* encoded(source: ByteSource, original: Pick<RetainedXml, 'encoding' | 'bom'>, signal: AbortSignal): ByteSource {
  if (original.bom) yield original.encoding === 'utf-8' ? new Uint8Array([239,187,191]) : original.encoding === 'utf-16le' ? new Uint8Array([255,254]) : new Uint8Array([254,255]);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }), encoder = new TextEncoder();
  function bytes(text: string) {
    if (original.encoding === 'utf-8') return encoder.encode(text);
    const result = new Uint8Array(text.length * 2), view = new DataView(result.buffer);
    for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), original.encoding === 'utf-16le');
    return result;
  }
  for await (const chunk of source) {
    if (!(chunk instanceof Uint8Array)) throw new OfficeError('invalid-type', 'Expected XML byte chunks.', 'serialize');
    for (let offset = 0; offset < chunk.length; offset += 4096) {
      signal.throwIfAborted();
      let text: string;
      try { text = decoder.decode(chunk.subarray(offset, offset + 4096), { stream: true }); }
      catch { throw new OfficeError('invalid-xml', 'Invalid UTF-8 XML replacement.', 'serialize'); }
      if (text) yield bytes(text);
    }
  }
  let tail: string; try { tail = decoder.decode(); } catch { throw new OfficeError('invalid-xml', 'Incomplete UTF-8 XML replacement.', 'serialize'); }
  if (tail) yield bytes(tail); signal.throwIfAborted();
}

/** Admit source and result, then expose an owned staged mutation. The edit
 * factory may traverse the immutable lexical view; that view expires before
 * return. Neither a whole XML part nor the edit collection is retained in RAM. */
export async function stageRetainedXmlEdits(
  source: ByteSource,
  edits: (original: RetainedXml) => AsyncIterable<RetainedXmlEdit>,
  settings: RetainedXmlContext
): Promise<StagedXmlMutation> {
  if (typeof edits !== 'function') throw new OfficeError('invalid-type', 'Expected an XML edit factory.', 'usage');
  const context = resolveOfficeResources(settings), workingStorage = { ...settings.workingStorage }, signal = context.signal ?? new AbortController().signal;
  const resources = { ...context, signal, workingStorage }, original = await openRetainedXml(source, resources);
  const pages = new PagedStorage({ fs: workingStorage.fs, cwd: workingStorage.directory, env: {}, signal }, (workingStorage.cacheBytes ?? 1024 * 1024) / 16384);
  let closed = false, closing: Promise<void> | undefined;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'XML mutation is closed.', 'serialize'); if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'serialize'); };
  const close = () => { closed = true; return closing ??= (async () => { const outcomes = await Promise.allSettled([original.close(), pages.close()]); for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason; })(); };
  const values = new RetainedValues(pages, check, signal);
  async function boundary(position: number) {
    if (position === original.byteLength) return;
    for await (const bytes of original.read({ start: position, length: 1 })) if ((bytes[0]! & 0xc0) === 0x80) throw new OfficeError('invalid-value', 'XML edit splits a UTF-8 character.', 'serialize');
  }
  async function* replacement(source: ByteSource): ByteSource {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    for await (const chunk of source) {
      check(); if (!(chunk instanceof Uint8Array)) throw new OfficeError('invalid-type', 'Expected XML replacement bytes.', 'serialize');
      for (let offset = 0; offset < chunk.length; offset += 16384) {
        const owned = new Uint8Array(chunk.subarray(offset, offset + 16384));
        try { decoder.decode(owned, { stream: true }); } catch { throw new OfficeError('invalid-xml', 'Invalid UTF-8 XML replacement.', 'serialize'); }
        yield owned;
      }
    }
    try { decoder.decode(); } catch { throw new OfficeError('invalid-xml', 'Incomplete UTF-8 XML replacement.', 'serialize'); }
  }
  async function* changed(): ByteSource {
    let position = 0;
    for await (const edit of edits(original)) {
      check(); const start = edit?.range?.start, length = edit?.range?.length, source = edit?.replacement;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < position || length < 0 || !Number.isSafeInteger(start + length) || start + length > original.byteLength)
        throw new OfficeError('invalid-value', 'XML edits require ordered disjoint source ranges.', 'serialize');
      if (!source || typeof source[Symbol.asyncIterator] !== 'function') throw new OfficeError('invalid-type', 'Expected an XML replacement stream.', 'serialize');
      await boundary(start); await boundary(start + length);
      yield* original.read({ start: position, length: start - position }); yield* replacement(source); position = start + length;
    }
    yield* original.read({ start: position, length: original.byteLength - position });
  }
  async function* bounded(): ByteSource {
    let count = 0, used = 0, buffer = new Uint8Array(16384);
    for await (const bytes of encoded(changed(), original, signal)) {
      check(); count += bytes.length;
      if (!Number.isSafeInteger(count) || count > context.xmlLimits.maxBytes) throw new OfficeError('resource-limit', 'Edited XML byte limit exceeded.', 'serialize');
      for (let offset = 0; offset < bytes.length;) {
        const size = Math.min(buffer.length - used, bytes.length - offset); buffer.set(bytes.subarray(offset, offset + size), used); offset += size; used += size;
        if (used === buffer.length) { yield buffer; buffer = new Uint8Array(16384); used = 0; }
      }
    }
    check(); if (used) yield buffer.subarray(0, used);
  }
  try {
    const admitted = await openRetainedXmlDocument(encoded(original.read({ start: 0, length: original.byteLength }), original, signal), resources); await admitted.close();
    const result = await values.store(bounded());
    const validated = await openRetainedXmlDocument(values.read(result), resources); await validated.close();
    await original.close(); check();
    async function* bytes(): ByteSource { check(); yield* values.read(result); check(); }
    return Object.freeze({ byteLength: result.length, bytes, close, async write(sink: Parameters<StagedXmlMutation['write']>[0]) { check(); for await (const chunk of bytes()) { await sink.write(chunk); check(); } } });
  } catch (error) { await close().catch(() => {}); if (signal.aborted && !(error instanceof OfficeError)) throw new OfficeError('cancelled', 'Operation cancelled.', 'serialize'); throw error; }
}
