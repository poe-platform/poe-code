import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource } from './contracts.js';
import { OfficeError, PackageNotFoundError } from './errors.js';
import { openPackageArchive, type RetainedPackageContext } from './retained-package.js';
import type { RetainedMutationSource } from './retained-archive-staging.js';
import { openRetainedPresentationIndex } from './retained-inspection.js';
import { openRetainedPresentationValidation } from './retained-validation.js';
import { openRetainedContentTypes } from './retained-content-types.js';
import { RetainedOrder } from './retained-order.js';
import { RetainedValues, literal, folded, digest, characters } from './retained-values.js';
import { partName } from './package-uri.js';
import { resourceContext } from './resource-limits.js';
import type { XmlRange } from './retained-xml.js';

export interface RetainedExtractedPackageMember {
  readonly part: string;
  readonly name: string;
  readonly sha256: string;
  readonly size: number;
  contentType(): ByteSource;
  bytes(): ByteSource;
}
export interface RetainedPackageExtraction {
  readonly count: number;
  members(): AsyncGenerator<RetainedExtractedPackageMember>;
  close(): Promise<void>;
}
const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/tiff': 'tif', 'image/bmp': 'bmp', 'audio/mpeg': 'mp3', 'video/mp4': 'mp4' };
/** Admit the complete selection before exposing members. Borrows immutable input,
 * owns archive and descriptor storage; it never opens output paths. Selection
 * arrays are borrowed until admission settles and must remain immutable. */
