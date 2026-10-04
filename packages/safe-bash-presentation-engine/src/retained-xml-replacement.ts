import { xmlReplacementSequences as sequences } from "./xml-replacement-rules.js";
import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource } from './contracts.js';
import { OfficeError, PackageNotFoundError } from './errors.js';
import { resourceContext } from './resource-limits.js';
import type { RetainedPackageArchive } from './retained-package.js';
import type { RetainedXmlPartContext } from './retained-xml-parts.js';
import { openRetainedContentTypes } from './retained-content-types.js';
import { openRetainedRelationshipGraph } from './retained-relationship-graph.js';
import { openRetainedPresentationValidation } from './retained-validation.js';
import { openRetainedXmlDocument, type RetainedXmlDocument as Document, type RetainedXmlNode as Node } from './retained-xml-document.js';
import { RetainedValues, literal, equal, characters } from './retained-values.js';
import { partName } from './package-uri.js';
import { dialects } from './validation-schema.js';

type Archive = Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>;
export interface RetainedXmlReplacement extends Archive {
  readonly changed: boolean;
  replacement(part: string): Promise<ByteSource | undefined>;
  close(): Promise<void>;
}

function unsupported(message: string): never { throw new OfficeError('unsupported-edit', message, 'validate-intent'); }
function reject(): never { return unsupported('Structured XML change exceeds the validated child-operation subset.'); }
async function is(doc: Document, node: Node, local: string, namespaces?: readonly string[]) {
  if (!await equal(doc.raw(node.localName), literal(local))) return false;
  if (!namespaces) return true;
  for (const ns of namespaces) if (await equal(doc.namespace(node), literal(ns))) return true;
  return false;
}
async function sameName(left: Document, a: Node, right: Document, b: Node) { return await equal(left.raw(a.localName), right.raw(b.localName)) && await equal(left.namespace(a), right.namespace(b)); }
async function* children(doc: Document, node: Node) { for await (const child of doc.children(node)) if (child.kind === 'element') yield child; }
async function typeInfo(source: ByteSource) {
  let prefix = '', suffix = '', pending = 0, started = false, dangerous = false, window = '';
  for await (const value of characters(source)) {
    if (value === ';') break;
    const character = value.toLowerCase();
    if (!character.trim()) { if (started) pending++; continue; }
    if (pending) { prefix = (prefix + ' '.repeat(Math.min(160, pending))).slice(0, 160); suffix = (suffix + ' '.repeat(Math.min(4, pending))).slice(-4); window = (window + ' '.repeat(Math.min(17, pending))).slice(-17); pending = 0; }
    started = true; prefix = (prefix + character).slice(0, 160); suffix = (suffix + character).slice(-4);
    window = (window + character).slice(-17); if (['digital-signature','macroenabled','vbaproject'].some(value => window.includes(value))) dangerous = true;
  }
  return { name: prefix, xml: prefix === 'application/xml' || prefix === 'text/xml' || suffix === '+xml', dangerous };
}

/** Admits the complete existing XML replacement subset. Archive ownership stays
 * with the caller; replacement bytes, comparison queues and maps use caller pages. */
