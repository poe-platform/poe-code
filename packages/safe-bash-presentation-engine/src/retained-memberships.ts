import { stageRetainedOutput, streamJson, type StagedOutput } from './retained-output.js';
import { openRetainedPresentationIndex } from './retained-inspection.js';
import { decodeSelectionToken, SelectionError } from './selectors.js';
import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource } from './contracts.js';
import { OfficeError } from './errors.js';
import type { MembershipKind } from './memberships.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import { openRetainedRelationshipGraph } from './retained-relationship-graph.js';
import { openRetainedXmlDocument, type RetainedXmlDocument as Document, type RetainedXmlNode as Node } from './retained-xml-document.js';
import { RetainedValues, literal, equal, characters } from './retained-values.js';
import { resourceContext } from './resource-limits.js';
import { dialects } from './validation-schema.js';
import type { XmlRange } from './retained-xml.js';

export interface RetainedMembershipRecord {
  id(): ByteSource;
  name(): ByteSource;
  readonly position: number;
  slides(): AsyncGenerator<number>;
}
const sectionNamespace = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const sectionExtension = '{521415D9-36F7-43E2-AB2F-B90AF26B5E84}';
function fail(code: 'invalid-value' | 'unsupported-edit' | 'invalid-opc', message: string): never { throw new OfficeError(code, message, code === 'invalid-value' ? 'usage' : 'validate-intent'); }
async function* upper(source: ByteSource): ByteSource { let buffer = ''; for await (const character of characters(source)) { buffer += character.toUpperCase(); if (buffer.length >= 2048) { yield* literal(buffer); buffer = ''; } } if (buffer) yield* literal(buffer); }
async function* children(document: Document, node: Node) { for await (const child of document.children(node)) if (child.kind === 'element') yield child; }
async function is(document: Document, node: Node, name: string, namespace: string) { return await equal(document.raw(node.localName), literal(name)) && await equal(document.namespace(node), literal(namespace)); }
async function attr(document: Document, node: Node, name: string, namespace = '') { for await (const value of document.attributes(node)) if (await is(document, value, name, namespace)) return value; return undefined; }
async function only(document: Document, node: Node, name: string, namespace: string) { let found: Node | undefined; for await (const child of children(document, node)) if (await is(document, child, name, namespace)) { if (found) fail('unsupported-edit', 'Ambiguous membership structure.'); found = child; } return found; }
async function locate(document: Document, kind: MembershipKind, p: string) {
  if (kind === 'shows') return only(document, document.root, 'custShowLst', p);
  const extensions = await only(document, document.root, 'extLst', p); if (!extensions) return undefined;
  let extension: Node | undefined;
  for await (const node of children(document, extensions)) { const uri = await attr(document, node, 'uri'); if (uri && await equal(upper(document.text(uri)), literal(sectionExtension))) { if (extension) fail('unsupported-edit', 'Multiple section extensions.'); extension = node; } }
  for await (const node of children(document, extensions)) if (!extension || document.reference(node) !== document.reference(extension)) for await (const child of children(document, node)) if (await equal(document.raw(child.localName), literal('sectionLst'))) fail('unsupported-edit', 'Unsupported section extension identity.');
  if (!extension) return undefined;
  let count = 0; for await (const ignored of children(document, extension)) count++;
  if (!await is(document, extension, 'ext', p) || count !== 1) fail('unsupported-edit', 'Unsupported section extension structure.');
  const list = await only(document, extension, 'sectionLst', sectionNamespace);
  if (!list) fail('unsupported-edit', 'Unsupported section extension namespace.'); return list;
}
/** Ordered records, identity sets and slide references live in caller pages. */
export async function openRetainedMemberships(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  kind: MembershipKind,
  settings: RetainedPackageContext
) {
  if (!['sections', 'shows'].includes(kind)) fail('invalid-value', 'Unknown membership resource.');
  const context = { ...resourceContext(settings), workingStorage: { ...settings.workingStorage } }, working = context.workingStorage, signal = context.signal ?? new AbortController().signal;
  const graph = await openRetainedRelationshipGraph(archive, context), pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, (working.cacheBytes ?? 1024 * 1024) / 16384);
  let document: Document | undefined, closed = false, closing: Promise<void> | undefined, first = 0, last = 0;
  const close = () => { closed = true; return closing ??= (async () => { const results = await Promise.allSettled([graph.close(), document?.close(), pages.close()]); for (const result of results) if (result.status === 'rejected') throw result.reason; })(); };
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Memberships are closed.', 'index'); if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'index'); };
  const values = new RetainedValues(pages, check, signal);
  async function row(pointer: number, count = 7) { check(); const bytes = await pages.read(pointer, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return Array.from({ length: count }, (_, n) => view.getFloat64(n * 8, true)); }
  async function write(pointer: number, data: number[]) { check(); const bytes = new Uint8Array(data.length * 8), view = new DataView(bytes.buffer); data.forEach((value, n) => view.setFloat64(n * 8, value, true)); await pages.write(pointer, bytes); }
  const range = (data: number[], n: number): XmlRange => ({ start: data[n]!, length: data[n + 1]! });
  async function* slides(pointer: number): AsyncGenerator<number> { check(); while (pointer) { const data = await row(pointer, 2); pointer = data[0]!; yield data[1]!; } check(); }
  try {
    let main: string | undefined;
    for await (const edge of graph.outgoing('/')) { let match = false; for (const dialect of dialects) if (await equal(edge.type(), literal(`${dialect.r}/officeDocument`))) match = true;
      if (match) { if (edge.targetPart) { const decoder = new TextDecoder(); main = ''; for await (const bytes of edge.targetPart()) main += decoder.decode(bytes, { stream: true }); main += decoder.decode(); } break; }
    }
    if (!main) fail('invalid-opc', 'Presentation relationship is missing.');
    document = await openRetainedXmlDocument(archive.read(main), context); const doc = document;
    let d: (typeof dialects)[number] | undefined; for (const dialect of dialects) if (await equal(doc.namespace(doc.root), literal(dialect.p))) d = dialect;
    if (!d) fail('unsupported-edit', 'Unsupported presentation namespace.');
    const slideList = await only(doc, doc.root, 'sldIdLst', d.p); let slidePosition = 0;
    if (slideList) for await (const slide of children(doc, slideList)) if (await is(doc, slide, 'sldId', d.p)) {
      slidePosition++;
      for (const [scope, namespace] of [['id', ''], ['rel', d.r]]) { const id = await attr(doc, slide, 'id', namespace); if (id) { const key = await values.store(doc.text(id)), pointer = pages.allocate(8); await write(pointer, [slidePosition]); await values.insert(scope!, key, { start: pointer, length: 8 }); } }
    }
    const list = await locate(doc, kind, d.p), namespace = kind === 'sections' ? sectionNamespace : d.p, itemName = kind === 'sections' ? 'section' : 'custShow';
    if (list) for await (const node of children(doc, list)) if (!await is(doc, node, itemName, namespace)) fail('unsupported-edit', 'Unsupported membership list content.');
    let position = 0;
    if (list) for await (const node of children(doc, list)) {
      const id = await attr(doc, node, 'id'), name = await attr(doc, node, 'name');
      if (!id || !name || await equal(doc.text(id), literal(''))) fail('invalid-opc', 'Membership identities and names must be present.');
      let identity = '';
      if (kind === 'shows') { let number = 0; for await (const character of characters(doc.text(id))) { if (character < '0' || character > '9') fail('invalid-opc', 'Invalid custom show identity.'); number = number * 10 + (character.charCodeAt(0) - 48); if (number > 4294967295) fail('invalid-opc', 'Invalid custom show identity.'); } identity = String(number); }
      else { for await (const character of characters(doc.text(id))) { identity += character; if (identity.length > 38) fail('invalid-opc', 'Invalid section identity.'); }
        const segments = identity.slice(1, -1).split('-'); if (!identity.startsWith('{') || !identity.endsWith('}') || segments.length !== 5 || segments.some((segment, n) => segment.length !== [8, 4, 4, 4, 12][n] || [...segment].some(character => !'0123456789ABCDEF'.includes(character.toUpperCase())))) fail('invalid-opc', 'Invalid section identity.'); identity = identity.toUpperCase();
      }
      const identityRange = await values.store(literal(identity)); if (!await values.insert('seen', identityRange, identityRange)) fail('invalid-opc', 'Membership identities must be unique.');
      if (kind === 'sections') {
        for await (const value of doc.attributes(node)) if (!await is(doc, value, 'id', '') && !await is(doc, value, 'name', '')) fail('unsupported-edit', 'Unsupported section extension content.');
        for await (const value of children(doc, node)) if (!await is(doc, value, 'sldIdLst', sectionNamespace)) fail('unsupported-edit', 'Unsupported section extension content.');
      }
      const members = await only(doc, node, kind === 'sections' ? 'sldIdLst' : 'sldLst', namespace); if (!members) fail('unsupported-edit', 'Missing membership slide list.');
      if (kind === 'sections') for await (const ignored of doc.attributes(members)) fail('unsupported-edit', 'Unsupported section list attributes.');
      let head = 0, tail = 0;
      for await (const member of children(doc, members)) {
        if (!await is(doc, member, kind === 'sections' ? 'sldId' : 'sld', namespace)) fail('unsupported-edit', 'Unsupported membership slide entry.');
        if (kind === 'sections') {
          for await (const ignored of children(doc, member)) fail('unsupported-edit', 'Unsupported section member extension.');
          for await (const value of doc.attributes(member)) if (!await is(doc, value, 'id', '')) fail('unsupported-edit', 'Unsupported section member extension.');
        }
        const reference = await attr(doc, member, 'id', kind === 'sections' ? '' : d.r), found = await values.find(kind === 'sections' ? 'id' : 'rel', () => reference ? doc.text(reference) : literal(''));
        if (!found) fail('invalid-opc', 'Membership references an absent slide.');
        const memberPosition = (await row(found.start, 1))[0]!, pointer = pages.allocate(16); await write(pointer, [0, memberPosition]); if (tail) await write(tail, [pointer]); else head = pointer; tail = pointer;
      }
      if (kind === 'sections') { let previous = 0; for await (const memberPosition of slides(head)) { const key = await values.store(literal(String(memberPosition))); if (!await values.insert('section-slides', key, key) || previous && memberPosition !== previous + 1) fail('unsupported-edit', 'Existing sections must be contiguous and nonoverlapping.'); previous = memberPosition; } }
      const idValue = await values.store(doc.text(id)), nameValue = await values.store(doc.text(name)), pointer = pages.allocate(56); await write(pointer, [0, idValue.start, idValue.length, nameValue.start, nameValue.length, head, ++position]);
      if (last) await write(last, [pointer]); else first = pointer; last = pointer;
    }
    await doc.close(); await graph.close();
    return Object.freeze({ owner: main, close, async *records(): AsyncGenerator<RetainedMembershipRecord> { check(); for (let pointer = first; pointer;) { const data = await row(pointer); pointer = data[0]!; yield { id: () => values.read(range(data, 1)), name: () => values.read(range(data, 3)), position: data[6]!, slides: () => slides(data[5]!) }; } check(); } });
  } catch (error) { await close().catch(() => {}); throw error instanceof OfficeError ? error : new OfficeError(signal.aborted ? 'cancelled' : 'io-failure', 'Membership storage operation failed.', 'index'); }
}