export async function openRetainedPackageExtraction(input: RetainedMutationSource, settings: RetainedPackageContext,
  options: { readonly parts?: readonly string[] } = {}): Promise<RetainedPackageExtraction> {
  const context = resourceContext(settings), signal = context.signal ?? new AbortController().signal;
  if (!options || typeof options !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(key => key !== 'parts' || !('value' in Object.getOwnPropertyDescriptor(options, key)!)))
    throw new OfficeError('invalid-value', 'Expected a plain package record.', 'usage');
  const selected = options.parts;
  if (selected !== undefined) {
    if (!Array.isArray(selected) || !selected.length || Object.getPrototypeOf(selected) !== Array.prototype)
      throw new OfficeError('invalid-value', 'Invalid package extraction options.', 'usage');
    if (selected.length > context.archiveLimits.maxMembers) throw new OfficeError('resource-limit', 'Package member limit exceeded.', 'usage');
    if (Reflect.ownKeys(selected).length !== selected.length + 1) throw new OfficeError('invalid-value', 'Expected a dense package array.', 'usage');
    for (let n = 0; n < selected.length; n++) if (!Object.getOwnPropertyDescriptor(selected, String(n)) || !('value' in Object.getOwnPropertyDescriptor(selected, String(n))!))
      throw new OfficeError('invalid-value', 'Expected a dense package array.', 'usage');
  }
  const working = { ...settings.workingStorage }, cacheBytes = working.cacheBytes ?? 1024 * 1024;
  if (!working.fs || typeof working.directory !== 'string' || !working.directory.startsWith('/') || !Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384)
    throw new OfficeError('invalid-value', 'Explicit extraction storage and a valid cache budget are required.', 'usage');
  if (!input || typeof input.read !== 'function' || typeof input.stream !== 'function') throw new OfficeError('invalid-type', 'An immutable retained input is required.', 'usage');
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, cacheBytes / 16384);
  let archive: Awaited<ReturnType<typeof openPackageArchive>> | undefined, index: Awaited<ReturnType<typeof openRetainedPresentationIndex>> | undefined;
  let validation: Awaited<ReturnType<typeof openRetainedPresentationValidation>> | undefined, types: Awaited<ReturnType<typeof openRetainedContentTypes>> | undefined;
  let closed = false, closing: Promise<void> | undefined, count = 0;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Extraction is closed.', 'select'); if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'select'); };
  const failure = (error: unknown) => error instanceof OfficeError ? error : new OfficeError(signal.aborted ? 'cancelled' : 'io-failure', 'Extraction storage operation failed.', 'select');
  const close = () => { closed = true; return closing ??= (async () => { const results = await Promise.allSettled([types?.close(), validation?.close(), index?.close(), archive?.close(), pages.close()]); for (const result of results) if (result.status === 'rejected') throw result.reason; })(); };
  const values = new RetainedValues(pages, check, signal), order = new RetainedOrder(pages, values, check), requests = new RetainedOrder(pages, values, check);
  async function text(range: XmlRange) { const decoder = new TextDecoder(); let value = ''; for await (const bytes of values.read(range)) value += decoder.decode(bytes, { stream: true }); return value + decoder.decode(); }
  try {
    // Persist selection order and case-folded duplicate keys in caller storage.
    if (selected) for (let n = 0; n < selected.length; n++) {
      check(); const name = selected[n]!, canonical = partName(name, false);
      if (canonical !== name) throw new OfficeError('unsafe-path', 'A canonical package part is required.', 'usage');
      const key = await values.store(folded(literal(name))), value = await values.store(literal(name));
      if (!await values.insert('selected', key, value)) throw new OfficeError('invalid-value', 'Duplicate extracted part.', 'usage');
      await requests.add(literal(String(n).padStart(16, '0')), value);
    }
    await requests.seal();
    archive = await openPackageArchive(input, { ...context, workingStorage: working });
    async function* original(): ByteSource {
      check(); let iterator: AsyncIterator<Uint8Array>, exhausted = false, size = 0;
      try { iterator = input.stream()[Symbol.asyncIterator](); }
      catch { check(); throw new OfficeError('io-failure', 'Byte input failed.', 'admit'); }
      try {
        for (let reads = 0; reads < context.limits.maxReads; reads++) {
          check(); let item: IteratorResult<Uint8Array>;
          try { item = await iterator.next(); }
          catch (error) {
            check();
            if (error && typeof error === 'object' && 'code' in error) {
              if (error.code === 'ENOENT') throw new PackageNotFoundError();
              if (error.code === 'EFBIG') throw new OfficeError('resource-limit', 'Byte input exceeds its limit.', 'admit');
            }
            throw new OfficeError('io-failure', 'Byte input failed.', 'admit');
          }
          check();
          if (item.done) { exhausted = true; if (size !== input.size) throw new OfficeError('io-failure', 'Retained input size changed.', 'admit'); return; }
          if (!(item.value instanceof Uint8Array)) throw new OfficeError('invalid-type', 'Byte source returned an invalid chunk.', 'admit');
          if (item.value.length > input.size - size) throw new OfficeError('resource-limit', 'Byte input exceeds its limit.', 'admit');
          size += item.value.length; yield item.value;
        }
        throw new OfficeError('resource-limit', 'Byte source exceeded its read limit.', 'admit');
      } finally { if (!exhausted) try { await iterator.return?.(); } catch { /* primary failure wins */ } }
    }
    const fingerprint = await digest(original());
    index = await openRetainedPresentationIndex(archive, fingerprint, { ...context, workingStorage: working });
    const limits = { ...context.xmlLimits, ...context.relationshipLimits, maxBytes: Math.min(context.xmlLimits.maxBytes, context.relationshipLimits.maxBytes), maxEntries: context.archiveLimits.maxMembers };
    validation = await openRetainedPresentationValidation(archive, { ...context, workingStorage: working }, limits);
    if (!validation.valid) throw new OfficeError('invalid-opc', 'Invalid presentation graph.', 'validate-intent');
    types = await openRetainedContentTypes(archive.read('/[Content_Types].xml'), { ...context, workingStorage: working }, { maxBytes: context.xmlLimits.maxBytes, maxEntries: context.archiveLimits.maxMembers });
    async function* names() {
      if (selected) { for await (const name of requests.entries()) yield await text(name); }
      else { const names = new RetainedOrder(pages, values, check); for await (const name of archive!.parts()) { const value = await values.store(literal(name)); await names.add(literal(name), value); } await names.seal(); for await (const name of names.entries()) yield await text(name); }
    }
    for await (const part of names()) {
      check(); const size = await archive.byteLength(part), hash = await digest(archive.read(part));
      const type = await values.store(part === '/[Content_Types].xml' ? literal('application/xml') : await types.get(part));
      let essence = '', suffix = '', pendingWhitespace = 0, overflow = false;
      // MIME parameters and arbitrarily long unknown types never become strings.
      for await (const character of characters(values.read(type))) {
        if (character === ';') break;
        if (character.trim() === '') { if (essence || overflow) pendingWhitespace++; continue; }
        if (pendingWhitespace) { if (essence.length + pendingWhitespace > 32) overflow = true; else essence += ' '.repeat(pendingWhitespace); suffix = ''; pendingWhitespace = 0; }
        const lower = character.toLowerCase(); if (essence.length + lower.length > 32) overflow = true; else if (!overflow) essence += lower;
        suffix = (suffix + lower).slice(-4);
      }
      const extension = !overflow && (essence === 'application/xml' || essence === 'text/xml') || suffix === '+xml' ? 'xml' : !overflow ? extensions[essence] ?? 'bin' : 'bin';
      const name = `part-${String(++count).padStart(6, '0')}.${extension}`;
      const partRange = await values.store(literal(part)), nameRange = await values.store(literal(name)), hashRange = await values.store(literal(hash));
      const data = [partRange.start, partRange.length, nameRange.start, nameRange.length, hashRange.start, hashRange.length, type.start, type.length, size];
      const bytes = new Uint8Array(data.length * 8), view = new DataView(bytes.buffer); data.forEach((value, n) => view.setFloat64(n * 8, value, true));
      const row = await values.store((async function* () { yield bytes; })());
      await order.add(literal(String(count).padStart(16, '0')), row);
    }
    await order.seal();
    await types.close(); types = undefined; await validation.close(); validation = undefined; await index.close(); index = undefined;
    async function* members(): AsyncGenerator<RetainedExtractedPackageMember> {
      try { check();
        for await (const stored of order.entries()) {
          check(); const bytes = await pages.read(stored.start, stored.length), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          const range = (n: number): XmlRange => ({ start: view.getFloat64(n * 8, true), length: view.getFloat64((n + 1) * 8, true) });
          const part = await text(range(0)), type = range(6);
          yield Object.freeze({ part, name: await text(range(2)), sha256: await text(range(4)), size: view.getFloat64(64, true),
            async *contentType() { try { check(); yield* values.read(type); check(); } catch (error) { throw failure(error); } }, async *bytes() { check(); for await (const bytes of archive!.read(part)) { check(); yield bytes; } check(); } });
        }
      check(); } catch (error) { throw failure(error); }
    }
    return Object.freeze({ count, members, close });
  } catch (error) { await close().catch(() => {}); throw failure(error); }
}
