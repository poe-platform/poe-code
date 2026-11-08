import { stageRetainedOutput, streamJson, type StagedOutput } from './retained-output.js';
import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource, Location } from './contracts.js';
import { OfficeError } from './errors.js';
import { validateTagOptions, type TagOptions, type TagRecord } from './tags.js';
import { decodeSelectionToken, SelectionError } from './selectors.js';
import { openRetainedPresentationIndex } from './retained-inspection.js';
import { openRetainedPresentationValidation } from './retained-validation.js';
import { openRetainedXmlDocument, type RetainedXmlDocument, type RetainedXmlNode } from './retained-xml-document.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import { RetainedValues, literal, equal, folded } from './retained-values.js';
import type { XmlRange } from './retained-xml.js';
import { resourceContext } from './resource-limits.js';
import { dialects } from './validation-schema.js';

export interface RetainedTagRecord extends Omit<TagRecord, 'name' | 'value'> { name(): ByteSource; value(): ByteSource }
enum F { Next, Metadata, MetadataLength, Name, NameLength, Value, ValueLength, Count }
/** Tag attributes and ordered records live in caller pages. ZIP-bounded owner
 * and part names are the only strings retained in a record's selector schema. */
export async function openRetainedTags(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  fingerprint: string,
  options: TagOptions,
  settings: RetainedPackageContext
) {
  validateTagOptions(options);
  const query = { ...options, ...(options.selection ? { selection: { ...options.selection, ...(options.selection.position ? { position: { ...options.selection.position } } : {}) } } : {}) };
  const context = resourceContext(settings), working = { ...settings.workingStorage }, signal = context.signal ?? new AbortController().signal;
  const index = await openRetainedPresentationIndex(archive, fingerprint, { ...context, workingStorage: working });
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, (working.cacheBytes ?? 1024 * 1024) / 16384);
  let closed = false, closing: Promise<void> | undefined, head = 0, tail = 0;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Tags are closed.', 'index'); if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'index'); };
  const close = () => { closed = true; return closing ??= (async () => { const outcomes = await Promise.allSettled([index.close(), pages.close()]); for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason; })(); };
  const values = new RetainedValues(pages, check, signal);
  const range = (row: number[], offset: number): XmlRange => ({ start: row[offset]!, length: row[offset + 1]! });
  async function row(pointer: number) { check(); const bytes = await pages.read(pointer, F.Count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return Array.from({ length: F.Count }, (_, n) => view.getFloat64(n * 8, true)); }
  async function write(pointer: number, numbers: number[]) { check(); const bytes = new Uint8Array(numbers.length * 8), view = new DataView(bytes.buffer); numbers.forEach((number, n) => view.setFloat64(n * 8, number, true)); await pages.write(pointer, bytes); }
  // The fixed record schema contains only names bounded by ZIP header limits.
  async function bounded(value: XmlRange) { const decoder = new TextDecoder(); let result = ''; for await (const bytes of values.read(value)) result += decoder.decode(bytes, { stream: true }); return result + decoder.decode(); }
  const invalid = (message: string): never => { throw new OfficeError('invalid-value', message, 'usage'); };
  async function is(document: RetainedXmlDocument, node: RetainedXmlNode, local: string, namespace: ByteSource) { return await equal(document.raw(node.localName), literal(local)) && await equal(document.namespace(node), namespace); }
  async function child(document: RetainedXmlDocument, parent: RetainedXmlNode, local: string) {
    let found;
    for await (const node of document.children(parent)) if (node.kind === 'element' && await is(document, node, local, document.namespace(parent))) { if (found) invalid('Ambiguous shared structure.'); found = node; }
    return found;
  }
  async function attribute(document: RetainedXmlDocument, node: RetainedXmlNode, local: string, namespace = '') { for await (const attr of document.attributes(node)) if (await is(document, attr, local, literal(namespace))) return attr; return undefined; }
  try {
    const validation = await openRetainedPresentationValidation(archive, { ...context, workingStorage: working }, { ...context.xmlLimits, ...context.relationshipLimits, maxBytes: Math.min(context.xmlLimits.maxBytes, context.relationshipLimits.maxBytes), maxEntries: context.archiveLimits.maxMembers });
    const valid = validation.valid; try { await validation.close(); } catch (error) { if (valid) await Promise.reject(error); }
    if (!valid) throw new OfficeError('invalid-opc', 'Invalid presentation graph.', 'validate-intent');
    for await (const part of archive.parts()) { const key = await values.store(folded(literal(part))), value = await values.store(literal(part)); await values.insert('parts', key, value); }
    const main = await openRetainedXmlDocument(archive.read(index.records.main), { ...context, workingStorage: working }); let dialect = dialects[0]!, failed = false;
    try { for (const candidate of dialects) if (await equal(main.namespace(main.root), literal(candidate.p))) dialect = candidate; }
    catch (error) { failed = true; throw error; }
    finally { try { await main.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
    let token: Location | undefined;
    if (query.selection?.token) {
      if (Object.keys(query.selection).some(key => key !== 'token')) throw new SelectionError('invalid-selection');
      token = decodeSelectionToken(query.selection.token);
      if (token.fingerprint !== fingerprint) throw new SelectionError('stale-selection');
      if (token.scope !== 'slides' && token.scope !== 'presentation' || query.scope !== undefined && query.scope !== token.scope) throw new SelectionError('invalid-selection');
    }
    async function* owners() {
      if ((token?.scope ?? query.scope) === 'presentation') { yield { part: index.records.main, slide: null }; return; }
      const selected = token ? undefined : query.selection;
      for await (const record of selected ? index.records.select({ kind: 'slide', ...selected }) : index.records.records('slide')) { if (record.kind !== 'slide') throw new SelectionError('invalid-selection'); yield { part: record.part, slide: record.position }; }
    }
    // Buffered owners() validates every selection before opening any owner XML.
    for await (const ignoredOwner of owners()) check();
    for await (const owner of owners()) {
      const document = await openRetainedXmlDocument(archive.read(owner.part), { ...context, workingStorage: working }); let failed = false, reference: XmlRange | undefined;
      try {
        const base = owner.part === index.records.main ? document.root : await child(document, document.root, 'cSld');
        if (!base) invalid('Tag owner lacks common slide data.');
        const list = await child(document, base!, 'custDataLst'), tags = list ? await child(document, list, 'tags') : undefined;
        if (tags) {
          const id = await attribute(document, tags, 'id', dialect.r); let count = 0;
          if (id) for await (const edge of index.graph.outgoing(owner.part)) if (edge.owner === owner.part && !edge.external && await equal(edge.type(), literal(`${dialect.r}/tags`)) && await equal(edge.id(), document.text(id))) { count++; if (edge.targetPart) reference = await values.store(edge.targetPart()); }
          if (count !== 1 || !reference) invalid('Invalid tag association.');
        }
      } catch (error) { failed = true; throw error; }
      finally { try { await document.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
      if (!reference) continue;
      const original = await values.find('parts', () => folded(values.read(reference!)));
      if (!original) throw new OfficeError('missing-binding', 'Package member is absent.', 'index');
      const part = await bounded(reference), tags = await openRetainedXmlDocument(archive.read(await bounded(original)), { ...context, workingStorage: working }); let failedTags = false;
      try {
        if (!await is(tags, tags.root, 'tagLst', literal(dialect.p))) invalid('Invalid tag list.');
        let childIndex = 0;
        for await (const node of tags.children(tags.root)) {
          if (node.kind !== 'element') continue;
          const position = childIndex++;
          if (!await is(tags, node, 'tag', literal(dialect.p))) continue;
          const name = await attribute(tags, node, 'name'), value = await attribute(tags, node, 'val');
          if (!name || !value) invalid('Tag requires name and value attributes.');
          const location: Location = { fingerprint, scope: owner.slide === null ? 'presentation' : 'slides', owner: owner.part, objectId: `tag:${part}:${position}`, coordinateSystem: 'identity' };
          const metadata = await values.store(literal(JSON.stringify({ part, owner: owner.part, slide: owner.slide, selector: JSON.stringify(location), location })));
          const key = await values.store(tags.text(name!)), text = await values.store(tags.text(value!));
          const pointer = pages.allocate(F.Count * 8); await write(pointer, [0, metadata.start, metadata.length, key.start, key.length, text.start, text.length]);
          if (tail) await write(tail, [pointer]); else head = pointer; tail = pointer;
        }
      } catch (error) { failedTags = true; throw error; }
      finally { try { await tags.close(); } catch (error) { if (!failedTags) await Promise.reject(error); } }
    }
    await index.close();
    return Object.freeze({ close, async *records(): AsyncGenerator<RetainedTagRecord> {
      check();
      for (let pointer = head; pointer;) {
        const data = await row(pointer); pointer = data[F.Next]!;
        const metadata = JSON.parse(await bounded(range(data, F.Metadata))) as Omit<TagRecord, 'name' | 'value'>;
        if (token && metadata.selector !== query.selection!.token) continue;
        yield { name: () => values.read(range(data, F.Name)), value: () => values.read(range(data, F.Value)), ...metadata };
      }
      check();
    } });
  } catch (error) { await close().catch(() => {}); throw error instanceof OfficeError ? error : new OfficeError(signal.aborted ? 'cancelled' : 'io-failure', 'Tag storage operation failed.', 'index'); }
}

/** Stage complete responses before exposing output or retiring metadata. */
export async function stageRetainedTags(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  fingerprint: string,
  query: TagOptions,
  settings: RetainedPackageContext,
  output: { readonly operation: 'tags.list' | 'tags.get'; readonly json: boolean; readonly maxOutputBytes: number }
): Promise<StagedOutput> {
  const format = { ...output };
  if (!['tags.list', 'tags.get'].includes(format.operation)) throw new OfficeError('invalid-value', 'Invalid tag read operation.', 'usage');
  const tags = await openRetainedTags(archive, fingerprint, query, settings); let staged: StagedOutput | undefined;
  try {
    if (format.operation === 'tags.get') { let count = 0; for await (const ignoredRecord of tags.records()) count++; if (count !== 1) throw new SelectionError(count ? 'ambiguous-selection' : 'missing-selection'); }
    async function* locations() { for await (const tag of tags.records()) yield tag.location; }
    async function* render(): ByteSource {
      if (format.json) { yield* streamJson({ version: 1, operation: format.operation, ok: true, data: { tags: tags.records() }, affected: 0, warnings: [], errors: [], locations: locations() }); yield* literal('\n'); }
      else for await (const tag of tags.records()) { yield* streamJson(tag.name); yield* literal(': '); yield* streamJson(tag.value); yield* literal('\n'); }
    }
    staged = await stageRetainedOutput(render(), settings, format.maxOutputBytes); await tags.close(); return staged;
  } catch (error) { await Promise.allSettled([tags.close(), staged?.close()]); throw error; }
}
