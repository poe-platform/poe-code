import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource, Location, Scope } from './contracts.js';
import { OfficeError } from './errors.js';
import { equationOpaqueElements } from './equations-compatibility.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import { openRetainedRelationshipGraph } from './retained-relationship-graph.js';
import { openRetainedXmlDocument, type RetainedXmlDocument, type RetainedXmlNode } from './retained-xml-document.js';
import { openRetainedCompatibility, type RetainedCompatibilityView } from './retained-compatibility.js';
import { RetainedValues, literal, equal, characters } from './retained-values.js';
import type { XmlRange } from './retained-xml.js';
import { resourceContext } from './resource-limits.js';
import { dialects } from './validation-schema.js';
import { prepareSelectionQuery, SelectionError, type SelectionQuery, type SelectionRecord } from './selectors.js';

export interface RetainedSelectionRecord extends Omit<SelectionRecord, 'name'> {
  /** Replayable value, valid until the record index is closed. */
  name(): ByteSource;
}
export interface RetainedSelectionRecords {
  readonly fingerprint: string;
  readonly main: string;
  records(kind: SelectionRecord['kind']): AsyncGenerator<RetainedSelectionRecord>;
  select(query: SelectionQuery): AsyncGenerator<RetainedSelectionRecord>;
  close(): Promise<void>;
}
const scopes: readonly Scope[] = ['slides', 'notes', 'layouts', 'masters', 'notes-master', 'handout-master', 'presentation', 'shared'];
const kinds = ['slide', 'part', 'object'] as const;
const drawingKinds = ['sp', 'cxnSp', 'graphicFrame', 'grpSp', 'pic'];
const scopeTypes = ['notesSlide', 'slideLayout', 'slideMaster', 'notesMaster', 'handoutMaster'];
enum F { Next, Id, Name, NameLength, Part, PartLength, Scope, Position, Owner, OwnerLength, Type, Count }
function invalid(message: string): never { throw new OfficeError('invalid-opc', message, 'index'); }
async function numeric(source: ByteSource, minimum: number, maximum: number) {
  let value = 0, started = false, digits = false, trailing = false;
  for await (const character of characters(source)) {
    if (!character.trim()) { if (started) trailing = true; continue; }
    if (trailing) invalid('Invalid numeric identity.');
    if (!started && character === '+') { started = true; continue; }
    started = true;
    if (character < '0' || character > '9') invalid('Invalid numeric identity.');
    value = value * 10 + Number(character); digits = true;
    if (!Number.isSafeInteger(value) || value > maximum) invalid('Invalid numeric identity.');
  }
  if (!digits || value < minimum) invalid('Invalid numeric identity.');
  return value;
}

/** Record admission only. Inventory/style admission is a separate consumer;
 * this index never silently substitutes for the complete presentation inventory. */
