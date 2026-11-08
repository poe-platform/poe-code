import { PagedStorage } from '@poe-code/safe-fs/storage';
import { createZipCodec, type ZipMetadataStorage } from '@poe-code/office-package/zip';
import { sha256 } from '@noble/hashes/sha2.js';
import type { ByteSource } from './contracts.js';
import type { PresentationKind } from './content-types.js';
import { OfficeError, PackageNotFoundError } from './errors.js';
import { openPackageArchive, type RetainedPackageContext } from './retained-package.js';
import { openRetainedPresentationIndex } from './retained-inspection.js';
import { openRetainedPresentationValidation } from './retained-validation.js';
import { openRetainedContentTypes } from './retained-content-types.js';
import { RetainedValues, literal } from './retained-values.js';
import { RetainedOrder } from './retained-order.js';
import { asciiKey, partName } from './package-uri.js';
import { admitRetainedPackageEdit } from './retained-package-edit-admission.js';
import { resourceContext } from './resource-limits.js';

export interface RetainedPackMember { readonly part: string; readonly sha256: string }
/** Persist and admit all descriptors before opening members. Each source is
 * consumed once; neither the caller's descriptors nor its chunks are retained.
 * The returned archive owns caller-backed pages and must be closed. */
export async function stageRetainedPackage(members: AsyncIterable<RetainedPackMember>,
  openMember: (part: string) => ByteSource, settings: RetainedPackageContext,
  options: { readonly kind?: PresentationKind } = {}) {
  const context = resourceContext(settings), signal = context.signal ?? new AbortController().signal;
  const working = { ...settings.workingStorage }, cacheBytes = working?.cacheBytes ?? 1024 * 1024;
  if (!working?.fs || typeof working.directory !== 'string' || !working.directory.startsWith('/') || !Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384)
    throw new OfficeError('invalid-value', 'Explicit packing storage and a valid cache budget are required.', 'usage');
  function record(value: unknown, keys: readonly string[]) {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key) || !('value' in Object.getOwnPropertyDescriptor(value, key)!)))
      throw new OfficeError('invalid-value', 'Expected a plain package record.', 'usage');
  }
  record(options, ['kind']);
  if (options.kind !== undefined && !['pptx', 'potx', 'ppsx'].includes(options.kind)) throw new OfficeError('invalid-value', 'Invalid presentation kind.', 'usage');
  const kind = options.kind, admittedSettings = { ...context, signal, workingStorage: working };
  if (!members || typeof members[Symbol.asyncIterator] !== 'function' || typeof openMember !== 'function') throw new OfficeError('invalid-type', 'Explicit package member streams are required.', 'usage');
  const makePages = () => new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, cacheBytes / 16384);
  const descriptors = makePages(), zipPages = makePages(), output = makePages();
  let closed = false, closing: Promise<void> | undefined;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Packed output is closed.', 'serialize'); if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'serialize'); };
  const failure = (error: unknown) => {
    if (signal.aborted) return new OfficeError('cancelled', 'Operation cancelled.', 'serialize');
    if (error instanceof OfficeError) return error;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    return new OfficeError(code === 'resource-limit' || code === 'EFBIG' ? 'resource-limit' : 'io-failure', 'Package packing failed.', 'serialize');
  };
  const close = () => { closed = true; return closing ??= (async () => { const results = await Promise.allSettled([descriptors.close(), zipPages.close(), output.close()]); for (const result of results) if (result.status === 'rejected') throw result.reason; })(); };
  const values = new RetainedValues(descriptors, check, signal), order = new RetainedOrder(descriptors, values, check);
  const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const bounds = (size: number, maximum: number) => { if (!Number.isSafeInteger(size) || size > maximum) throw new OfficeError('resource-limit', 'Package byte limit exceeded.', 'admit'); };
  try {
    check(); let count = 0;
    for await (const member of members) {
      check(); bounds(++count, Math.min(context.archiveLimits.maxMembers, 65534)); record(member, ['part', 'sha256']);
      const part = partName(member.part, false), expectedDigest = member.sha256;
      if (part !== member.part || part.includes(':')) throw new OfficeError('unsafe-path', 'A canonical package part is required.', 'usage');
      if (typeof expectedDigest !== 'string' || expectedDigest.length !== 64 || [...expectedDigest].some(character => !'0123456789abcdef'.includes(character))) throw new OfficeError('invalid-value', 'A lowercase SHA-256 digest is required.', 'usage');
      const name = [...part.slice(1)].map(character => character.codePointAt(0)! > 127 ? encodeURIComponent(character) : character).join('');
      bounds(new TextEncoder().encode(name).length, Math.min(context.archiveLimits.maxPathBytes, 65535)); bounds(name.split('/').length, context.archiveLimits.maxDepth);
      const key = asciiKey(part);
      if (await values.find('names', () => literal(key)) || await values.find('parents', () => literal(key))) throw new OfficeError('invalid-opc', 'Colliding package members.', 'admit');
      let parent = key.slice(0, key.lastIndexOf('/'));
      while (parent) {
        if (await values.find('names', () => literal(parent))) throw new OfficeError('invalid-opc', 'Colliding package members.', 'admit');
        const value = await values.store(literal(parent)); await values.insert('parents', value, value); parent = parent.slice(0, parent.lastIndexOf('/'));
      }
      const value = await values.store(literal(key)); await values.insert('names', value, value);
      await order.add(literal(name), await values.store(literal(JSON.stringify({ part, name, sha256: expectedDigest }))));
    }
    if (!count) throw new OfficeError('invalid-value', 'Explicit package members are required.', 'usage');
    await order.seal();
    const storage: ZipMetadataStorage = { allocate: length => zipPages.allocate(length), read: (position, length) => zipPages.read(position, length), write: (position, bytes) => zipPages.write(position, bytes) };
    const writer = createZipCodec(undefined, { zip64: true, rejectDuplicateNames: true, utcDates: true }).createStagedWriter(storage,
      { ...context.archiveLimits, maxArchiveBytes: Math.min(context.archiveLimits.maxArchiveBytes, context.limits.maxBytes) }, signal);
    let total = 0;
    for await (const row of order.entries()) {
      check(); let text = ''; const decoder = new TextDecoder(); for await (const bytes of values.read(row)) text += decoder.decode(bytes, { stream: true }); text += decoder.decode();
      const member = JSON.parse(text) as RetainedPackMember & { name: string };
      async function* source(): ByteSource {
        let iterator: AsyncIterator<Uint8Array> | undefined, exhausted = false, size = 0;
        const hash = sha256.create();
        try {
          try { iterator = openMember(member.part)[Symbol.asyncIterator](); } catch { throw new OfficeError('io-failure', 'Byte input failed.', 'admit'); }
          for (let reads = 0; reads < context.limits.maxReads; reads++) {
            check(); let item: IteratorResult<Uint8Array>;
            try { item = await iterator.next(); } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') throw new PackageNotFoundError(); throw failure(error); }
            check();
            if (item.done) { exhausted = true; if (hex(hash.digest()) !== member.sha256) throw new OfficeError('invalid-value', 'Package member digest does not match.', 'admit'); return; }
            if (!(item.value instanceof Uint8Array)) throw new OfficeError('invalid-type', 'Byte source returned an invalid chunk.', 'admit');
            size += item.value.length; total += item.value.length; bounds(size, Math.min(context.limits.maxBytes, context.archiveLimits.maxEntryBytes)); bounds(total, context.archiveLimits.maxTotalBytes);
            for (let offset = 0; offset < item.value.length; offset += 16384) { check(); const owned = new Uint8Array(item.value.subarray(offset, offset + 16384)); hash.update(owned); yield owned; }
          }
          throw new OfficeError('resource-limit', 'Byte source exceeded its read limit.', 'admit');
        } finally { if (!exhausted) try { await iterator?.return?.(); } catch { /* primary failure wins */ } }
      }
      await writer.addSource(member.name, source(), { modified: new Date(Date.UTC(1980, 0, 1)), mode: 0o100644, directory: false, symlink: false, compression: 'store' });
    }
    const start = output.allocate(0); let size = 0; const hash = sha256.create();
    for await (const bytes of writer.finish()) { check(); await output.append(bytes); hash.update(bytes); size += bytes.length; }
    const fingerprint = hex(hash.digest());
    await descriptors.close(); await zipPages.close();
    async function* bytes(): ByteSource { try { check(); for (let offset = 0; offset < size; offset += 16384) { check(); yield await output.read(start + offset, Math.min(16384, size - offset)); } check(); } catch (error) { throw failure(error); } }
    const archive = await openPackageArchive({ size, read: (position, maximum) => output.read(start + position, Math.min(maximum, size - position)) }, admittedSettings);
    let index: Awaited<ReturnType<typeof openRetainedPresentationIndex>> | undefined, validation: Awaited<ReturnType<typeof openRetainedPresentationValidation>> | undefined, types: Awaited<ReturnType<typeof openRetainedContentTypes>> | undefined, failed = false;
    try {
      index = await openRetainedPresentationIndex(archive, fingerprint, admittedSettings);
      validation = await openRetainedPresentationValidation(archive, admittedSettings, { ...context.xmlLimits, ...context.relationshipLimits, maxBytes: Math.min(context.xmlLimits.maxBytes, context.relationshipLimits.maxBytes), maxEntries: context.archiveLimits.maxMembers });
      if (!validation.valid) throw new OfficeError('invalid-opc', 'Invalid presentation graph.', 'validate-intent');
      types = await openRetainedContentTypes(archive.read('/[Content_Types].xml'), admittedSettings, { maxBytes: Math.min(context.xmlLimits.maxBytes, context.relationshipLimits.maxBytes), maxEntries: context.archiveLimits.maxMembers });
      await admitRetainedPackageEdit(archive, index.records.main, types, index.graph, admittedSettings);
      if (kind !== undefined) await types.presentationKind(index.records.main, kind);
    } catch (error) { failed = true; throw error; }
    finally { const results = await Promise.allSettled([types?.close(), validation?.close(), index?.close(), archive.close()]); if (!failed) for (const result of results) if (result.status === 'rejected') await Promise.reject(result.reason); }
    check(); return Object.freeze({ count, size, fingerprint, bytes, close });
  } catch (error) { const primary = failure(error); await close().catch(() => {}); throw primary; }
}
