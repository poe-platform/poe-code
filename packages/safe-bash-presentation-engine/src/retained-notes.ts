import { openRetainedPresentationValidation } from './retained-validation.js';
import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource } from './contracts.js';
import type { NotesRecord } from './notes.js';
import { OfficeError } from './errors.js';
import { SelectionError, type SelectionQuery } from './selectors.js';
import { openRetainedPresentationIndex } from './retained-inspection.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import { openRetainedXmlDocument, type RetainedXmlNode } from './retained-xml-document.js';
import { RetainedValues, literal, equal, folded } from './retained-values.js';
import type { XmlRange } from './retained-xml.js';
import { resourceContext } from './resource-limits.js';
import { dialects } from './validation-schema.js';
import { stageRetainedOutput, streamJson, type StagedOutput } from './retained-output.js';

export interface RetainedNotesRecord extends Omit<NotesRecord, 'part' | 'master' | 'text' | 'bodyShapeId'> {
  part(): ByteSource;
  master(): ByteSource;
  readonly text: (() => ByteSource) | null;
  readonly bodyShapeId: (() => ByteSource) | null;
}
export interface RetainedNotes {
  readonly count: number;
  records(): AsyncGenerator<RetainedNotesRecord>;
  close(): Promise<void>;
}
enum F { Next, Metadata, MetadataLength, Part, PartLength, Master, MasterLength, Text, TextLength, Id, IdLength, Count }
/** Borrow the archive; retain every selected note in caller storage before exposing records. */
export async function openRetainedNotes(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  fingerprint: string,
  options: { readonly selection?: SelectionQuery },
  settings: RetainedPackageContext,
  selectBeforeValidation = false
): Promise<RetainedNotes> {
  if (!options || typeof options !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(options)) || Object.keys(options).some(key => key !== 'selection'))
    throw new OfficeError('invalid-value', 'Invalid notes query.', 'usage');
  if (options.selection !== undefined && (!options.selection || typeof options.selection !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(options.selection))))
    throw new SelectionError('invalid-selection');
  const selection = options.selection === undefined ? undefined : { ...options.selection, kind: options.selection.kind ?? 'slide', ...(options.selection.position ? { position: { ...options.selection.position } } : {}) };
  const context = resourceContext(settings), working = { ...settings.workingStorage }, signal = context.signal ?? new AbortController().signal;
  const index = await openRetainedPresentationIndex(archive, fingerprint, { ...context, workingStorage: working });
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, (working.cacheBytes ?? 1024 * 1024) / 16384);
  let closed = false, closing: Promise<void> | undefined, first = 0, last = 0, count = 0;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Notes are closed.', 'select'); if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'select'); };
  const failure = (error: unknown) => error instanceof OfficeError ? error : new OfficeError(signal.aborted ? 'cancelled' : 'io-failure', 'Notes storage operation failed.', 'select');
  const close = () => { closed = true; return closing ??= (async () => { const outcomes = await Promise.allSettled([index.close(), pages.close()]); for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason; })(); };
  const values = new RetainedValues(pages, check, signal);
  const range = (row: number[], field: F): XmlRange => ({ start: row[field]!, length: row[field + 1]! });
  async function row(pointer: number) { check(); const bytes = await pages.read(pointer, F.Count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return Array.from({ length: F.Count }, (_, n) => view.getFloat64(n * 8, true)); }
  async function write(pointer: number, numbers: number[]) { check(); const bytes = new Uint8Array(numbers.length * 8), view = new DataView(bytes.buffer); numbers.forEach((number, n) => view.setFloat64(n * 8, number, true)); await pages.write(pointer, bytes); }
  // Only admitted ZIP names and fixed-schema selection descriptors are decoded.
  async function metadata(value: XmlRange) { const decoder = new TextDecoder(); let result = ''; for await (const bytes of values.read(value)) result += decoder.decode(bytes, { stream: true }); return result + decoder.decode(); }
  try {
    // notes.get historically admits its selector before loadShared validation.
    if (selectBeforeValidation && selection) for await (const record of index.records.select(selection)) { void record; check(); }
    const validation = await openRetainedPresentationValidation(archive, { ...context, workingStorage: working }, {
      ...context.xmlLimits, ...context.relationshipLimits,
      maxBytes: Math.min(context.xmlLimits.maxBytes, context.relationshipLimits.maxBytes), maxEntries: context.archiveLimits.maxMembers
    });
    const valid = validation.valid;
    try { await validation.close(); } catch (error) { if (valid) await Promise.reject(error); }
    if (!valid) throw new OfficeError('invalid-opc', 'Invalid presentation graph.', 'validate-intent');
    for await (const part of archive.parts()) { const key = await values.store(folded(literal(part))), value = await values.store(literal(part)); await values.insert('parts', key, value); }
    const main = await openRetainedXmlDocument(archive.read(index.records.main), { ...context, workingStorage: working });
    let dialect = dialects[0]!, mainFailed = false;
    try { for (const candidate of dialects) if (await equal(main.namespace(main.root), literal(candidate.p))) dialect = candidate; }
    catch (error) { mainFailed = true; throw error; }
    finally { try { await main.close(); } catch (error) { if (!mainFailed) await Promise.reject(error); } }
    async function target(owner: string, kind: string, internal: boolean) {
      for await (const edge of index.graph.outgoing(owner)) if ((!internal || !edge.external) && await equal(edge.type(), literal(`${dialect.r}/${kind}`))) {
        if (!edge.targetPart) return undefined;
        const original = await values.find('parts', () => folded(edge.targetPart!()));
        if (!original) throw new OfficeError('missing-binding', 'Package member is absent.', 'index');
        return { name: await metadata(original), reference: await values.store(edge.targetPart()) };
      }
      return undefined;
    }
    // The buffered selector validates all selected kinds before opening notes.
    if (selection) for await (const slide of index.records.select(selection)) if (slide.kind !== 'slide') throw new SelectionError('invalid-selection');
    for await (const slide of selection ? index.records.select(selection) : index.records.records('slide')) {
      const part = await target(slide.part, 'notesSlide', true); if (!part) continue;
      const document = await openRetainedXmlDocument(archive.read(part.name), { ...context, workingStorage: working }); let failed = false;
      try {
        async function is(node: RetainedXmlNode, local: string, namespace: ByteSource) { return node.kind === 'element' && await equal(document.raw(node.localName), literal(local)) && await equal(document.namespace(node), namespace); }
        async function child(node: RetainedXmlNode | undefined, local: string) {
          if (!node) return undefined; let found: RetainedXmlNode | undefined;
          for await (const candidate of document.children(node)) if (await is(candidate, local, document.namespace(node))) { if (found) throw new OfficeError('invalid-value', 'Ambiguous shared structure.', 'usage'); found = candidate; }
          return found;
        }
        async function required(node: RetainedXmlNode, local: string) { const found = await child(node, local); if (!found) throw new OfficeError('unsupported-edit', 'Unsupported shared structure.', 'validate-intent'); return found; }
        async function attribute(node: RetainedXmlNode | undefined, local: string) { if (node) for await (const candidate of document.attributes(node)) if (await equal(document.raw(candidate.localName), literal(local)) && await equal(document.namespace(candidate), literal(''))) return candidate; return undefined; }
        const tree = await required(await required(document.root, 'cSld'), 'spTree'); let body: RetainedXmlNode | undefined;
        for await (const node of document.children(tree)) if (await is(node, 'sp', document.namespace(document.root))) {
          const placeholder = await child(await child(await child(node, 'nvSpPr'), 'nvPr'), 'ph'), type = await attribute(placeholder, 'type');
          if (type && await equal(document.text(type), literal('body'))) { if (body) throw new OfficeError('ambiguous-selection', 'Notes have multiple speaker bodies.', 'select'); body = node; }
        }
        const id = await attribute(await child(await child(body, 'nvSpPr'), 'cNvPr'), 'id'), textBody = await child(body, 'txBody');
        const idRange = id ? await values.store(document.text(id)) : { start: -1, length: 0 };
        let drawing = dialects[0]!.a;
        for (const candidate of dialects) if (await equal(document.namespace(document.root), literal(candidate.p))) drawing = candidate.a;
        async function* speakerText(): ByteSource {
          let separator = false;
          if (textBody) for await (const paragraph of document.children(textBody)) if (await is(paragraph, 'p', literal(drawing))) {
            if (separator) yield* literal('\n'); separator = true;
            for await (const inline of document.children(paragraph)) {
              if (await is(inline, 'br', literal(drawing))) yield* literal('\v');
              else if (await is(inline, 'r', literal(drawing)) || await is(inline, 'fld', literal(drawing)))
                for await (const text of document.children(inline)) if (await is(text, 't', literal(drawing))) yield* document.text(text);
            }
          }
        }
        const text = textBody ? await values.store(speakerText()) : { start: -1, length: 0 }, master = await target(part.name, 'notesMaster', false);
        if (!master) throw new OfficeError('invalid-opc', 'Missing notes master.', 'index');
        const descriptor = await values.store(literal(JSON.stringify({ selector: slide.token, location: slide.location, slide: slide.position })));
        const pointer = pages.allocate(F.Count * 8);
        await write(pointer, [0, descriptor.start, descriptor.length, part.reference.start, part.reference.length, master.reference.start, master.reference.length, text.start, text.length, idRange.start, idRange.length]);
        if (last) await write(last, [pointer]); else first = pointer; last = pointer; count++;
      } catch (error) { failed = true; throw error; }
      finally { try { await document.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
    }
    await index.close(); check();
    async function* records(): AsyncGenerator<RetainedNotesRecord> {
      try { for (let pointer = first; pointer;) {
        const entry = await row(pointer), descriptor = JSON.parse(await metadata(range(entry, F.Metadata))) as Pick<NotesRecord, 'selector' | 'location' | 'slide'>;
        yield { ...descriptor, part: () => values.read(range(entry, F.Part)), master: () => values.read(range(entry, F.Master)),
          text: entry[F.Text] === -1 ? null : () => values.read(range(entry, F.Text)), bodyShapeId: entry[F.Id] === -1 ? null : () => values.read(range(entry, F.Id)) };
        pointer = entry[F.Next]!;
      } check(); } catch (error) { throw failure(error); }
    }
    return Object.freeze({ records, close, count });
  } catch (error) { await close().catch(() => {}); throw failure(error); }
}

export async function stageRetainedNotes(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  fingerprint: string,
  options: { readonly selection?: SelectionQuery },
  settings: RetainedPackageContext,
  output: { readonly operation: 'notes.list' | 'notes.get'; readonly json: boolean; readonly maxOutputBytes: number }
): Promise<StagedOutput> {
  const format = { ...output }, notes = await openRetainedNotes(archive, fingerprint, options, settings, format.operation === 'notes.get');
  let staged: StagedOutput | undefined;
  async function* locations() { for await (const note of notes.records()) yield note.location; }
  async function* render(): ByteSource {
    if (format.json) {
      yield* streamJson({ version: 1, operation: format.operation, ok: true, data: format.operation === 'notes.get' && !notes.count ? null : { notes: notes.records() }, affected: 0, warnings: [], errors: [], locations: locations() }); yield* literal('\n');
    } else for await (const note of notes.records()) { yield* literal(`${note.slide}: `); if (note.text) yield* note.text(); yield* literal('\n'); }
  }
  try { staged = await stageRetainedOutput(render(), settings, format.maxOutputBytes); await notes.close(); return staged; }
  catch (error) { await Promise.allSettled([notes.close(), staged?.close()]); throw error; }
}
