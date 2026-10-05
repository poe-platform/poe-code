import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ZipSource } from '@poe-code/office-package/zip';
import type { ByteSource, Location } from './contracts.js';
import { OfficeError } from './errors.js';
import { openPackageArchive, type RetainedPackageContext } from './retained-package.js';
import { openRetainedPresentationIndex } from './retained-inspection.js';
import { openRetainedText } from './retained-text.js';
import { RetainedValues, literal, equal, digest, characters } from './retained-values.js';
import { RetainedOrder } from './retained-order.js';
import { rawJson, streamJson, stageRetainedOutput } from './retained-output.js';
import { resourceContext } from './resource-limits.js';
import type { XmlRange } from './retained-xml.js';

export type RetainedDiffMode = 'raw' | 'text' | 'media' | 'relationships';
async function* joined(...sources: ByteSource[]): ByteSource { for (const source of sources) yield* source; }
async function* encoded(source: ByteSource): ByteSource { for await (const character of characters(source)) yield* literal(encodeURIComponent(character)); }

/** Borrows stable range inputs. Ordered keys, JSON values and changes live in
 * caller storage; close retires every returned stream without closing inputs. */
export async function openRetainedDiff(left: ZipSource, right: ZipSource, options: { readonly mode: RetainedDiffMode }, settings: RetainedPackageContext) {
  const mode = options?.mode;
  if (!['raw', 'text', 'media', 'relationships'].includes(mode)) throw new OfficeError('invalid-value', 'Invalid retained comparison mode.', 'usage');
  const working = { ...settings.workingStorage }, signal = settings.signal ?? new AbortController().signal, cacheBytes = working.cacheBytes ?? 1024 * 1024;
  if (!working.fs || !working.directory?.startsWith('/') || !Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384) throw new OfficeError('invalid-value', 'Invalid comparison storage.', 'usage');
  const context = { ...resourceContext(settings), workingStorage: working, signal };
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, cacheBytes / 16384);
  let closed = false, closing: Promise<void> | undefined;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Comparison is closed.', 'index'); if (signal.aborted) throw new OfficeError('cancelled', 'Comparison cancelled.', 'index'); };
  const close = () => { closed = true; return closing ??= pages.close(); };
  const values = new RetainedValues(pages, check, signal);
  async function row(pointer: number) { check(); const bytes = await pages.read(pointer, 56), view = new DataView(bytes.buffer, bytes.byteOffset, 56); return Array.from({ length: 7 }, (_, n) => view.getFloat64(n * 8, true)); }
  async function write(pointer: number, numbers: number[]) { check(); const bytes = new Uint8Array(numbers.length * 8), view = new DataView(bytes.buffer); numbers.forEach((value, n) => view.setFloat64(n * 8, value, true)); await pages.write(pointer, bytes); }
  const range = (data: number[], offset: number): XmlRange => ({ start: data[offset]!, length: data[offset + 1]! });
  const json = (value: XmlRange) => ({ [rawJson]: () => values.read(value) });
  function entries(scope: string) {
    let head = 0, tail = 0;
    const find = async (key: () => ByteSource) => { const found = await values.find(scope, key); return found ? row(found.start) : undefined; };
    return {
      find,
      async put(key: ByteSource, value: unknown, location: Location | null = null) {
        const k = await values.store(key), v = await values.store(streamJson(value)), l = await values.store(streamJson(location));
        const old = await values.find(scope, () => values.read(k));
        if (old) { await write(old.start + 24, [v.start, v.length, l.start, l.length]); return; }
        const pointer = pages.allocate(56); await write(pointer, [0, k.start, k.length, v.start, v.length, l.start, l.length]);
        await values.insert(scope, k, { start: pointer, length: 56 });
        if (tail) await write(tail, [pointer]); else head = pointer; tail = pointer;
      },
      async *rows() { check(); for (let pointer = head; pointer;) { const data = await row(pointer); yield data; pointer = data[0]!; } check(); }
    };
  }
  async function fingerprint(source: ZipSource) {
    check();
    if (!source || typeof source.read !== 'function' || !Number.isSafeInteger(source.size) || source.size < 0) throw new OfficeError('invalid-type', 'A retained package source is required.', 'usage');
    if (source.size > Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)) throw new OfficeError('resource-limit', 'Byte input exceeds its limit.', 'admit');
    async function* chunks() { for (let offset = 0; offset < source.size;) { check(); const bytes = await source.read(offset, Math.min(16384, source.size - offset), { signal }); if (!bytes.length || bytes.length > Math.min(16384, source.size - offset)) throw new OfficeError('io-failure', 'Invalid retained comparison read.', 'admit'); offset += bytes.length; yield bytes; } }
    return digest(chunks());
  }
  async function snapshot(source: ZipSource, fingerprint: string, scope: string) {
    const result = entries(scope), archive = await openPackageArchive(source, context); let index, text, failed = false;
    try {
      index = await openRetainedPresentationIndex(archive, fingerprint, context);
      const partLocation = (part: string): Location => ({ fingerprint, scope: 'shared', owner: part, objectId: part, coordinateSystem: 'identity' });
      for await (const slide of index.records.records('slide')) { const key = await values.store(literal(slide.part)), value = await values.store(literal(`slide/${encodeURIComponent(slide.id)}`)); await values.insert(`${scope}/owners`, key, value); }
      async function* owner(part: () => ByteSource): ByteSource { const known = await values.find(`${scope}/owners`, part); if (known) yield* values.read(known); else { yield* literal('part/'); yield* encoded(part()); } }
      if (mode === 'raw') {
        const order = new RetainedOrder(pages, values, check);
        for await (const part of archive.parts()) { const name = await values.store(literal(part)); await order.add(values.read(name), name); }
        await order.seal();
        for await (const name of order.entries()) {
          // Only ZIP-header-bounded names are decoded into strings.
          const decoder = new TextDecoder(); let part = ''; for await (const bytes of values.read(name)) part += decoder.decode(bytes, { stream: true }); part += decoder.decode();
          await result.put(literal(`part/${encodeURIComponent(part)}`), { sha256: await digest(archive.read(part)), bytes: await archive.byteLength(part) }, partLocation(part));
        }
      } else if (mode === 'text') {
        text = await openRetainedText(archive, fingerprint, {}, context);
        for await (const segment of text.segments()) {
          const cell = segment.cell ? `/cell/${segment.cell.row}/${segment.cell.column}` : '';
          await result.put(joined(owner(() => literal(segment.location.owner)), literal(`/shape/${encodeURIComponent(segment.location.objectId)}${cell}/text`)), segment.text, segment.location);
        }
        async function* keys() { for await (const data of result.rows()) yield () => values.read(range(data, 1)); }
        await result.put(literal('text/order'), keys());
      } else {
        const order = new RetainedOrder(pages, values, check);
        for await (const media of index.inventory.media) {
          const key = await values.store(literal(media.part)), hash = await values.store(literal(media.sha256)); await values.insert(`${scope}/media`, key, hash);
          if (mode === 'media') {
            const known = await values.find(`${scope}/counts`, () => literal(media.sha256));
            if (known) { const bytes = await pages.read(known.start, 8), view = new DataView(bytes.buffer, bytes.byteOffset, 8); await write(known.start, [view.getFloat64(0, true) + 1]); }
            else { const count = pages.allocate(16); await write(count, [1, media.bytes]); await values.insert(`${scope}/counts`, hash, { start: count, length: 16 }); await order.add(literal(media.sha256), hash); }
          }
        }
        if (mode === 'media') {
          await order.seal();
          for await (const hash of order.entries()) {
            const count = (await values.find(`${scope}/counts`, () => values.read(hash)))!, bytes = await pages.read(count.start, 16), view = new DataView(bytes.buffer, bytes.byteOffset, 16);
            await result.put(joined(literal('media/'), values.read(hash)), { sha256: () => values.read(hash), bytes: view.getFloat64(8, true), count: view.getFloat64(0, true) });
          }
        } else for await (const edge of index.inventory.relationships) {
          const media = edge.targetPart ? await values.find(`${scope}/media`, edge.targetPart) : undefined;
          const target = edge.external ? edge.target : media ? () => joined(literal('media/'), values.read(media)) : () => owner(edge.targetPart!);
          await result.put(joined(owner(() => literal(edge.owner)), literal('/relationship/'), encoded(edge.id())), { type: edge.type, external: edge.external, target }, partLocation(edge.owner));
        }
      }
      return result;
    } catch (error) { failed = true; throw error; }
    finally { const outcomes = await Promise.allSettled([text?.close(), index?.close(), archive.close()]); if (!failed) for (const outcome of outcomes) if (outcome.status === 'rejected') await Promise.reject(outcome.reason); }
  }
  try {
    // Read both stable inputs before parsing either, matching command read errors.
    const leftHash = await fingerprint(left), rightHash = await fingerprint(right);
    const before = await snapshot(left, leftHash, 'left'), after = await snapshot(right, rightHash, 'right');
    async function* changes() {
      check();
      for await (const first of before.rows()) {
        const second = await after.find(() => values.read(range(first, 1)));
        if (second && await equal(values.read(range(first, 3)), values.read(range(second, 3)))) continue;
        yield { id: () => values.read(range(first, 1)), category: mode, kind: second ? 'changed' : 'removed', before: json(range(first, 3)), after: second ? json(range(second, 3)) : null, left: json(range(first, 5)), right: second ? json(range(second, 5)) : null };
      }
      for await (const second of after.rows()) if (!await before.find(() => values.read(range(second, 1)))) yield { id: () => values.read(range(second, 1)), category: mode, kind: 'added', before: null, after: json(range(second, 3)), left: null, right: json(range(second, 5)) };
    }
    let same = true; for await (const ignoredChange of changes()) { same = false; break; }
    const limitations = ['No rendering or effective formatting comparison is performed.', ...(mode === 'text' ? ['Semantic text comparison covers slide text in structural order; other text scopes are not included.'] : []), ...(mode === 'raw' ? ['Raw comparison covers uncompressed package members; ZIP container metadata is excluded.'] : [])];
    const data = { equal: same, mode, formatting: 'raw', get changes() { return changes(); }, limitations };
    return Object.freeze({ data, close });
  } catch (error) { await close().catch(() => {}); throw error; }
}

/** Stages the response before exposing any output bytes. */
export async function stageRetainedDiff(left: ZipSource, right: ZipSource, options: { readonly mode: RetainedDiffMode; readonly json: boolean; readonly maxOutputBytes: number }, settings: RetainedPackageContext) {
  const format = { ...options }, view = await openRetainedDiff(left, right, format, settings); let staged;
  try {
    async function* render(): ByteSource {
      if (format.json) { yield* streamJson({ version: 1, operation: 'diff', ok: true, data: view.data, affected: 0, warnings: [], errors: [], locations: [] }); yield* literal('\n'); }
      else {
        yield* literal(`${view.data.equal ? 'Equal' : 'Different'} (${view.data.mode}; raw formatting)\n`);
        for await (const change of view.data.changes) { yield* literal(`${change.category} ${change.kind} `); yield* change.id(); yield* literal('\n  before: '); yield* streamJson(change.before); yield* literal('\n  after: '); yield* streamJson(change.after); yield* literal('\n'); }
      }
    }
    staged = await stageRetainedOutput(render(), settings, format.maxOutputBytes);
    await view.close(); return { output: staged, equal: view.data.equal };
  } catch (error) { await Promise.allSettled([view.close(), staged?.close()]); throw error; }
}
