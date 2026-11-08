import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource } from './contracts.js';
import { OfficeError } from './errors.js';
import { equationOpaqueElements } from './equations-compatibility.js';
import { relationshipOwner } from './relationship-owner.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import { openRetainedContentTypes } from './retained-content-types.js';
import { openRetainedRelationshipGraph, type RetainedRelationshipEdge } from './retained-relationship-graph.js';
import { openRetainedXmlDocument, type RetainedXmlDocument, type RetainedXmlNode } from './retained-xml-document.js';
import { openRetainedCompatibility, type RetainedCompatibilityView } from './retained-compatibility.js';
import { RetainedValues, literal, equal, characters } from './retained-values.js';
import { resourceContext } from './resource-limits.js';
import { rules, dialects, types, type Rule } from './validation-schema.js';
import type { ValidationLimits } from './validation.js';

export interface RetainedPresentationValidation {
  readonly valid: boolean;
  readonly schema: 'not-checked';
  readonly rules: readonly Rule[];
  issues(): AsyncGenerator<{ readonly rule: Rule; readonly part: string }>;
  close(): Promise<void>;
}
// Strings decoded below are exclusively admitted ZIP part names, never XML scalars.
async function partName(source: ByteSource): Promise<string> {
  const decoder = new TextDecoder(); let text = '';
  for await (const bytes of source) text += decoder.decode(bytes, { stream: true });
  return text + decoder.decode();
}
async function integer(source: ByteSource | undefined, min: number, max: number): Promise<number | null> {
  if (!source) return null;
  let value = 0, started = false, digits = false, trailing = false;
  for await (const character of characters(source)) {
    if (!character.trim()) { if (started) trailing = true; continue; }
    if (trailing) return null;
    if (!started && character === '+') { started = true; continue; }
    started = true;
    if (character < '0' || character > '9') return null;
    digits = true; value = value * 10 + Number(character);
    if (!Number.isSafeInteger(value) || value > max) return null;
  }
  return digits && value >= min ? value : null;
}
async function* essence(source: ByteSource): ByteSource {
  // MIME parsing already validated this value. Only the bounded known essence
  // is compared; arbitrarily long parameters remain in backing storage.
  for await (const character of characters(source)) {
    if (character === ';' || !character.trim()) return;
    yield* literal(character.toLowerCase());
  }
}
enum R { Next, Name, Length, Kind, Dialect, Count }
const rootKinds = [...new Set(types.values())];

/** Semantic validation retains indexes and traversal frames in caller storage.
 * Two XML passes keep the number of live document caches independent of parts. */