/** Stage complete command responses before retiring metadata or exposing a sink. */
export async function stageRetainedMemberships(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  fingerprint: string,
  kind: MembershipKind,
  selection: { readonly token?: string; readonly slide?: number },
  settings: RetainedPackageContext,
  output: { readonly operation: 'sections.list' | 'sections.get' | 'shows.list' | 'shows.get'; readonly json: boolean; readonly maxOutputBytes: number }
): Promise<StagedOutput> {
  const query = { ...selection }, format = { ...output };
  if (!['sections', 'shows'].includes(kind) || ![`${kind}.list`, `${kind}.get`].includes(format.operation)) fail('invalid-value', 'Unknown membership operation.');
  const index = await openRetainedPresentationIndex(archive, fingerprint, settings);
  let view: Awaited<ReturnType<typeof openRetainedMemberships>> | undefined, staged: StagedOutput | undefined;
  try {
    let owner = ''; for await (const record of index.records.records('part')) if (record.scope === 'presentation') { owner = record.part; break; }
    view = await openRetainedMemberships(archive, kind, settings);
    const token = query.token ? decodeSelectionToken(query.token) : undefined;
    if (token) { if (token.fingerprint !== fingerprint) throw new SelectionError('stale-selection'); if (token.scope !== 'presentation' || token.owner !== owner || !token.objectId?.startsWith(`${kind}:`)) throw new SelectionError('invalid-selection'); }
    async function* selected() { for await (const record of view!.records()) {
      if (token) { if (!await equal(record.id(), literal(token.objectId!.slice(kind.length + 1)))) continue; }
      else if (query.slide !== undefined) { let present = false; for await (const position of record.slides()) if (position === query.slide) { present = true; break; } if (!present) continue; }
      yield record;
    } }
    if (format.operation.endsWith('.get')) { let count = 0; for await (const ignored of selected()) count++; if (!count) throw new SelectionError('missing-selection'); if (count > 1) throw new SelectionError('ambiguous-selection'); }
    const location = (record: RetainedMembershipRecord) => ({ fingerprint, scope: 'presentation', owner, objectId: async function* () { yield* literal(`${kind}:`); yield* record.id(); }, coordinateSystem: 'identity' });
    async function* records() { for await (const record of selected()) { const where = location(record); yield { id: record.id, name: record.name, position: record.position, slides: record.slides(), location: where, token: () => streamJson(where) }; } }
    async function* locations() { for await (const record of selected()) yield location(record); }
    async function* render(): ByteSource {
      if (format.json) { yield* streamJson({ version: 1, operation: format.operation, ok: true, data: { fingerprint, records: records() }, warnings: [], errors: [], affected: 0, locations: locations() }); yield* literal('\n'); }
      else { let first = true; for await (const record of selected()) { if (!first) yield* literal('\n'); first = false; yield* literal(`${record.position} `); yield* streamJson(record.name); yield* literal(' ['); let member = false; for await (const position of record.slides()) { if (member) yield* literal(', '); member = true; yield* literal(String(position)); } yield* literal(']'); } yield* literal('\n'); }
    }
    staged = await stageRetainedOutput(render(), settings, format.maxOutputBytes); await view.close(); await index.close(); return staged;
  } catch (error) { await Promise.allSettled([view?.close(), index.close(), staged?.close()]); throw error; }
}
