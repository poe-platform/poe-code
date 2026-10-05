import { readRetainedFrameFormatting } from './retained-frame-formatting.js';
import { stageRetainedOutput, streamJson, type StagedOutput } from './retained-output.js';
import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource, Location } from './contracts.js';
import { OfficeError } from './errors.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import { openRetainedPresentationIndex } from './retained-inspection.js';
import { openRetainedXmlDocument, type RetainedXmlNode } from './retained-xml-document.js';
import { openRetainedCompatibility } from './retained-compatibility.js';
import { equationOpaqueElements } from './equations-compatibility.js';
import { RetainedValues, literal, equal, folded, characters } from './retained-values.js';
import type { XmlRange } from './retained-xml.js';
import { dialects } from './validation-schema.js';
import { resourceContext } from './resource-limits.js';
import { fieldTypeKinds, type FieldKind } from './fields.js';
import { SelectionError } from './selectors.js';
import { validateTextReadingOptions, type ReadPresentationTextOptions, type TextSegment } from './text-reading.js';

export type RetainedTextInline =
  | { readonly kind: 'run'; text(): ByteSource }
  | { readonly kind: 'break'; readonly text: '\v' }
  | { readonly kind: 'field'; cachedText(): ByteSource; readonly fieldId: (() => ByteSource) | null; readonly fieldType: (() => ByteSource) | null };
export interface RetainedTextParagraph {
  readonly index: number;
  readonly coordinateSystem: 'zero-based';
  text(): ByteSource;
  readonly inlines: AsyncIterable<RetainedTextInline>;
}
export interface RetainedTextSegment {
  readonly location: Location;
  text(): ByteSource;
  readonly paragraphs: AsyncIterable<RetainedTextParagraph>;
  readonly cell?: TextSegment['cell'];
}
export interface RetainedField {
  readonly location: Location;
  readonly paragraph: number;
  readonly inline: number;
  readonly coordinateSystem: 'zero-based';
  readonly kind: FieldKind | null;
  readonly fieldId: (() => ByteSource) | null;
  readonly fieldType: (() => ByteSource) | null;
  cachedText(): ByteSource;
}
export interface RetainedTextFrame {
  readonly location: Location;
  readonly formatting: Awaited<ReturnType<typeof readRetainedFrameFormatting>>;
}
export interface RetainedPresentationText {
  readonly frameCount: number;
  frames(): AsyncGenerator<RetainedTextFrame>;
  readonly fieldCount: number;
  fields(): AsyncGenerator<RetainedField>;
  text(): ByteSource;
  segments(): AsyncGenerator<RetainedTextSegment>;
  close(): Promise<void>;
}
// Fixed-width linked rows: no body, paragraph, inline, owner or traversal array
// grows with the document. Text/attribute scalars live in caller-backed pages.
enum B { Next, Owner, OwnerLength, Id, Paragraphs, LastParagraph, Row, Column, Format, FormatLength, Count }
enum P { Next, Inlines, LastInline, Index, Count }
enum I { Next, Kind, Text, TextLength, FieldId, FieldIdLength, FieldType, FieldTypeLength, FieldIndex, FieldText, FieldTextLength, Count }