export async function openRetainedPresentationValidation(
  archive: Pick<RetainedPackageArchive, 'parts' | 'read' | 'byteLength'>,
  settings: RetainedPackageContext,
  overrides: Partial<ValidationLimits> = {}
): Promise<RetainedPresentationValidation> {
  const context = resourceContext({ ...settings, xmlLimits: { ...settings.xmlLimits, ...overrides }, relationshipLimits: { ...settings.relationshipLimits, ...overrides } });
  const limits = { ...context.xmlLimits, ...context.relationshipLimits, maxEntries: Infinity, ...overrides };
  const working = { ...settings.workingStorage }, signal = context.signal ?? new AbortController().signal;
  const cacheBytes = working.cacheBytes ?? 1024 * 1024;
  if (!working.fs || !working.directory?.startsWith('/') || !Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384)
    throw new OfficeError('invalid-value', 'Explicit validation storage and a valid cache budget are required.', 'usage');
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, cacheBytes / 16384);
  let closed = false, closing: Promise<void> | undefined, firstRoot = 0, lastRoot = 0, firstIssue = 0, lastIssue = 0, scope = 0;
  const check = () => {
    if (closed) throw new OfficeError('invalid-handle', 'Validation is closed.', 'index');
    if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'index');
  };
  const failure = (error: unknown) => error instanceof OfficeError ? error : new OfficeError(signal.aborted ? 'cancelled' : 'io-failure', 'Validation storage operation failed.', 'index');
  const close = () => { closed = true; return closing ??= pages.close(); };
  const values = new RetainedValues(pages, check, signal);
  async function row(pointer: number, count: number): Promise<number[]> {
    check(); const bytes = await pages.read(pointer, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length: count }, (_, n) => view.getFloat64(n * 8, true));
  }
  async function write(pointer: number, data: number[]) {
    check(); const bytes = new Uint8Array(data.length * 8), view = new DataView(bytes.buffer);
    data.forEach((value, n) => view.setFloat64(n * 8, value, true)); await pages.write(pointer, bytes);
  }
  async function add(data: number[]) { const pointer = pages.allocate(data.length * 8); await write(pointer, data); return pointer; }
  async function fail(rule: Rule, part: string) {
    const key = await values.store(literal(part));
    if (!await values.insert(`issue:${rule}`, key, key)) return;
    const pointer = await add([0, rules.indexOf(rule), key.start, key.length]);
    if (lastIssue) await write(lastIssue, [pointer]); else firstIssue = pointer; lastIssue = pointer;
  }
  async function name(data: number[]) { return partName(values.read({ start: data[R.Name]!, length: data[R.Length]! })); }
  async function* roots() { for (let pointer = firstRoot; pointer;) { const data = await row(pointer, R.Count); yield { pointer, data }; pointer = data[R.Next]!; } }
  function set() {
    const id = `set:${scope++}`;
    return {
      async add(key: string) { const value = await values.store(literal(key)); return values.insert(id, value, value); },
      async has(key: string) { return !!await values.find(id, () => literal(key)); }
    };
  }
  const metadata = { ...context, workingStorage: working, xmlLimits: { ...context.xmlLimits, maxDepth: Infinity, maxNodes: Infinity } };
  let content: Awaited<ReturnType<typeof openRetainedContentTypes>> | undefined;
  let graph: Awaited<ReturnType<typeof openRetainedRelationshipGraph>> | undefined;
  let document: RetainedXmlDocument | undefined, view: RetainedCompatibilityView | undefined;
  async function retireDocument() {
    const owned = [view, document]; view = undefined; document = undefined;
    const results = await Promise.allSettled(owned.map(value => value?.close()));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }
  async function open(name: string, maxNodes: number) {
    document = await openRetainedXmlDocument(archive.read(name), { ...context, workingStorage: working, xmlLimits: { ...limits, maxNodes } });
    return document;
  }
  async function compatibility(doc: RetainedXmlDocument, d: (typeof dialects)[number]) {
    return view = await openRetainedCompatibility(doc, [d.p, d.a, d.r], { ...context, workingStorage: working }, [
      ...equationOpaqueElements, { namespace: d.a, localName: 'graphicData' }, { namespace: d.a, localName: 'ext' }, { namespace: d.p, localName: 'ext' }
    ]);
  }
  try {
    content = await openRetainedContentTypes(archive.read('/[Content_Types].xml'), metadata, limits);
    graph = await openRetainedRelationshipGraph(archive, metadata);
    const relationships = graph;
    for await (const edge of graph.dangling()) await fail('relationship-targets', edge.owner);
    let mainCount = 0, main: RetainedRelationshipEdge | undefined, presentationCount = 0, presentation = '';
    for await (const edge of graph.outgoing('/')) for (const d of dialects) if (await equal(edge.type(), literal(`${d.r}/officeDocument`))) { mainCount++; main = edge; }
    for await (const part of archive.parts()) {
      if (part.toLowerCase() === '/[content_types].xml') continue;
      try {
        let kind: string | undefined;
        for (const [mime, root] of types) if (await equal(essence(await content.get(part)), literal(mime))) { kind = root; break; }
        if (kind) {
          const key = await values.store(literal(part)), pointer = await add([0, key.start, key.length, rootKinds.indexOf(kind), -1]);
          await values.insert('roots', key, { start: pointer, length: R.Count * 8 });
          if (lastRoot) await write(lastRoot, [pointer]); else firstRoot = pointer; lastRoot = pointer;
          if (kind === 'presentation') { presentationCount++; presentation = part; }
        }
        if (relationshipOwner(part) !== null && !await equal(essence(await content.get(part)), literal('application/vnd.openxmlformats-package.relationships+xml'))) await fail('content-types', part);
      } catch (error) { if (!(error instanceof OfficeError) || error.code !== 'missing-binding') throw error; await fail('content-types', part); }
    }
    if (mainCount !== 1 || main?.external || presentationCount !== 1 || !main?.targetPart || !await equal(main.targetPart(), literal(presentation))) await fail('main-part', '/');
    let bytes = 0, nodes = 0;
    for await (const { pointer, data } of roots()) {
      const part = await name(data); bytes += await archive.byteLength(part);
      if (bytes > limits.maxBytes || nodes >= limits.maxNodes) throw new OfficeError('resource-limit', 'Validation XML limit exceeded.', 'index');
      const doc = await open(part, limits.maxNodes - nodes); nodes += doc.nodeCount;
      let dialect = -1;
      for (const [i, d] of dialects.entries()) if (await equal(doc.namespace(doc.root), literal(d.p))) dialect = i;
      if (dialect < 0 || !await equal(doc.raw(doc.root.localName), literal(rootKinds[data[R.Kind]!]!))) await fail('required-structure', part);
      else { await compatibility(doc, dialects[dialect]!); await write(pointer + R.Dialect * 8, [dialect]); }
      await retireDocument();
    }
    for await (const { data } of roots()) {
      if (data[R.Dialect]! < 0) continue;
      const part = await name(data), kind = rootKinds[data[R.Kind]!]!, d = dialects[data[R.Dialect]!]!;
      const doc = await open(part, limits.maxNodes), projection = await compatibility(doc, d), root = doc.root;
      const matches = async (node: RetainedXmlNode, local: string, namespace = d.p) => await equal(doc.namespace(node), literal(namespace)) && await equal(doc.raw(node.localName), literal(local));
      async function attribute(node: RetainedXmlNode, local: string, namespace = '') {
        for await (const item of doc.attributes(node)) if (await matches(item, local, namespace)) return () => doc.text(item);
        return undefined;
      }
      async function number(node: RetainedXmlNode, local: string, min = 0, max = 4294967295) { return integer((await attribute(node, local))?.(), min, max); }
      async function* children(node: RetainedXmlNode, local: string) { for await (const child of projection.children(node)) if (await matches(child, local)) yield child; }
      async function required(node: RetainedXmlNode, local: string) {
        let count = 0, first: RetainedXmlNode | undefined;
        for await (const child of children(node, local)) { count++; first ??= child; }
        if (count !== 1) await fail('required-structure', part); return first;
      }
      async function* outgoing(owner: string, type: string) { for await (const edge of relationships.outgoing(owner)) if (await equal(edge.type(), literal(`${d.r}/${type}`))) yield edge; }
      async function target(edge: RetainedRelationshipEdge | undefined, expected: string) {
        if (!edge?.targetPart || edge.external) return null;
        const found = await values.find('roots', edge.targetPart); if (!found) return null;
        const rowData = await row(found.start, R.Count);
        return rootKinds[rowData[R.Kind]!] === expected && rowData[R.Dialect]! >= 0 ? await name(rowData) : null;
      }
      async function entryTarget(node: RetainedXmlNode, type: string, expected: string) {
        const id = await attribute(node, 'id', d.r), edge = id ? await relationships.get(part, id) : undefined;
        return edge && await equal(edge.type(), literal(`${d.r}/${type}`)) ? target(edge, expected) : null;
      }
      async function listed(listName: string, childName: string, type: string, expected: string, rule: Rule, min: number, max: number) {
        let count = 0; for await (const _ of children(root, listName)) { void _; count++; }
        if (count > 1) await fail('required-structure', part);
        const ids = set(), targets = set();
        for await (const list of children(root, listName)) for await (const entry of children(list, childName)) {
          const id = await number(entry, 'id', min, max), dest = await entryTarget(entry, type, expected);
          const duplicateId = id !== null && !await ids.add(String(id)), duplicateTarget = dest !== null && !await targets.add(dest);
          if (id === null || duplicateId || dest === null || duplicateTarget) await fail(rule, part);
        }
        return targets;
      }
      // Stored linked stack preserves the buffered validator's reverse-child DFS.
      async function* walk(initial: AsyncIterable<RetainedXmlNode>, namespaces: string[], filter = false) {
        let top = 0;
        const push = async (node: RetainedXmlNode) => { top = await add([top, doc.reference(node)]); };
        for await (const node of initial) await push(node);
        while (top) {
          const frame = await row(top, 2); top = frame[0]!; const node = await doc.node(frame[1]!);
          let descend = false; for (const ns of namespaces) if (await equal(doc.namespace(node), literal(ns))) descend = true;
          if (!filter || descend) yield node;
          if (descend) for await (const child of projection.children(node)) await push(child);
        }
      }
      async function* single(node: RetainedXmlNode) { yield node; }
      if (kind === 'presentation') {
        await required(root, 'notesSz');
        await listed('sldIdLst', 'sldId', 'slide', 'sld', 'slide-ids', 256, 2147483647);
        await listed('sldMasterIdLst', 'sldMasterId', 'slideMaster', 'sldMaster', 'master-layouts', 2147483648, 4294967295);
        for (const type of ['notesMaster', 'handoutMaster']) {
          let count = 0; for await (const _ of children(root, `${type}IdLst`)) { void _; count++; }
          if (count > 1) await fail('note-associations', part);
          for await (const list of children(root, `${type}IdLst`)) {
            let entries = 0, first: RetainedXmlNode | undefined;
            for await (const entry of children(list, `${type}Id`)) { entries++; first ??= entry; }
            if (entries !== 1 || !first || await entryTarget(first, type, type) === null) await fail('note-associations', part);
          }
        }
        await retireDocument(); continue;
      }
      const common = await required(root, 'cSld'), tree = common && await required(common, 'spTree'), shapeIds = set();
      if (tree) {
        await required(tree, 'nvGrpSpPr'); await required(tree, 'grpSpPr');
        for await (const node of walk(single(tree), [d.p])) if (await matches(node, 'cNvPr')) {
          const id = await number(node, 'id'); if (id === null || !await shapeIds.add(String(id))) await fail('shape-ids', part);
        }
        const nonvisual = [['sp', 'nvSpPr'], ['pic', 'nvPicPr'], ['grpSp', 'nvGrpSpPr'], ['graphicFrame', 'nvGraphicFramePr'], ['cxnSp', 'nvCxnSpPr'], ['spTree', 'nvGrpSpPr']];
        for await (const node of walk(single(tree), [d.p])) for (const [local, nv] of nonvisual) if (await matches(node, local!)) {
          const container = await required(node, nv!); if (container) await required(container, 'cNvPr');
        }
      }
      for await (const node of walk(single(root), [d.p, d.a])) if (await matches(node, 'stCxn', d.a) || await matches(node, 'endCxn', d.a)) {
        const id = await number(node, 'id');
        if (id === null || !await shapeIds.has(String(id)) || await number(node, 'idx') === null) await fail('connector-references', part);
      }
      const timingIds = set();
      for await (const node of walk(children(root, 'timing'), [d.p], true)) if (await matches(node, 'cTn')) {
        const id = await number(node, 'id'); if (id === null || !await timingIds.add(String(id))) await fail('timing-references', part);
      }
      for await (const node of walk(children(root, 'timing'), [d.p], true)) {
        const shape = await attribute(node, 'spid'); let needsShape = !!shape;
        for (const local of ['spTgt', 'bldP', 'bldDgm', 'bldOleChart', 'bldGraphic']) if (await matches(node, local)) needsShape = true;
        if (needsShape) { const id = await integer(shape?.(), 0, 4294967295); if (id === null || !await shapeIds.has(String(id))) await fail('timing-references', part); }
        if (await matches(node, 'tn')) { const id = await number(node, 'val'); if (id === null || !await timingIds.has(String(id))) await fail('timing-references', part); }
      }
      async function backlinks(owner: string, type: string) {
        let count = 0; for await (const edge of outgoing(owner, type)) if (edge.targetPart && await equal(edge.targetPart(), literal(part))) count++; return count;
      }
      if (kind === 'sld' || kind === 'sldLayout') {
        let count = 0, first: RetainedRelationshipEdge | undefined;
        for await (const edge of outgoing(part, kind === 'sld' ? 'slideLayout' : 'slideMaster')) { count++; first ??= edge; }
        const dest = await target(first, kind === 'sld' ? 'sldLayout' : 'sldMaster');
        if (count !== 1 || dest === null) await fail('master-layouts', part);
        if (kind === 'sldLayout' && dest !== null && !await backlinks(dest, 'slideLayout')) await fail('master-layouts', part);
      }
      if (kind === 'sldMaster') {
        await required(root, 'clrMap');
        const layouts = await listed('sldLayoutIdLst', 'sldLayoutId', 'slideLayout', 'sldLayout', 'master-layouts', 2147483648, 4294967295);
        for await (const edge of outgoing(part, 'slideLayout')) {
          const dest = await target(edge, 'sldLayout');
          if (dest === null || !await layouts.has(dest)) await fail('master-layouts', part);
        }
        // All listed targets are graph edges, so replaying the edges avoids a heap set.
        for await (const edge of outgoing(part, 'slideLayout')) {
          const dest = await target(edge, 'sldLayout');
          if (dest !== null && await layouts.has(dest) && !await backlinks(dest, 'slideMaster')) await fail('master-layouts', part);
        }
      }
      if (kind === 'notesMaster' || kind === 'handoutMaster') await required(root, 'clrMap');
      if (kind === 'sld' || kind === 'notes') {
        const isNotes = kind === 'notes', type = isNotes ? 'slide' : 'notesSlide'; let count = 0;
        for await (const _ of outgoing(part, type)) { void _; count++; }
        if (count > 1 || isNotes && count !== 1) await fail('note-associations', part);
        for await (const edge of outgoing(part, type)) {
          const dest = await target(edge, isNotes ? 'sld' : 'notes');
          if (dest === null || await backlinks(dest, isNotes ? 'notesSlide' : 'slide') !== 1) await fail('note-associations', part);
        }
        if (isNotes) {
          let count = 0, first: RetainedRelationshipEdge | undefined;
          for await (const edge of outgoing(part, 'notesMaster')) { count++; first ??= edge; }
          if (count !== 1 || await target(first, 'notesMaster') === null) await fail('note-associations', part);
        }
      }
      await retireDocument();
    }
    await content.close(); content = undefined; await graph.close(); graph = undefined;
    check();
    return Object.freeze({ valid: !firstIssue, schema: 'not-checked', rules: Object.freeze([...rules]), close,
      async *issues() {
        try { check(); for (let pointer = firstIssue; pointer;) {
          const data = await row(pointer, 4); yield Object.freeze({ rule: rules[data[1]!]!, part: await partName(values.read({ start: data[2]!, length: data[3]! })) }); pointer = data[0]!;
        } } catch (error) { throw failure(error); }
      }
    });
  } catch (error) {
    await Promise.allSettled([retireDocument(), content?.close(), graph?.close(), close()]); throw failure(error);
  }
}
