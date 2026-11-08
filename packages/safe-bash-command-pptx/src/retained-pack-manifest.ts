import { PagedStorage } from '@poe-code/safe-fs/storage';
import { BackedJson, parseBackedJson } from '@poe-code/json-ast';
import { yieldEventLoop } from '@poe-code/office-package';
import { ZipDirectoryIndex } from '@poe-code/office-package/zip';
import type { ByteSource } from 'safe-bash-presentation-engine/contracts';
import type { RetainedPackageContext } from 'safe-bash-presentation-engine/retained-package';
import { resourceContext } from 'safe-bash-presentation-engine/resource-limits';
import { OfficeError } from 'safe-bash-presentation-engine/errors';
import { asciiKey, partName } from 'safe-bash-presentation-engine/package-uri';
import { scopedPackagePath } from './command-package-path.js';

/** Owns the JSON tree and member lookup in caller storage. No member sources
 * are opened until syntax, schema, stdin ownership and output paths are admitted. */
export async function openRetainedPackManifest(source: ByteSource, settings: RetainedPackageContext,
  options: { readonly manifest: string; readonly output?: string }) {
  const context = resourceContext(settings), signal = context.signal ?? new AbortController().signal;
  const working = { ...settings.workingStorage }, cacheBytes = working.cacheBytes ?? 1024 * 1024;
  if (!working.fs || typeof working.directory !== 'string' || !working.directory.startsWith('/') || !Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384)
    throw new OfficeError('invalid-value', 'Explicit manifest storage and a valid cache budget are required.', 'usage');
  const manifestPath = options.manifest, outputPath = options.output;
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, cacheBytes / 16384);
  const index = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, cacheBytes / 16384);
  let closed = false, closing: Promise<void> | undefined, count = 0, parts = 0;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Manifest is closed.', 'admit'); if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'admit'); };
  const usage = (): never => { throw new OfficeError('invalid-value', 'Manifest requires unique canonical parts, hashes and explicit scoped files.', 'usage'); };
  const limit = (): never => { throw new OfficeError('resource-limit', 'Manifest exceeds input limits.', 'admit'); };
  const failure = (error: unknown) => error instanceof OfficeError ? error : new OfficeError(signal.aborted ? 'cancelled' : error && typeof error === 'object' && 'code' in error && error.code === 'EFBIG' ? 'resource-limit' : 'io-failure', 'Manifest input or storage failed.', 'admit');
  const close = () => { closed = true; return closing ??= (async () => { const outcomes = await Promise.allSettled([pages.close(), index.close()]); for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason; })(); };
  let work = 0;
  const cooperate = async (units = 1) => { check(); work += units; if (work >= 4096) { work = 0; await yieldEventLoop(); check(); } };
  const tree = new BackedJson(pages, cooperate), names = new ZipDirectoryIndex(index, { signal });
  async function text(position: number): Promise<string> {
    // A single filesystem path must cross the filesystem's string API. The
    // manifest tree and the collection of paths stay in caller storage.
    let value = ''; for await (const fragment of tree.scalarChunks(position)) { check(); value += fragment; } return value;
  }
  async function fields(position: number, keys: readonly string[]): Promise<Record<string, number>> {
    const header = await tree.describe(position);
    if (header.kind !== 'object' || header.children !== keys.length * 2) usage();
    const result: Record<string, number> = {}; let key: string | undefined;
    for await (const child of tree.children(position)) {
      check(); if (key === undefined) { key = await tree.smallText(child, Math.max(...keys.map(key => key.length))); if (key === undefined || !keys.includes(key)) usage(); }
      else { result[key] = child; key = undefined; }
    }
    return result;
  }
  async function member(row: number) {
    const fields = { part: (await tree.property(row, 'part'))!, sha256: (await tree.property(row, 'sha256'))! };
    const part = await tree.smallText(fields.part, 65535), sha256 = await tree.smallText(fields.sha256, 64);
    if (part === undefined) return limit();
    if (sha256 === undefined) return usage();
    return { part, sha256 };
  }
  async function pathAt(row: number) { const file = (await tree.property(row, 'file'))!, path = (await tree.property(file, 'vfsPath'))!; return scopedPackagePath(manifestPath, await text(path)); }
  async function* decoded() {
    let iterator: AsyncIterator<Uint8Array> | undefined, exhausted = false, size = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      iterator = source[Symbol.asyncIterator]();
      for (let reads = 0; reads < context.limits.maxReads; reads++) {
        await cooperate(); const item = await iterator.next(); check();
        if (item.done) { exhausted = true; let tail; try { tail = decoder.decode(); } catch { usage(); } if (tail) yield tail; return; }
        if (!(item.value instanceof Uint8Array)) throw new OfficeError('invalid-type', 'Manifest source returned invalid bytes.', 'admit');
        size += item.value.length; if (!Number.isSafeInteger(size) || size > Math.min(context.limits.maxBytes, context.xmlLimits.maxBytes)) limit();
        for (let offset = 0; offset < item.value.length; offset += 16384) { check(); let fragment; try { fragment = decoder.decode(item.value.subarray(offset, offset + 16384), { stream: true }); } catch { usage(); } if (fragment) yield fragment; }
      }
      limit();
    } finally { if (!exhausted) try { await iterator?.return?.(); } catch { /* primary failure wins */ } }
  }
  try {
    check(); await parseBackedJson(decoded(), tree, index, cooperate, usage, undefined, false, depth => { if (depth > 32) usage(); });
    parts = (await fields(tree.rootPosition, ['parts'])).parts!;
    const array = await tree.describe(parts); if (array.kind !== 'array' || !array.children) usage();
    count = array.children; if (count > context.archiveLimits.maxMembers) limit();
    let stdin = manifestPath === '-' ? 1 : 0;
    if (outputPath !== '-' && outputPath === manifestPath) usage();
    for await (const row of tree.children(parts)) {
      check(); const values = await fields(row, ['part', 'sha256', 'file']);
      for (const key of ['part', 'sha256']) if ((await tree.describe(values[key]!)).kind !== 'string') usage();
      const item = await member(row);
      try { if (partName(item.part, false) !== item.part) usage(); } catch { usage(); }
      if (item.sha256.length !== 64 || [...item.sha256].some(character => !'0123456789abcdef'.includes(character))) usage();
      const key = asciiKey(item.part); if (await names.get(key) !== undefined) usage(); await names.set(key, row);
      const file = await fields(values.file!, ['vfsPath']);
      if ((await tree.describe(file.vfsPath!)).kind !== 'string') usage();
      const rawPath = await text(file.vfsPath!); if (!rawPath.length) usage();
      const path = scopedPackagePath(manifestPath, rawPath);
      if (path === '-' && ++stdin > 1 || outputPath !== '-' && path === outputPath) usage();
    }
    return Object.freeze({ count, close,
      async *members() { try { check(); for await (const row of tree.children(parts)) { check(); yield await member(row); } check(); } catch (error) { throw failure(error); } },
      async path(part: string) { try { check(); const row = await names.get(asciiKey(part)); if (row === undefined) throw new OfficeError('missing-binding', 'Manifest member is absent.', 'admit'); return await pathAt(row); } catch (error) { throw failure(error); } },
      async *paths() { try { check(); yield manifestPath; for await (const row of tree.children(parts)) { check(); yield await pathAt(row); } check(); } catch (error) { throw failure(error); } }
    });
  } catch (error) { const primary = failure(error); await close().catch(() => {}); throw primary; }
}