export async function openRetainedText(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  fingerprint: string,
  options: ReadPresentationTextOptions,
  settings: RetainedPackageContext,
  readingMode: 'text' | 'frames' = 'text'
): Promise<RetainedPresentationText> {
  validateTextReadingOptions(options);
  const selection = options.select === undefined ? undefined : { ...options.select, ...(options.select.position ? { position: { ...options.select.position } } : {}) };
  const scope = options.scope ?? 'slides', shape = options.shape;
  const context = resourceContext(settings), working = { ...settings.workingStorage }, signal = context.signal ?? new AbortController().signal;
  const index = await openRetainedPresentationIndex(archive, fingerprint, { ...context, workingStorage: working });
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, (working.cacheBytes ?? 1024 * 1024) / 16384);
  const traversal = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, (working.cacheBytes ?? 1024 * 1024) / 16384);
  let closed = false, closing: Promise<void> | undefined, firstBody = 0, lastBody = 0, firstOwner = 0, lastOwner = 0, fieldCount = 0, frameCount = 0;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Text is closed.', 'select'); if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'select'); };
  const failure = (error: unknown) => error instanceof OfficeError ? error : new OfficeError(signal.aborted ? 'cancelled' : 'io-failure', 'Text storage operation failed.', 'select');
  const close = () => { closed = true; return closing ??= (async () => { const outcomes = await Promise.allSettled([index.close(), traversal.close(), pages.close()]); for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason; })(); };
  const values = new RetainedValues(pages, check, signal);
  const range = (row: number[], field: number): XmlRange => ({ start: row[field]!, length: row[field + 1]! });
  async function row(pointer: number, count: number, storage = pages) { check(); const bytes = await storage.read(pointer, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return Array.from({ length: count }, (_, n) => view.getFloat64(n * 8, true)); }
  async function write(pointer: number, numbers: number[], storage = pages) { check(); const bytes = new Uint8Array(numbers.length * 8), view = new DataView(bytes.buffer); numbers.forEach((number, n) => view.setFloat64(n * 8, number, true)); await storage.write(pointer, bytes); }
  async function* rows(first: number, count: number) { for (let pointer = first; pointer;) { const data = await row(pointer, count); yield data; pointer = data[0]!; } check(); }
  // Only ZIP-admitted names and fixed-schema frame records use this decoder.
  async function name(value: XmlRange) { const decoder = new TextDecoder(); let result = ''; for await (const bytes of values.read(value)) result += decoder.decode(bytes, { stream: true }); return result + decoder.decode(); }
  async function part(value: string) { return (await values.find('parts', () => folded(literal(value))))!; }
  const absent = Symbol('absent-part');
  async function owner(value: string | typeof absent | undefined) {
    if (!value) return;
    if (value === absent) throw new OfficeError('missing-binding', 'Package member is absent.', 'index');
    const key = await values.store(literal(value)); if (!await values.insert('owners', key, key)) return;
    const pointer = pages.allocate(24); await write(pointer, [0, key.start, key.length]); if (lastOwner) await write(lastOwner, [pointer]); else firstOwner = pointer; lastOwner = pointer;
  }
  async function target(owner: string | typeof absent, type: string) {
    if (owner === absent) return undefined;
    let count = 0, found: XmlRange | undefined, missing = false;
    for await (const edge of index.graph.outgoing(owner)) for (const dialect of dialects) if (await equal(edge.type(), literal(`${dialect.r}/${type}`))) {
      if (++count > 1) throw new OfficeError('invalid-opc', 'Ambiguous text scope relationship.', 'select');
      if (edge.targetPart) {
        found = await values.find('parts', () => folded(edge.targetPart!()));
        missing = !found;
      }
    }
    return found ? name(found) : missing ? absent : undefined;
  }
  try {
    for await (const entry of archive.parts()) { const value = await values.store(literal(entry)), key = await values.store(folded(literal(entry))); await values.insert('parts', key, value); }
    let selectedCount = 0, selectedSlides = false;
    if (selection) for await (const item of index.records.select(selection)) {
      selectedCount++;
      if (item.kind === 'slide') { selectedSlides = true; if (['notes-master', 'handout-master'].includes(scope)) throw new SelectionError('invalid-selection'); }
      else if (item.scope !== scope) throw new SelectionError('invalid-selection');
      const key = await values.store(literal(item.kind === 'part' ? item.part : `${item.part}\0${item.id}`)); await values.insert('selected', key, key);
    }
    if (shape !== undefined && selectedCount !== 1) throw new SelectionError('invalid-selection');
    for await (const slide of selection ? index.records.select(selection) : index.records.records('slide')) if (slide.kind === 'slide') {
      const layout = await target(slide.part, 'slideLayout');
      await owner(scope === 'slides' ? slide.part : scope === 'notes' ? await target(slide.part, 'notesSlide') : scope === 'layouts' ? layout : scope === 'masters' && layout ? await target(layout, 'slideMaster') : undefined);
    }
    if (!selection && scope !== 'slides' && scope !== 'notes') for await (const item of index.records.records('part')) if (item.scope === scope) await owner(item.part);
    if (selection) for await (const item of index.records.select(selection)) if (item.kind !== 'slide') await owner(item.part);
    let named: Location | undefined, namedCount = 0; const candidates: Location[] = [];
    for await (const object of index.records.records('object')) {
      const ownerPart = await part(object.part), key = await values.store(literal(object.id)); await values.insert(`objects:${ownerPart.start}`, key, key);
      if (shape !== undefined && object.scope === scope && await values.find('owners', () => literal(object.part)) && await equal(object.name(), literal(shape))) {
        named = object.location; namedCount++; if (candidates.length < 20) candidates.push(object.location);
      }
    }
    if (shape !== undefined && namedCount !== 1) throw new SelectionError(namedCount ? 'ambiguous-selection' : 'missing-selection', candidates);
    for await (const ownerRow of rows(firstOwner, 3)) {
      const ownerName = await name(range(ownerRow, 1)), ownerPart = await part(ownerName);
      const document = await openRetainedXmlDocument(archive.read(ownerName), { ...context, workingStorage: working });
      let view: Awaited<ReturnType<typeof openRetainedCompatibility>> | undefined, failed = false;
      try {
        async function is(node: RetainedXmlNode, local: string, namespaces = dialects.map(d => d.p)) {
          if (node.kind !== 'element' && node.kind !== 'attribute' || !await equal(document.raw(node.localName), literal(local))) return false;
          for (const uri of namespaces) if (await equal(document.namespace(node), literal(uri))) return true; return false;
        }
        const drawing = dialects.map(d => d.a);
        async function attribute(node: RetainedXmlNode, local: string) { for await (const attr of document.attributes(node)) if (await is(attr, local, [''])) return attr; return undefined; }
        async function tableData(node: RetainedXmlNode) {
          if (!await is(node, 'graphicData', drawing)) return false;
          const uri = await attribute(node, 'uri'); if (uri) for (const ns of drawing) if (await equal(document.text(uri), literal(`${ns}/table`))) return true;
          for await (const child of document.children(node)) if (await is(child, 'tbl', drawing)) return true; return false;
        }
        view = await openRetainedCompatibility(document, dialects.flatMap(d => [d.p, d.a, d.r]), { ...context, workingStorage: working }, [
          ...equationOpaqueElements, ...dialects.flatMap(d => [{ namespace: d.p, localName: 'ext' }, { namespace: d.a, localName: 'ext' }, { namespace: d.a, localName: 'graphicData' }])
        ], tableData);
        async function* children(node: RetainedXmlNode, local: string, namespaces = dialects.map(d => d.p)) { for await (const child of view!.children(node)) if (await is(child, local, namespaces)) yield child; }
        async function push(source: AsyncIterable<RetainedXmlNode>, inherited: number, previous: number) {
          let first = 0, last = 0;
          for await (const node of source) { const pointer = traversal.allocate(24); await write(pointer, [0, document.reference(node), inherited], traversal); if (last) await write(last, [pointer], traversal); else first = pointer; last = pointer; }
          if (last) await write(last, [previous], traversal); return first || previous;
        }
        async function* rawCharacters(node: RetainedXmlNode): ByteSource {
          let top = await push(document.children(node), 0, 0);
          while (top) {
            const entry = await row(top, 3, traversal); top = entry[0]!; const child = await document.node(entry[1]!);
            if (child.kind === 'text' || child.kind === 'cdata') yield* document.text(child);
            else if (child.kind === 'element') top = await push(document.children(child), 0, top);
          }
        }
        async function body(node: RetainedXmlNode, id: number, cellRow = -1, cellColumn = -1) {
          if (readingMode === 'frames' && cellRow >= 0) return;
          const formatting = readingMode === 'frames' ? await values.store(literal(JSON.stringify(await readRetainedFrameFormatting(document, node), (_key, value: unknown) => Object.is(value, -0) ? '-0' : value))) : { start: 0, length: 0 };
          if (readingMode === 'frames') frameCount++;
          const bodyPointer = pages.allocate(B.Count * 8), bodyRow = [0, ownerPart.start, ownerPart.length, id, 0, 0, cellRow, cellColumn, formatting.start, formatting.length]; let paragraphIndex = 0;
          for await (const paragraph of children(node, 'p', drawing)) {
            if (readingMode === 'frames') break;
            const paragraphPointer = pages.allocate(P.Count * 8), paragraphRow = [0, 0, 0, paragraphIndex++]; let fieldInline = 0;
            for await (const inline of view!.children(paragraph)) {
              const kind = await is(inline, 'br', drawing) ? 1 : await is(inline, 'r', drawing) ? 0 : await is(inline, 'fld', drawing) ? 2 : -1;
              if (kind < 0) continue;
              async function* text(): ByteSource { if (kind === 1) yield* literal('\v'); else for await (const node of children(inline, 't', drawing)) yield* rawCharacters(node); }
              const value = await values.store(text()), fieldId = kind === 2 ? await attribute(inline, 'id') : undefined, fieldType = kind === 2 ? await attribute(inline, 'type') : undefined;
              const identifier = fieldId ? await values.store(document.text(fieldId)) : { start: -1, length: 0 }, type = fieldType ? await values.store(document.text(fieldType)) : { start: -1, length: 0 };
              const matchingNamespace = await equal(document.namespace(inline), document.namespace(paragraph));
              const fieldIndex = matchingNamespace ? fieldInline++ : -1;
              // Field inspection reads direct original t children, whereas text
              // extraction reads projected compatibility children. Keep both.
              async function* fieldText(): ByteSource {
                for await (const node of document.children(inline)) if (await is(node, 't', drawing) && await equal(document.namespace(node), document.namespace(inline))) yield* rawCharacters(node);
              }
              const cached = kind === 2 && fieldIndex >= 0 ? await values.store(fieldText()) : { start: 0, length: 0 };
              if (kind === 2 && fieldIndex >= 0) fieldCount++;
              const pointer = pages.allocate(I.Count * 8); await write(pointer, [0, kind, value.start, value.length, identifier.start, identifier.length, type.start, type.length, fieldIndex, cached.start, cached.length]);
              if (paragraphRow[P.LastInline]) await write(paragraphRow[P.LastInline]!, [pointer]); else paragraphRow[P.Inlines] = pointer; paragraphRow[P.LastInline] = pointer;
            }
            await write(paragraphPointer, paragraphRow);
            if (bodyRow[B.LastParagraph]) await write(bodyRow[B.LastParagraph]!, [paragraphPointer]); else bodyRow[B.Paragraphs] = paragraphPointer; bodyRow[B.LastParagraph] = paragraphPointer;
          }
          await write(bodyPointer, bodyRow); if (lastBody) await write(lastBody, [bodyPointer]); else firstBody = bodyPointer; lastBody = bodyPointer;
        }
        for await (const common of children(document.root, 'cSld')) for await (const tree of children(common, 'spTree')) {
          let top = await push(view.children(tree), 0, 0);
          while (top) {
            const entry = await row(top, 3, traversal); top = entry[0]!; const node = await document.node(entry[1]!);
            let shapeNode = false; for (const local of ['sp', 'cxnSp', 'graphicFrame', 'grpSp', 'pic']) if (await is(node, local)) shapeNode = true;
            if (!shapeNode) continue;
            let identity: RetainedXmlNode | undefined;
            for await (const nv of view.children(node)) { let nonVisual = false; for (const local of ['nvSpPr', 'nvCxnSpPr', 'nvGraphicFramePr', 'nvGrpSpPr', 'nvPicPr']) if (await is(nv, local)) nonVisual = true; if (nonVisual) { for await (const child of children(nv, 'cNvPr')) { identity = await attribute(child, 'id'); break; } break; } }
            let id = 0;
            if (identity) for await (const character of characters(document.text(identity))) { if (character >= '0' && character <= '9') id = id * 10 + Number(character); }
            if (!identity || !await values.find(`objects:${ownerPart.start}`, () => literal(String(id)))) throw new OfficeError('invalid-opc', 'Missing text object identity.', 'select');
            const included = Boolean(entry[2]) || (named ? named.owner === ownerName && named.objectId === String(id) : !selection || selectedSlides || Boolean(await values.find('selected', () => literal(ownerName))) || Boolean(await values.find('selected', () => literal(`${ownerName}\0${id}`))));
            if (await is(node, 'grpSp')) { top = await push(view.children(node), Number(included), top); continue; }
            if (!included) continue;
            for await (const textBody of children(node, 'txBody')) await body(textBody, id);
            for await (const graphic of children(node, 'graphic', drawing)) for await (const data of children(graphic, 'graphicData', drawing)) if (await tableData(data)) {
              for await (const table of children(data, 'tbl', drawing)) {
                let rowIndex = 0;
                for await (const rowNode of children(table, 'tr', drawing)) {
                  let column = 0; for await (const cell of children(rowNode, 'tc', drawing)) { for await (const textBody of children(cell, 'txBody', drawing)) await body(textBody, id, rowIndex, column); column++; } rowIndex++;
                }
              }
            }
          }
        }
      } catch (error) { failed = true; throw error; }
      finally { const outcomes = await Promise.allSettled([view?.close(), document.close()]); if (!failed) for (const outcome of outcomes) if (outcome.status === 'rejected') await Promise.reject(outcome.reason); }
    }
    await index.close(); await traversal.close(); check();
    async function* inlineText(first: number): ByteSource { for await (const inline of rows(first, I.Count)) yield* values.read(range(inline, I.Text)); }
    async function* bodyText(first: number): ByteSource { let separator = false; for await (const paragraph of rows(first, P.Count)) { if (separator) yield* literal('\n'); separator = true; yield* inlineText(paragraph[P.Inlines]!); } }
    async function* inlines(first: number): AsyncGenerator<RetainedTextInline> {
      for await (const inline of rows(first, I.Count)) {
        if (inline[I.Kind] === 1) yield { kind: 'break', text: '\v' };
        else if (inline[I.Kind] === 0) yield { kind: 'run', text: () => values.read(range(inline, I.Text)) };
        else yield { kind: 'field', cachedText: () => values.read(range(inline, I.Text)), fieldId: inline[I.FieldId] === -1 ? null : () => values.read(range(inline, I.FieldId)), fieldType: inline[I.FieldType] === -1 ? null : () => values.read(range(inline, I.FieldType)) };
      }
    }
    async function* paragraphs(first: number): AsyncGenerator<RetainedTextParagraph> { for await (const paragraph of rows(first, P.Count)) yield { index: paragraph[P.Index]!, coordinateSystem: 'zero-based', text: () => inlineText(paragraph[P.Inlines]!), inlines: inlines(paragraph[P.Inlines]!) }; }
    async function* segments(): AsyncGenerator<RetainedTextSegment> {
      try { for await (const body of rows(firstBody, B.Count)) yield { location: { fingerprint, scope, owner: await name(range(body, B.Owner)), objectId: String(body[B.Id]), coordinateSystem: 'identity' }, text: () => bodyText(body[B.Paragraphs]!), paragraphs: paragraphs(body[B.Paragraphs]!), ...(body[B.Row]! < 0 ? {} : { cell: { coordinateSystem: 'zero-based', row: body[B.Row]!, column: body[B.Column]! } }) }; }
      catch (error) { throw failure(error); }
    }
    async function* frames(): AsyncGenerator<RetainedTextFrame> {
      try { for await (const body of rows(firstBody, B.Count)) if (body[B.Format]) yield {
        location: { fingerprint, scope, owner: await name(range(body, B.Owner)), objectId: String(body[B.Id]), coordinateSystem: 'identity' },
        // Fixed-schema scalars; the numeric -0 marker cannot collide with valid enums.
        formatting: JSON.parse(await name(range(body, B.Format)), (_key, value: unknown) => value === '-0' ? -0 : value) as RetainedTextFrame['formatting']
      }; } catch (error) { throw failure(error); }
    }
    async function* fields(): AsyncGenerator<RetainedField> {
      try {
        for await (const body of rows(firstBody, B.Count)) {
          const location: Location = { fingerprint, scope, owner: await name(range(body, B.Owner)), objectId: String(body[B.Id]), coordinateSystem: 'identity' };
          for await (const paragraph of rows(body[B.Paragraphs]!, P.Count)) for await (const inline of rows(paragraph[P.Inlines]!, I.Count)) if (inline[I.Kind] === 2 && inline[I.FieldIndex]! >= 0) {
            const fieldType = inline[I.FieldType] === -1 ? null : () => values.read(range(inline, I.FieldType));
            let kind: FieldKind | null = null;
            if (fieldType) for (const [type, candidate] of Object.entries(fieldTypeKinds)) if (await equal(fieldType(), literal(type))) { kind = candidate; break; }
            yield { location, paragraph: paragraph[P.Index]!, inline: inline[I.FieldIndex]!, coordinateSystem: 'zero-based', kind,
              fieldId: inline[I.FieldId] === -1 ? null : () => values.read(range(inline, I.FieldId)), fieldType, cachedText: () => values.read(range(inline, I.FieldText)) };
          }
        }
      } catch (error) { throw failure(error); }
    }
    return Object.freeze({ close, segments, fields, fieldCount, frames, frameCount, async *text() { let separator = false; for await (const segment of segments()) { if (separator) yield* literal('\n'); separator = true; yield* segment.text(); } } });
  } catch (error) { await close().catch(() => {}); throw failure(error); }
}

