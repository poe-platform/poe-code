import { openRetainedProperties } from './retained-properties.js';
import { retainedGeometry, retainedShapeNode } from './retained-geometry.js';
import { openRetainedXmlDocument } from './retained-xml-document.js';
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

const categories = ['slides', 'text', 'properties', 'geometry', 'media', 'relationships', 'opaque', 'raw'] as const;
export type RetainedDiffMode = 'structural' | 'raw' | 'text' | 'media' | 'relationships';
async function* joined(...sources: ByteSource[]): ByteSource { for (const source of sources) yield* source; }
async function* encoded(source: ByteSource): ByteSource { for await (const character of characters(source)) yield* literal(encodeURIComponent(character)); }

/** Borrows stable range inputs. Ordered keys, JSON values and changes live in
 * caller storage; close retires every returned stream without closing inputs. */
export async function openRetainedDiff(left: ZipSource, right: ZipSource, options: { readonly mode: RetainedDiffMode }, settings: RetainedPackageContext) {
  const mode = options?.mode;
  if (!['structural', 'raw', 'text', 'media', 'relationships'].includes(mode)) throw new OfficeError('invalid-value', 'Invalid retained comparison mode.', 'usage');
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
  const json = (value: XmlRange) => ({ [rawJson]: (): ByteSource => values.read(value) });
  function entries(scope: string) {
    let head = 0, tail = 0;
    const find = async (key: () => ByteSource) => { const found = await values.find(scope, key); return found ? row(found.start) : undefined; };
    return {
      find,
      async put(key: ByteSource, value: unknown, location: unknown = null) {
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
    const result = new Map(categories.map(category => [category, entries(`${scope}/${category}`)])), archive = await openPackageArchive(source, context); let index, text, failed = false;
    try {
      index = await openRetainedPresentationIndex(archive, fingerprint, context);
      const partLocation = (part: string): Location => ({ fingerprint, scope: 'shared', owner: part, objectId: part, coordinateSystem: 'identity' });
      for await (const slide of index.records.records('slide')) { const key = await values.store(literal(slide.part)), value = await values.store(literal(`slide/${encodeURIComponent(slide.id)}`)); await values.insert(`${scope}/owners`, key, value); }
      async function* owner(part: () => ByteSource): ByteSource { const known = await values.find(`${scope}/owners`, part); if (known) yield* values.read(known); else { yield* literal('part/'); yield* encoded(part()); } }
      if (mode === 'structural') {
        for await (const slide of index.inventory.slides) {
          const key = await values.store(literal(slide.id)), value = await values.store(literal(JSON.stringify(slide.show.explicit))); await values.insert(`${scope}/visibility`, key, value);
        }
        for await (const slide of index.records.records('slide')) {
          const id = `slide/${encodeURIComponent(slide.id)}`;
          await result.get('slides')!.put(literal(id), { name: slide.name }, slide.location);
          await result.get('slides')!.put(literal(`${id}/position`), slide.position, slide.location);
          await result.get('slides')!.put(literal(`${id}/visibility`), json((await values.find(`${scope}/visibility`, () => literal(slide.id)))!), slide.location);
        }
        const properties = await openRetainedProperties(archive, fingerprint, {}, context); let failed = false;
        try {
          const order = new RetainedOrder(pages, values, check);
          for await (const property of properties.records()) {
            const key = await values.store(joined(literal(`property/${property.kind}/`), encoded(property.namespace()), literal('/'), encoded(property.name())));
            const value = await values.store(streamJson({ type: property.type, value: property.value }));
            const location = await values.store(streamJson({ fingerprint, scope: 'shared', owner: property.part, objectId: property.part, coordinateSystem: 'identity' }));
            const pointer = pages.allocate(56); await write(pointer, [0, key.start, key.length, value.start, value.length, location.start, location.length]);
            await order.add(joined(literal(`${property.kind}/`), property.namespace(), literal('/'), property.name()), { start: pointer, length: 56 });
          }
          await order.seal();
          for await (const pointer of order.entries()) { const data = await row(pointer.start); await result.get('properties')!.put(values.read(range(data, 1)), json(range(data, 3)), json(range(data, 5))); }
        } catch (error) { failed = true; throw error; }
        finally { try { await properties.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
        let document: Awaited<ReturnType<typeof openRetainedXmlDocument>> | undefined, part: string | undefined, geometryFailed = false;
        try {
          for await (const object of index.records.records('object')) {
            if (object.location.scope !== 'slides') continue;
            if (part !== object.part) { const old = document; document = undefined; await old?.close(); part = object.part; document = await openRetainedXmlDocument(archive.read(part), context); }
            const doc = document!, node = await retainedShapeNode(doc, object.id, check);
            let shapeOwner = node;
            for await (const child of doc.children(node)) if (child.kind === 'element' && await equal(doc.namespace(child), doc.namespace(node)) && (await equal(doc.raw(child.localName), literal('spPr')) || await equal(doc.raw(child.localName), literal('grpSpPr')))) { shapeOwner = child; break; }
            const drawing = await equal(doc.namespace(node), literal('http://purl.oclc.org/ooxml/presentationml/main')) ? 'http://purl.oclc.org/ooxml/drawingml/main' : 'http://schemas.openxmlformats.org/drawingml/2006/main';
            const graphic = await equal(doc.raw(node.localName), literal('graphicFrame'));
            async function* transforms() {
              for await (const child of doc.children(shapeOwner)) {
                if (child.kind !== 'element' || !await equal(doc.namespace(child), graphic ? doc.namespace(node) : literal(drawing))) continue;
                if (await equal(doc.raw(child.localName), literal('xfrm')) || await equal(doc.raw(child.localName), literal('prstGeom')) || await equal(doc.raw(child.localName), literal('custGeom'))) yield { [rawJson]: () => retainedGeometry(doc, child, context) };
              }
            }
            await result.get('geometry')!.put(joined(owner(() => literal(object.part)), literal(`/shape/${encodeURIComponent(object.id)}/geometry`)), transforms(), object.location);
          }
        } catch (error) { geometryFailed = true; throw error; }
        finally { try { await document?.close(); } catch (error) { if (!geometryFailed) await Promise.reject(error); } }
      }
      if (mode === 'raw') {
        const order = new RetainedOrder(pages, values, check);
        for await (const part of archive.parts()) { const name = await values.store(literal(part)); await order.add(values.read(name), name); }
        await order.seal();
        for await (const name of order.entries()) {
          // Only ZIP-header-bounded names are decoded into strings.
          const decoder = new TextDecoder(); let part = ''; for await (const bytes of values.read(name)) part += decoder.decode(bytes, { stream: true }); part += decoder.decode();
          await result.get('raw')!.put(literal(`part/${encodeURIComponent(part)}`), { sha256: await digest(archive.read(part)), bytes: await archive.byteLength(part) }, partLocation(part));
        }
      }
      if (mode === 'text' || mode === 'structural') {
        text = await openRetainedText(archive, fingerprint, {}, context);
        for await (const segment of text.segments()) {
          const cell = segment.cell ? `/cell/${segment.cell.row}/${segment.cell.column}` : '';
          await result.get('text')!.put(joined(owner(() => literal(segment.location.owner)), literal(`/shape/${encodeURIComponent(segment.location.objectId)}${cell}/text`)), segment.text, segment.location);
        }
        async function* keys() { for await (const data of result.get('text')!.rows()) yield () => values.read(range(data, 1)); }
        await result.get('text')!.put(literal('text/order'), keys());
      }
      if (mode === 'media' || mode === 'relationships' || mode === 'structural') {
        const order = new RetainedOrder(pages, values, check);
        for await (const media of index.inventory.media) {
          const key = await values.store(literal(media.part)), hash = await values.store(literal(media.sha256)); await values.insert(`${scope}/media`, key, hash);
          if (mode === 'media' || mode === 'structural') {
            const known = await values.find(`${scope}/counts`, () => literal(media.sha256));
            if (known) { const bytes = await pages.read(known.start, 8), view = new DataView(bytes.buffer, bytes.byteOffset, 8); await write(known.start, [view.getFloat64(0, true) + 1]); }
            else { const count = pages.allocate(16); await write(count, [1, media.bytes]); await values.insert(`${scope}/counts`, hash, { start: count, length: 16 }); await order.add(literal(media.sha256), hash); }
          }
        }
        if (mode === 'media' || mode === 'structural') {
          await order.seal();
          for await (const hash of order.entries()) {
            const count = (await values.find(`${scope}/counts`, () => values.read(hash)))!, bytes = await pages.read(count.start, 16), view = new DataView(bytes.buffer, bytes.byteOffset, 16);
            await result.get('media')!.put(joined(literal('media/'), values.read(hash)), { sha256: () => values.read(hash), bytes: view.getFloat64(8, true), count: view.getFloat64(0, true) });
          }
        }
        if (mode === 'relationships' || mode === 'structural') for await (const edge of index.inventory.relationships) {
          const media = edge.targetPart ? await values.find(`${scope}/media`, edge.targetPart) : undefined;
          const target = edge.external ? edge.target : media ? () => joined(literal('media/'), values.read(media)) : () => owner(edge.targetPart!);
          await result.get('relationships')!.put(joined(owner(() => literal(edge.owner)), literal('/relationship/'), encoded(edge.id())), { type: edge.type, external: edge.external, target }, partLocation(edge.owner));
        }
      }
      if (mode === 'structural') for await (const part of index.inventory.parts) if (!await values.find(`${scope}/media`, () => literal(part.part))) await result.get('opaque')!.put(literal(`part/${encodeURIComponent(part.part)}`), { sha256: part.sha256, bytes: part.bytes, contentType: part.contentType }, partLocation(part.part));
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
      for (const category of categories) {
      const a = before.get(category)!, b = after.get(category)!;
      async function suppressed(data: number[]) {
        if (category !== 'slides') return false;
        // Slide IDs and these suffixes have bounded admitted schemas.
        let id = ''; for await (const bytes of values.read(range(data, 1))) id += new TextDecoder().decode(bytes);
        if (!id.endsWith('/position') && !id.endsWith('/visibility')) return false;
        const root = id.slice(0, id.lastIndexOf('/'));
        return !await a.find(() => literal(root)) || !await b.find(() => literal(root));
      }
      for await (const first of a.rows()) {
        const second = await b.find(() => values.read(range(first, 1)));
        if (second && await equal(values.read(range(first, 3)), values.read(range(second, 3)))) continue;
        if (await suppressed(first)) continue;
        yield { id: (): ByteSource => values.read(range(first, 1)), category, kind: second ? 'changed' : 'removed', before: json(range(first, 3)), after: second ? json(range(second, 3)) : null, left: json(range(first, 5)), right: second ? json(range(second, 5)) : null };
      }
      for await (const second of b.rows()) if (!await a.find(() => values.read(range(second, 1))) && !await suppressed(second)) yield { id: (): ByteSource => values.read(range(second, 1)), category, kind: 'added', before: null, after: json(range(second, 3)), left: null, right: json(range(second, 5)) };
      }
    }
    let same = true; for await (const ignoredChange of changes()) { same = false; break; }
    const limitations = ['No rendering or effective formatting comparison is performed.', ...(mode === 'structural' ? ['Nonmedia part byte hashes conservatively report raw and unsupported content changes, including parts also inspected semantically.'] : []), ...(mode === 'text' || mode === 'structural' ? ['Semantic text comparison covers slide text in structural order; other text scopes are not included.'] : []), ...(mode === 'raw' ? ['Raw comparison covers uncompressed package members; ZIP container metadata is excluded.'] : [])];
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