export async function openRetainedSelectionRecords(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  fingerprint: string,
  settings: RetainedPackageContext
): Promise<RetainedSelectionRecords> {
  if (typeof fingerprint !== 'string' || fingerprint.length !== 64 || [...fingerprint].some(character => !'0123456789abcdef'.includes(character)))
    throw new OfficeError('invalid-value', 'Expected a package fingerprint.', 'usage');
  const context = resourceContext(settings), working = { ...settings.workingStorage }, cacheBytes = working.cacheBytes ?? 1024 * 1024;
  if (!working.fs || !working.directory?.startsWith('/') || !Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384)
    throw new OfficeError('invalid-value', 'Explicit selection storage and a valid cache budget are required.', 'usage');
  const signal = context.signal ?? new AbortController().signal;
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, cacheBytes / 16384);
  let closed = false, closing: Promise<void> | undefined;
  const first = [0, 0, 0], last = [0, 0, 0];
  const check = () => {
    if (closed) throw new OfficeError('invalid-handle', 'Selection records are closed.', 'index');
    if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'index');
  };
  const failure = (error: unknown) => error instanceof OfficeError ? error : new OfficeError(signal.aborted ? 'cancelled' : 'io-failure', 'Selection storage operation failed.', 'index');
  const close = () => { closed = true; return closing ??= pages.close(); };
  const values = new RetainedValues(pages, check, signal);
  const range = (data: number[], field: F): XmlRange => ({ start: data[field]!, length: data[field + 1]! });
  async function* readName(value: XmlRange): ByteSource { try { yield* values.read(value); } catch (error) { throw failure(error); } }
  async function row(pointer: number, count = F.Count): Promise<number[]> {
    check(); const bytes = await pages.read(pointer, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length: count }, (_, n) => view.getFloat64(n * 8, true));
  }
  async function write(pointer: number, data: number[]) {
    check(); const bytes = new Uint8Array(data.length * 8), view = new DataView(bytes.buffer);
    data.forEach((value, n) => view.setFloat64(n * 8, value, true)); await pages.write(pointer, bytes);
  }
  // Only admitted ZIP names use this decoder. Display names and XML IDs stream.
  async function partName(value: XmlRange) {
    const decoder = new TextDecoder(); let result = '';
    for await (const bytes of values.read(value)) result += decoder.decode(bytes, { stream: true });
    return result + decoder.decode();
  }
  async function addScope(key: XmlRange, scope: number) {
    const previous = await values.find('scopes', () => values.read(key));
    if (previous && previous.start !== scope) invalid('Conflicting drawing owner scopes.');
    if (!previous) await values.insert('scopes', key, { start: scope, length: 0 });
  }
  async function scopeFor(part: string) { return (await values.find('scopes', () => literal(part)))?.start ?? scopes.indexOf('shared'); }
  async function add(kind: number, id: number, name: ByteSource, part: XmlRange, scope: number, position: number, owner: XmlRange, type = -1) {
    const label = await values.store(name), pointer = pages.allocate(F.Count * 8);
    await write(pointer, [0, id, label.start, label.length, part.start, part.length, scope, position, owner.start, owner.length, type]);
    if (last[kind]) await write(last[kind]!, [pointer]); else first[kind] = pointer; last[kind] = pointer;
    return pointer;
  }
  async function* rows(kind: number) {
    check(); for (let pointer = first[kind]!; pointer;) { const data = await row(pointer); yield data; pointer = data[F.Next]!; }
  }
  let graph: Awaited<ReturnType<typeof openRetainedRelationshipGraph>> | undefined;
  let document: RetainedXmlDocument | undefined, projection: RetainedCompatibilityView | undefined;
  async function retireDocument() {
    const owned = [projection, document]; projection = undefined; document = undefined;
    const outcomes = await Promise.allSettled(owned.map(value => value?.close()));
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
  }
  async function open(part: string) {
    await retireDocument();
    const doc = document = await openRetainedXmlDocument(archive.read(part), { ...context, workingStorage: working });
    const view = projection = await openRetainedCompatibility(doc, dialects.flatMap(d => [d.p, d.a, d.r]), { ...context, workingStorage: working }, [
      ...equationOpaqueElements, ...dialects.flatMap(d => [{ namespace: d.p, localName: 'ext' }, { namespace: d.a, localName: 'ext' }, { namespace: d.a, localName: 'graphicData' }])
    ]);
    async function named(node: RetainedXmlNode, names: readonly string[], namespaces = dialects.map(d => d.p)) {
      let namespace = false; for (const value of namespaces) if (await equal(doc.namespace(node), literal(value))) namespace = true;
      if (!namespace) return false;
      for (const name of names) if (await equal(doc.raw(node.localName), literal(name))) return true;
      return false;
    }
    async function attribute(node: RetainedXmlNode, name: string, namespaces = ['']) {
      for await (const item of doc.attributes(node)) if (await named(item, [name], namespaces)) return () => doc.text(item);
      return () => literal('');
    }
    async function child(node: RetainedXmlNode, names: readonly string[]) {
      for await (const item of view.children(node)) if (await named(item, names)) return item;
      return undefined;
    }
    return { doc, view, named, attribute, child };
  }
  try {
    graph = await openRetainedRelationshipGraph(archive, { ...context, workingStorage: working,
      xmlLimits: { maxBytes: context.relationshipLimits.maxBytes, maxNodes: Infinity, maxDepth: Infinity } });
    const relationships = graph;
    for await (const part of graph.parts()) {
      const key = await values.store(literal(part)); await values.insert('parts', key, key);
    }
    let mainCount = 0, mainRange: XmlRange | undefined;
    for await (const edge of graph.outgoing('/')) for (const d of dialects) if (await equal(edge.type(), literal(`${d.r}/officeDocument`))) {
      mainCount++; mainRange = edge.targetPart ? await values.find('parts', edge.targetPart) : undefined;
    }
    if (mainCount !== 1 || !mainRange) invalid('Presentation relationship is missing or ambiguous.');
    const main = await partName(mainRange);
    await addScope(mainRange, scopes.indexOf('presentation'));
    const presentation = await open(main);
    if (!await presentation.named(presentation.doc.root, ['presentation'])) invalid('Invalid presentation root.');
    let lists = 0, slides = 0;
    // Store slide rows before reopening documents: relationship IDs and names
    // may be much larger than one cache window.
    for await (const list of presentation.view.children(presentation.doc.root)) if (await presentation.named(list, ['sldIdLst'])) {
      if (++lists > 1) invalid('Duplicate slide list.');
      for await (const entry of presentation.view.children(list)) if (await presentation.named(entry, ['sldId'])) {
        const id = await numeric((await presentation.attribute(entry, 'id'))(), 256, 2147483647);
        const rid = await presentation.attribute(entry, 'id', dialects.map(d => d.r)), edge = await relationships.get(main, rid);
        let slideType = false;
        if (edge) for (const d of dialects) if (await equal(edge.type(), literal(`${d.r}/slide`))) slideType = true;
        const target = edge?.targetPart && slideType ? await values.find('parts', edge.targetPart) : undefined;
        const idKey = await values.store(literal(String(id)));
        if (!target || !await values.insert('slide-ids', idKey, idKey) || !await values.insert('slide-parts', target, target)) invalid('Invalid slide identity or relationship.');
        await add(0, id, literal(''), target, 0, ++slides, mainRange);
        await addScope(target, 0);
      }
    }
    await retireDocument();
    // Fill display names with one XML document/cache at a time.
    for (let pointer = first[0]!; pointer;) {
      const data = await row(pointer), slide = await open(await partName(range(data, F.Part)));
      if (!await slide.named(slide.doc.root, ['sld'])) invalid('Invalid slide root.');
      const common = await slide.child(slide.doc.root, ['cSld']);
      const label = await values.store(common ? (await slide.attribute(common, 'name'))() : literal(''));
      await write(pointer + F.Name * 8, [label.start, label.length]); pointer = data[F.Next]!;
    }
    await retireDocument();
    async function* owners() { yield '/'; yield* relationships.parts(); }
    for await (const owner of owners()) for await (const edge of relationships.outgoing(owner)) {
      if (!edge.targetPart) continue;
      for (const [n, type] of scopeTypes.entries()) for (const d of dialects) if (await equal(edge.type(), literal(`${d.r}/${type}`))) {
        await addScope(await values.store(edge.targetPart()), n + 1);
      }
    }
    const positions = new Array<number>(scopes.length).fill(0);
    for await (const part of relationships.parts()) {
      const value = (await values.find('parts', () => literal(part)))!, scope = await scopeFor(part);
      await add(1, -1, literal(part), value, scope, ++positions[scope]!, value);
    }
    async function* drawingOwners() {
      for await (const data of rows(0)) yield range(data, F.Part);
      for await (const part of relationships.parts()) {
        const scope = await scopeFor(part);
        if (scope !== 0 && scope !== scopes.indexOf('presentation') && scope !== scopes.indexOf('shared')) yield (await values.find('parts', () => literal(part)))!;
      }
    }
    for await (const partRange of drawingOwners()) {
      const part = await partName(partRange), scope = await scopeFor(part), drawing = await open(part);
      const common = await drawing.child(drawing.doc.root, ['cSld']), tree = common && await drawing.child(common, ['spTree']);
      if (!tree) continue;
      let top = 0, position = 0;
      async function pushChildren(parent: RetainedXmlNode) {
        let first = 0, last = 0;
        for await (const node of drawing.view.children(parent)) {
          const pointer = pages.allocate(16); await write(pointer, [top, drawing.doc.reference(node)]);
          if (last) await write(last, [pointer]); else first = pointer; last = pointer;
        }
        if (first) top = first;
      }
      await pushChildren(tree);
      while (top) {
        const frame = await row(top, 2); top = frame[0]!;
        const element = await drawing.doc.node(frame[1]!);
        if (!await drawing.named(element, drawingKinds)) continue;
        const nonvisual = await drawing.child(element, ['nvSpPr', 'nvCxnSpPr', 'nvGraphicFramePr', 'nvGrpSpPr', 'nvPicPr']);
        const identity = nonvisual && await drawing.child(nonvisual, ['cNvPr']);
        if (!identity) invalid('Drawing object has no identity.');
        const idSource = await drawing.attribute(identity, 'id');
        if (await equal(idSource(), literal(''))) invalid('Drawing object has no identity.');
        const id = await numeric(idSource(), 0, 4294967295);
        const key = await values.store(literal(String(id)));
        if (!await values.insert(`ids:${partRange.start}`, key, key)) invalid('Invalid or duplicate drawing object identity.');
        let type = -1; for (const [n, name] of drawingKinds.entries()) if (await drawing.named(element, [name])) type = n;
        await add(2, id, (await drawing.attribute(identity, 'name'))(), partRange, scope, ++position, partRange, type);
        if (type === drawingKinds.indexOf('grpSp')) await pushChildren(element);
      }
    }
    await retireDocument(); await graph.close(); graph = undefined; check();
    async function* records(kind: SelectionRecord['kind']) {
        try {
          check(); const index = kinds.indexOf(kind);
          if (index < 0) throw new OfficeError('invalid-value', 'Expected a selection record kind.', 'usage');
          for await (const data of rows(index)) {
            const id = index === 1 ? '@part' : String(data[F.Id]!);
            const part = await partName(range(data, F.Part)), owner = await partName(range(data, F.Owner)), scope = scopes[data[F.Scope]!]!;
            const location: Location = Object.freeze({ fingerprint, scope, owner, objectId: id, coordinateSystem: 'identity' });
            yield Object.freeze({ kind, id, name: () => readName(range(data, F.Name)), part, scope, position: data[F.Position]!,
              ...(data[F.Type]! < 0 ? {} : { objectType: drawingKinds[data[F.Type]!]! }), location, token: JSON.stringify(location) });
          }
        } catch (error) { throw failure(error); }
      }
    async function* matching(prepared: ReturnType<typeof prepareSelectionQuery>) {
      for (const kind of kinds) for await (const record of records(kind))
        if (prepared.matches(record) && (prepared.name === undefined || await equal(record.name(), literal(prepared.name)))) yield record;
    }
    return Object.freeze({ fingerprint, main, close, records,
      select(query: SelectionQuery) {
        check(); const prepared = prepareSelectionQuery(query, fingerprint);
        return (async function* () {
          try {
            // No partial selection escapes before ambiguity/missing admission.
            // The existing public diagnostic caps candidates at twenty.
            let count = 0; const candidates: Location[] = [];
            for await (const record of matching(prepared)) {
              count++; if (!prepared.all && candidates.length < 20) candidates.push(record.location);
              if (prepared.all || candidates.length === 20) break;
            }
            if (!count) throw new SelectionError('missing-selection');
            if (count > 1 && !prepared.all) throw new SelectionError('ambiguous-selection', Object.freeze(candidates));
            yield* matching(prepared);
          } catch (error) { throw failure(error); }
        })();
      }
    });
  } catch (error) { await Promise.allSettled([retireDocument(), graph?.close(), close()]); throw failure(error); }
}