/** Stages both CLI formats after complete text admission. */
export async function stageRetainedText(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  fingerprint: string,
  options: ReadPresentationTextOptions,
  settings: RetainedPackageContext,
  output: { readonly json: boolean; readonly maxOutputBytes: number; readonly operation?: 'text.get' | 'fields.list' | 'fields.get' | 'text.frames.list' | 'text.frames.get' }
): Promise<StagedOutput> {
  const format = { ...output }, operation = format.operation ?? 'text.get';
  if (!['text.get', 'fields.list', 'fields.get', 'text.frames.list', 'text.frames.get'].includes(operation)) throw new OfficeError('invalid-value', 'Invalid retained text operation.', 'usage');
  const frames = operation.startsWith('text.frames.'), fields = operation.startsWith('fields.');
  const text = await openRetainedText(archive, fingerprint, options, settings, frames ? 'frames' : 'text').catch(error => {
    if (frames && error instanceof SelectionError && error.code === 'missing-selection') return undefined;
    throw error;
  });
  async function* frameRecords() { if (text) yield* text.frames(); }
  let staged: StagedOutput | undefined;
  async function* locations() { for await (const item of frames ? frameRecords() : fields ? text!.fields() : text!.segments()) yield item.location; }
  async function* items() {
    for await (const field of text!.fields()) yield {
      location: field.location, kind: field.kind ?? 'unknown', name: field.fieldId,
      fields: [
        { name: 'fieldType', value: field.fieldType === null ? { type: 'null', value: null } : { type: 'string', value: field.fieldType } },
        { name: 'cachedText', value: { type: 'string', value: field.cachedText } },
        { name: 'paragraph', value: { type: 'number', value: field.paragraph } },
        { name: 'inline', value: { type: 'number', value: field.inline } },
        { name: 'coordinateSystem', value: { type: 'string', value: 'zero-based' } }
      ]
    };
  }
  async function* render(): ByteSource {
    if (format.json) {
      yield* streamJson({ version: 1, operation, ok: true, data: frames ? { frames: frameRecords() } : fields ? { items: items() } : { text: text!.text, order: 'structural', segments: text!.segments() }, warnings: [], errors: [], affected: 0, locations: locations() }); yield* literal('\n');
    } else if (frames) yield* streamJson(frameRecords());
    else if (fields) yield* streamJson(text!.fields());
    else yield* text!.text();
  }
  try {
    if (operation === 'fields.get' && text!.fieldCount !== 1) throw new SelectionError(text!.fieldCount ? 'ambiguous-selection' : 'missing-selection');
    if (operation === 'text.frames.get' && text?.frameCount !== 1) throw new SelectionError(text?.frameCount ? 'ambiguous-selection' : 'missing-selection');
    staged = await stageRetainedOutput(render(), settings, format.maxOutputBytes); await text?.close(); return staged;
  }
  catch (error) { await Promise.allSettled([text?.close(), staged?.close()]); throw error; }
}