export async function openRetainedXmlReplacement(archive: Archive, requested: string, source: ByteSource, settings: RetainedXmlPartContext): Promise<RetainedXmlReplacement> {
  const limits = settings.validationLimits && { ...settings.validationLimits };
  if (!limits) throw new OfficeError('invalid-value', 'XML operations require explicit validation limits.', 'usage');
  const part = partName(requested, false), working = { ...settings.workingStorage }, signal = settings.signal ?? new AbortController().signal;
  const context = { ...resourceContext(settings), workingStorage: working, signal, xmlLimits: limits, relationshipLimits: limits };
  let found = false; if (part === requested) for await (const name of archive.parts()) if (name === part) found = true;
  if (!found) throw new OfficeError('missing-selection', 'An exact existing package part is required.', 'select');
  // Opening content types validates the explicit working-storage contract first.
  const types = await openRetainedContentTypes(archive.read('/[Content_Types].xml'), context, limits);
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, (working.cacheBytes ?? 1024 * 1024) / 16384);
  let before: Document | undefined, after: Document | undefined, graph: Awaited<ReturnType<typeof openRetainedRelationshipGraph>> | undefined, closed = false, closing: Promise<void> | undefined, serial = 0;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'XML replacement is closed.', 'validate-intent'); if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'validate-intent'); };
  const close = () => { closed = true; return closing ??= (async () => { const results = await Promise.allSettled([before?.close(), after?.close(), graph?.close(), types.close(), pages.close()]); for (const result of results) if (result.status === 'rejected') throw result.reason; })(); };
  const values = new RetainedValues(pages, check, signal);
  async function row(pointer: number, count: number) { check(); const bytes = await pages.read(pointer, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return Array.from({ length: count }, (_, i) => view.getFloat64(i * 8, true)); }
  async function write(pointer: number, row: number[]) { check(); const bytes = new Uint8Array(row.length * 8), view = new DataView(bytes.buffer); row.forEach((value, i) => view.setFloat64(i * 8, value, true)); await pages.write(pointer, bytes); }
  async function pairs(left: Document, right: Document, visit: (a: Node, b: Node) => Promise<boolean>) {
    let stack = pages.allocate(24); await write(stack, [0, left.reference(left.root), right.reference(right.root)]);
    while (stack) {
      const item = await row(stack, 3); stack = item[0]!; const a = await left.node(item[1]!), b = await right.node(item[2]!);
      if (!await visit(a, b)) continue;
      const iterator = children(right, b);
      try {
        for await (const child of children(left, a)) {
          const next = await iterator.next(); if (next.done) unsupported('XML replacement must preserve element names and sequence.');
          const pointer = pages.allocate(24); await write(pointer, [stack, left.reference(child), right.reference(next.value)]); stack = pointer;
        }
        if (!(await iterator.next()).done) unsupported('XML replacement must preserve element names and sequence.');
      } finally { await iterator.return(undefined); }
    }
  }
  async function compareAttributes(left: Document, a: Node, right: Document, b: Node, declarations: boolean) {
    const scope = `attributes:${serial++}`; let count = 0, compared = 0;
    async function* key(doc: Document, attribute: Node) { yield* doc.namespace(attribute); yield* literal('\0'); yield* doc.raw(attribute.localName); }
    for await (const attribute of declarations ? left.declarations(a) : left.attributes(a)) {
      if (!declarations && await equal(left.namespace(attribute), literal(''))) continue;
      const name = await values.store(key(left, attribute)), value = await values.store(left.text(attribute)); await values.insert(scope, name, value); count++;
    }
    for await (const attribute of declarations ? right.declarations(b) : right.attributes(b)) {
      if (!declarations && await equal(right.namespace(attribute), literal(''))) continue;
      const value = await values.find(scope, () => key(right, attribute)); compared++;
      if (!declarations) for (const dialect of dialects) if (await equal(right.namespace(attribute), literal(dialect.r)) && !await graph!.get(part, () => right.text(attribute))) throw new OfficeError('invalid-opc', 'XML references an absent relationship.', 'validate-result');
      if (!value || !await equal(values.read(value), right.text(attribute))) unsupported(declarations ? 'XML replacement must preserve namespace declarations.' : 'Namespaced XML attributes must remain unchanged.');
    }
    if (count !== compared) unsupported(declarations ? 'XML replacement must preserve namespace declarations.' : 'Namespaced XML attributes must remain unchanged.');
  }
  async function guards(current: Archive) {
    let nodes = 0, total = 0;
    for await (const name of current.parts()) {
      check(); if (name === '/[Content_Types].xml') continue;
      const type = await typeInfo(await types.get(name));
      if (type.dangerous || name.toLowerCase().startsWith('/_xmlsignatures/')) unsupported('Signed and macro-enabled packages cannot be changed.');
      if (!type.xml) continue;
      total += await current.byteLength(name);
      if (total > limits!.maxBytes || nodes >= limits!.maxNodes) throw new OfficeError('resource-limit', 'Package XML inspection limit exceeded.', 'index');
      const doc = await openRetainedXmlDocument(current.read(name), { ...context, xmlLimits: { ...limits!, maxNodes: limits!.maxNodes - nodes } }); let failed = false;
      try {
        nodes += doc.nodeCount;
        for await (const node of doc.elements(doc.root)) {
          for await (const attribute of doc.attributes(node)) for (const dialect of dialects) if (await equal(doc.namespace(attribute), literal(dialect.r)) && !await graph!.get(name, () => doc.text(attribute))) throw new OfficeError('invalid-opc', 'XML references an absent relationship.', 'validate-intent');
          if (await is(doc, node, 'modifyVerifier', dialects.map(d => d.p))) unsupported('Protected presentations cannot be changed.');
        }
      } catch (error) { failed = true; throw error; } finally { try { await doc.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
    }
    async function* owners() { yield '/'; yield* graph!.parts(); }
    for await (const owner of owners()) for await (const edge of graph!.outgoing(owner)) {
      let window = ''; for await (const character of characters(edge.type())) { window = (window + character).slice(-19); if (window.includes('/digital-signature/')) unsupported('Signed and macro-enabled packages cannot be changed.'); }
      if (window.endsWith('/vbaProject')) unsupported('Signed and macro-enabled packages cannot be changed.');
    }
  }
  async function validate(current: Archive) {
    const validation = await openRetainedPresentationValidation(current, context, limits); const valid = validation.valid; await validation.close();
    if (!valid) throw new OfficeError('invalid-opc', 'Replacement fails presentation graph validation.', 'validate-result');
  }
  async function strict(left: Document, right: Document, expected: string) {
    for await (const child of children(right, right.root)) if (await is(right, child, 'sldSz') && await equal(right.namespace(child), right.namespace(right.root))) {
      for (const axis of ['cx','cy']) {
        let found = false;
        for await (const attribute of right.attributes(child)) if (await is(right, attribute, axis, [''])) {
          let number = 0, digits = 0;
          for await (const character of characters(right.text(attribute))) { if (character < '0' || character > '9') throw new OfficeError('invalid-opc', 'Invalid authored slide dimensions.', 'validate-result'); number = number * 10 + Number(character); digits++; if (number > 51206400) break; }
          if (digits && number >= 914400 && number <= 51206400) found = true;
        }
        if (!found) throw new OfficeError('invalid-opc', 'Invalid authored slide dimensions.', 'validate-result');
      }
    }
    if (!await is(left, left.root, expected) || !await is(right, right.root, expected)) throw new OfficeError('invalid-opc', 'XML root does not match the content type.', 'validate-result');
    let dialect: (typeof dialects)[number] | undefined;
    for (const value of dialects) if (await equal(left.namespace(left.root), literal(value.p))) dialect = value;
    if (!dialect || !await equal(left.namespace(left.root), right.namespace(right.root))) unsupported('XML replacement must preserve the presentation dialect.');
    const iterator = right.elements(right.root);
    try {
      for await (const node of left.elements(left.root)) { const next = await iterator.next(); if (next.done) unsupported('XML replacement must preserve namespace declarations.'); await compareAttributes(left, node, right, next.value, true); }
      if (!(await iterator.next()).done) unsupported('XML replacement must preserve namespace declarations.');
    } finally { await iterator.return(undefined); }
    await pairs(left, right, async (a, b) => {
      if (!await sameName(left, a, right, b)) unsupported('XML replacement must preserve element names and sequence.');
      let understood = false; for (const ns of [dialect!.p, dialect!.a]) if (await equal(right.namespace(b), literal(ns))) understood = true;
      if (!understood || await is(right, b, 'graphicData') || await is(right, b, 'ext')) {
        if (!await equal(left.markup(a), right.markup(b))) unsupported('Opaque XML content must remain unchanged.');
        return false;
      }
      await compareAttributes(left, a, right, b, false);
      if (await is(right, b, 'modifyVerifier', dialects.map(d => d.p))) unsupported('Protection changes are unsupported.');
      if (await equal(right.namespace(b), literal(dialect!.p))) for (const [local, order] of Object.entries(sequences)) if (await is(right, b, local)) {
        let previous = -1;
        for await (const child of children(right, b)) { let rank = -1; for (let i = 0; i < order.length; i++) if (await is(right, child, order[i]!)) rank = i; if (rank < 0 || rank <= previous) unsupported('Unsupported XML child sequence.'); previous = rank; }
      }
      for await (const attribute of right.attributes(b)) for (const value of dialects) if (value.r !== dialect!.r && await equal(right.namespace(attribute), literal(value.r))) unsupported('XML replacement must preserve relationship dialect.');
      return true;
    });
  }
  async function structural(left: Document, right: Document) {
    let dialect = dialects[0]!; for (const value of dialects) if (await equal(left.namespace(left.root), literal(value.p))) dialect = value;
    async function movable(node: Node) {
      for await (const child of left.elements(node)) {
        let extent = await is(left, child, 'ext', [dialect.a]), count = 0;
        for await (const attribute of left.attributes(child)) {
          count++;
          const plain = await equal(left.namespace(attribute), literal(''));
          if (!plain || !await is(left, attribute, 'cx') && !await is(left, attribute, 'cy')) extent = false;
          if (!plain) { let valid = false; for (const ns of [...dialects.map(d => d.r), 'http://www.w3.org/XML/1998/namespace']) if (await equal(left.namespace(attribute), literal(ns))) valid = true; if (!valid) return false; }
        }
        extent = extent && count === 2;
        if (!await equal(left.namespace(child), literal(dialect.p)) && !await equal(left.namespace(child), literal(dialect.a)) || await is(left, child, 'graphicData') || await is(left, child, 'ext') && !extent) return false;
      }
      return true;
    }
    // Ancestor shells are identical before descending: inherited namespace
    // context is equal, so raw child comparisons equal standalone comparisons.
    await pairs(left, right, async (a, b) => {
      if (await equal(left.markup(a), right.markup(b))) return false;
      if (!await sameName(left, a, right, b) || !await equal(left.shell(a), right.shell(b))) reject();
      if (!await equal(left.namespace(a), literal(dialect.p)) && !await equal(left.namespace(a), literal(dialect.a)) || await is(left, a, 'graphicData') || await is(left, a, 'ext')) reject();
      const drawing = await is(left, a, 'spTree', [dialect.p]), paragraph = await is(left, a, 'p', [dialect.a]);
      if (!drawing && !paragraph) return true;
      async function eligible(doc: Document, node: Node) { for (const name of drawing ? ['sp','pic','cxnSp','grpSp'] : ['r','br']) if (await is(doc, node, name, [drawing ? dialect.p : dialect.a])) return true; return false; }
      async function* fixed(doc: Document, node: Node) { for await (const child of children(doc, node)) if (!await eligible(doc, child)) yield child; }
      const iterator = fixed(right, b);
      try { for await (const child of fixed(left, a)) { const next = await iterator.next(); if (next.done || !await equal(left.markup(child), right.markup(next.value))) reject(); } if (!(await iterator.next()).done) reject(); }
      finally { await iterator.return(undefined); }
      const scope = `children:${serial++}`; let first = 0, last = 0, index = 0;
      for await (const child of children(left, a)) {
        if (await eligible(left, child)) {
          const pointer = pages.allocate(40); await write(pointer, [0, left.reference(child), index, -1, 0]);
          if (last) await write(last, [pointer]); else first = pointer; last = pointer;
          const existing = await values.find(scope, () => left.markup(child));
          if (existing) { const queue = await row(existing.start, 2); await write(queue[1]! + 32, [pointer]); await write(existing.start + 8, [pointer]); }
          else { const key = await values.store(left.markup(child)), queue = pages.allocate(16); await write(queue, [pointer, pointer]); await values.insert(scope, key, { start: queue, length: 16 }); }
        }
        index++;
      }
      index = 0; let matched = true;
      for await (const child of children(right, b)) {
        if (await eligible(right, child)) {
          const queue = await values.find(scope, () => right.markup(child)), head = queue ? (await row(queue.start, 2))[0]! : 0;
          if (!head) { matched = false; break; }
          const item = await row(head, 5); await write(head + 24, [index]); await write(queue!.start, [item[4]!]);
        }
        index++;
      }
      if (!matched) return true;
      for (let pointer = first; pointer;) { const item = await row(pointer, 5); if (item[2] !== item[3] && !await movable(await left.node(item[1]!))) reject(); pointer = item[0]!; }
      index = 0; let extension = false, end = false;
      for await (const child of children(right, b)) {
        if (drawing) {
          if (index === 0 && !await is(right, child, 'nvGrpSpPr') || index === 1 && !await is(right, child, 'grpSpPr') || index >= 2 && (await is(right, child, 'nvGrpSpPr') || await is(right, child, 'grpSpPr')) || extension) reject();
          if (await is(right, child, 'extLst')) extension = true;
        } else {
          let allowed = false; for (const name of ['pPr','r','br','endParaRPr']) if (await is(right, child, name, [dialect.a])) allowed = true;
          if (!allowed || end || index !== 0 && await is(right, child, 'pPr')) reject();
          if (await is(right, child, 'endParaRPr')) end = true;
        }
        index++;
      }
      if (drawing && index < 2) reject();
      return false;
    });
  }
  try {
    const selectedType = part === '/[Content_Types].xml' ? { name: 'application/xml', xml: true } : await typeInfo(await types.get(part));
    if (!selectedType.xml) throw new OfficeError('unsupported-profile', 'The selected part is not XML.', 'select');
    before = await openRetainedXmlDocument(archive.read(part), context);
    async function* admittedReplacement(): ByteSource {
      const checkInput = () => { if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'admit'); };
      let iterator: AsyncIterator<Uint8Array>, exhausted = false, size = 0;
      try { iterator = source[Symbol.asyncIterator](); }
      catch { checkInput(); throw new OfficeError('io-failure', 'Byte input failed.', 'admit'); }
      try {
        for (let reads = 0; reads < context.limits.maxReads; reads++) {
          checkInput(); let item: IteratorResult<Uint8Array>;
          try { item = await iterator.next(); }
          catch (error) {
            checkInput();
            if (error && typeof error === 'object' && 'code' in error) {
              if (error.code === 'ENOENT') throw new PackageNotFoundError();
              if (error.code === 'EFBIG') throw new OfficeError('resource-limit', 'Byte input exceeds its limit.', 'admit');
            }
            throw new OfficeError('io-failure', 'Byte input failed.', 'admit');
          }
          checkInput(); if (item.done) { exhausted = true; return; }
          if (!(item.value instanceof Uint8Array)) throw new OfficeError('invalid-type', 'Byte source returned an invalid chunk.', 'admit');
          if (item.value.length > limits!.maxBytes - size || !Number.isSafeInteger(size + item.value.length)) throw new OfficeError('resource-limit', 'Byte input exceeds its limit.', 'admit');
          size += item.value.length; yield item.value;
        }
        throw new OfficeError('resource-limit', 'Byte source exceeded its read limit.', 'admit');
      } finally { if (!exhausted) try { await iterator.return?.(); } catch { /* primary admission failure wins */ } }
    }
    const replacement = await values.store(admittedReplacement());
    graph = await openRetainedRelationshipGraph(archive, context); await guards(archive);
    const expected = new Map([
      ['application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml','presentation'],
      ['application/vnd.openxmlformats-officedocument.presentationml.template.main+xml','presentation'],
      ['application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml','presentation'],
      ['application/vnd.openxmlformats-officedocument.presentationml.slide+xml','sld']
    ]).get(selectedType.name);
    if (!expected) unsupported('Replacement supports presentation and slide XML with unchanged element structure.');
    after = await openRetainedXmlDocument(values.read(replacement), context);
    const changed = !await equal(archive.read(part), values.read(replacement));
    const candidate: Archive = {
      async *parts() { check(); yield* archive.parts(); check(); }, async has(name) { check(); return archive.has(name); },
      async byteLength(name) { check(); return name === part ? replacement.length : archive.byteLength(name); },
      async *read(name) { check(); yield* name === part ? values.read(replacement) : archive.read(name); check(); }
    };
    try { await strict(before, after, expected); await validate(candidate); }
    catch (error) {
      if (!(error instanceof OfficeError) || error.code !== 'unsupported-edit') throw error;
      await strict(before, before, expected); await validate(archive);
      await structural(before, after); await guards(candidate); await strict(after, after, expected); await validate(candidate);
    }
    await before.close(); before = undefined; await after.close(); after = undefined; await graph.close(); graph = undefined; await types.close(); check();
    return Object.freeze({ ...candidate, changed, async replacement(name: string) { check(); return changed && name === part ? values.read(replacement) : undefined; }, close });
  } catch (error) { await close().catch(() => {}); throw error; }
}
