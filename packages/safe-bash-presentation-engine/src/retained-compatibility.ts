import { PagedStorage } from '@poe-code/safe-fs/storage';
import { ZipDirectoryIndex } from '@poe-code/office-package/zip';
import type { ByteSource } from './contracts.js';
import type { XmlName } from './xml.js';
import type { RetainedPackageContext } from './retained-package.js';
import type { XmlRange } from './retained-xml.js';
import { validateRetainedLocalName, type RetainedXmlDocument, type RetainedXmlNode } from './retained-xml-document.js';
import { RetainedValues, equal, literal } from './retained-values.js';
import { resourceContext } from './resource-limits.js';
import { OfficeError } from './errors.js';

export interface RetainedCompatibilityView {
  readonly dialect: 'strict' | 'transitional' | null;
  children(node: RetainedXmlNode): AsyncGenerator<RetainedXmlNode>;
  attributes(node: RetainedXmlNode): AsyncGenerator<RetainedXmlNode>;
  alternatives(): AsyncGenerator<{ readonly element: RetainedXmlNode; readonly selected: RetainedXmlNode | null }>;
  /** Retires view indexes; the original XML document remains caller-owned. */
  close(): Promise<void>;
}
const mc = 'http://schemas.openxmlformats.org/markup-compatibility/2006', xml = 'http://www.w3.org/XML/1998/namespace';
const controls = ['Ignorable', 'MustUnderstand', 'ProcessContent', 'PreserveElements', 'PreserveAttributes'];
const dialects = [
  ['http://purl.oclc.org/ooxml/presentationml/main', 'strict'], ['http://purl.oclc.org/ooxml/drawingml/main', 'strict'],
  ['http://schemas.openxmlformats.org/presentationml/2006/main', 'transitional'], ['http://schemas.openxmlformats.org/drawingml/2006/main', 'transitional']
] as const;
function invalid(): never { throw new OfficeError('invalid-xml', 'Invalid markup compatibility controls.', 'parse'); }
function unsupported(): never { throw new OfficeError('unsupported-profile', 'Required XML namespace is not understood.', 'parse'); }
enum V { Node, First, Last, Next, RawAttributes, Count }

/** Immutable compatibility projection. Rules, work stacks, flattened children
 * and alternate selections reside in the caller's storage, not JS collections. */
export async function openRetainedCompatibility(doc: RetainedXmlDocument, understoodNamespaces: readonly string[], settings: RetainedPackageContext,
  opaqueElements: readonly XmlName[] = [], expandOpaque?: (node: RetainedXmlNode) => boolean | Promise<boolean>): Promise<RetainedCompatibilityView> {
  if (!Array.isArray(understoodNamespaces) || understoodNamespaces.some(uri => typeof uri !== 'string' || !uri)
    || expandOpaque !== undefined && typeof expandOpaque !== 'function' || !Array.isArray(opaqueElements)
    || opaqueElements.some(name => !name || typeof name.namespace !== 'string' || typeof name.localName !== 'string' || !name.localName))
    throw new OfficeError('invalid-value', 'Expected understood namespaces and opaque element names.', 'usage');
  const understood = ['', xml, mc, ...understoodNamespaces], opaque = opaqueElements.map(name => ({ ...name }));
  const context = resourceContext(settings), working = { ...settings.workingStorage }, cacheBytes = working.cacheBytes ?? 1024 * 1024;
  if (!working.fs || typeof working.directory !== 'string' || !working.directory.startsWith('/') || !Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384)
    throw new OfficeError('invalid-value', 'Explicit compatibility working storage and a valid cache budget are required.', 'usage');
  const signal = context.signal ?? new AbortController().signal, pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, cacheBytes / 16384);
  const index = new ZipDirectoryIndex(pages, { signal });
  let closed = false, closing: Promise<void> | undefined, firstAlternative = 0, lastAlternative = 0;
  const check = () => {
    if (closed) throw new OfficeError('invalid-handle', 'Compatibility view is closed.', 'parse');
    if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'parse');
  };
  const close = () => { closed = true; return closing ??= pages.close(); };
  const failure = (error: unknown): unknown => error instanceof OfficeError ? error : new OfficeError(signal.aborted ? 'cancelled' : 'io-failure', 'Compatibility storage operation failed.', 'parse');
  const values = new RetainedValues(pages, check, signal);
  async function row(pointer: number, length: number): Promise<number[]> {
    check(); const bytes = await pages.read(pointer, length * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length }, (_, n) => view.getFloat64(n * 8, true));
  }
  async function write(pointer: number, data: number[]) {
    check(); const bytes = new Uint8Array(data.length * 8), view = new DataView(bytes.buffer);
    data.forEach((number, n) => view.setFloat64(n * 8, number, true)); await pages.write(pointer, bytes);
  }
  const local = (node: RetainedXmlNode, name: string) => equal(doc.raw(node.localName), literal(name));
  const namespace = (node: RetainedXmlNode, uri: string) => equal(doc.namespace(node), literal(uri));
  async function supported(source: () => ByteSource) { for (const uri of understood) if (await equal(source(), literal(uri))) return true; return false; }
  async function isOpaque(node: RetainedXmlNode) { for (const name of opaque) if (await local(node, name.localName) && await namespace(node, name.namespace)) return true; return false; }
  async function attribute(node: RetainedXmlNode, name: string, uri = mc): Promise<RetainedXmlNode | undefined> {
    for await (const attr of doc.attributes(node)) if (await local(attr, name) && await namespace(attr, uri)) return attr;
    return undefined;
  }
  async function* tokens(node: RetainedXmlNode | undefined): AsyncGenerator<XmlRange> {
    if (!node) return;
    const range = await values.store(doc.text(node)); let start = 0, length = 0, position = range.start;
    for await (const bytes of values.read(range)) for (const byte of bytes) {
      if (byte === 9 || byte === 10 || byte === 13 || byte === 32) { if (length) yield { start, length }; length = 0; }
      else { if (!length) start = position; length++; } position++;
    }
    if (length) yield { start, length };
  }
  async function prefixUri(node: RetainedXmlNode, prefix: XmlRange): Promise<XmlRange> {
    await validateRetainedLocalName(values.read(prefix));
    const uri = await doc.resolveNamespace(node, () => values.read(prefix)); if (!uri) invalid();
    const stored = await values.store(uri); if (!stored.length || await equal(values.read(stored), literal(mc))) invalid(); return stored;
  }
  async function rule(scope: number, kind: string, key: () => ByteSource): Promise<boolean> {
    for (let pointer = scope; pointer; pointer = (await row(pointer, 1))[0]!) if (await values.find(`${kind}${pointer}`, key)) return true;
    return false;
  }
  async function* expanded(uri: () => ByteSource, name: () => ByteSource): ByteSource { yield* uri(); yield* literal('\0'); yield* name(); }
  async function process(scope: number, node: RetainedXmlNode) {
    return await rule(scope, 'p', () => expanded(() => doc.namespace(node), () => doc.raw(node.localName)))
      || await rule(scope, 'p', () => expanded(() => doc.namespace(node), () => literal('*')));
  }
  async function rules(node: RetainedXmlNode, inherited: number): Promise<number> {
    const scope = pages.allocate(8); await write(scope, [inherited]);
    for await (const attr of doc.attributes(node)) if (await namespace(attr, mc)) {
      let recognized = false; for (const control of controls) if (await local(attr, control)) { recognized = true; break; }
      if (!recognized) invalid();
    }
    for await (const token of tokens(await attribute(node, 'Ignorable'))) {
      const uri = await prefixUri(node, token); await values.insert(`i${scope}`, uri, uri);
    }
    for await (const token of tokens(await attribute(node, 'MustUnderstand'))) await prefixUri(node, token);
    for (const control of ['ProcessContent', 'PreserveElements', 'PreserveAttributes']) for await (const token of tokens(await attribute(node, control))) {
      let colon = -1, position = token.start;
      for await (const bytes of values.read(token)) for (const byte of bytes) { if (byte === 58) { if (colon >= 0) invalid(); colon = position; } position++; }
      if (colon < 0) invalid();
      const uri = await prefixUri(node, { start: token.start, length: colon - token.start }), name = { start: colon + 1, length: token.start + token.length - colon - 1 };
      if (!await equal(values.read(name), literal('*'))) await validateRetainedLocalName(values.read(name));
      if (!await rule(scope, 'i', () => values.read(uri))) invalid();
      if (control === 'ProcessContent') { const key = await values.store(expanded(() => values.read(uri), () => values.read(name))); await values.insert(`p${scope}`, key, key); }
    }
    return scope;
  }
  async function mustUnderstand(node: RetainedXmlNode) {
    for await (const token of tokens(await attribute(node, 'MustUnderstand'))) {
      const uri = await prefixUri(node, token); if (!await supported(() => values.read(uri))) unsupported();
    }
  }
  async function wrapper(node: RetainedXmlNode, scope: number) {
    for await (const attr of doc.attributes(node)) {
      if (await namespace(attr, xml) || !await namespace(attr, '') && !await namespace(attr, mc) && !await rule(scope, 'i', () => doc.namespace(attr))) invalid();
      if (await namespace(attr, '') && !(await local(node, 'Choice') && await local(attr, 'Requires'))) invalid();
    }
  }
  async function checkAttributes(node: RetainedXmlNode, scope: number) {
    for await (const attr of doc.attributes(node)) if (!await namespace(attr, mc) && !await supported(() => doc.namespace(attr)) && !await rule(scope, 'i', () => doc.namespace(attr))) unsupported();
  }
  async function append(node: RetainedXmlNode, parent: number, rawAttributes: boolean) {
    const pointer = pages.allocate(V.Count * 8), data = new Array<number>(V.Count).fill(0), owner = await row(parent, V.Count);
    data[V.Node] = doc.reference(node); data[V.RawAttributes] = Number(rawAttributes); await write(pointer, data);
    if (owner[V.Last]) await write(owner[V.Last]! + V.Next * 8, [pointer]); else owner[V.First] = pointer;
    owner[V.Last] = pointer; await write(parent, owner); await index.set(String(data[V.Node]), pointer); return pointer;
  }
  async function viewRecord(node: RetainedXmlNode) {
    check(); const pointer = await index.get(String(doc.reference(node)));
    if (!pointer) throw new OfficeError('invalid-value', 'Expected a processed XML element.', 'usage'); return row(pointer, V.Count);
  }
  try {
    const rootOutput = pages.allocate(V.Count * 8); await write(rootOutput, new Array<number>(V.Count).fill(0));
    let top = pages.allocate(40); await write(top, [0, doc.reference(doc.root), 0, rootOutput, 0]);
    while (top) {
      const task = await row(top, 5); top = task[0]!;
      const node = await doc.node(task[1]!), scope = await rules(node, task[2]!), branch = Boolean(task[4]); let output = task[3]!;
      if (await namespace(node, mc) && !branch) {
        if (!await local(node, 'AlternateContent')) invalid(); await wrapper(node, scope); await mustUnderstand(node);
        let selected = 0, fallback = false, choices = 0;
        for await (const candidate of doc.children(node)) {
          if (candidate.kind !== 'element') continue;
          const candidateScope = await rules(candidate, scope);
          if (!await namespace(candidate, mc)) {
            if (!await rule(candidateScope, 'i', () => doc.namespace(candidate))) invalid();
            if (await supported(() => doc.namespace(candidate)) || await process(candidateScope, candidate)) unsupported(); continue;
          }
          await wrapper(candidate, candidateScope); await checkAttributes(candidate, candidateScope);
          if (await local(candidate, 'Choice') && !fallback) {
            choices++; const requires = await attribute(candidate, 'Requires', ''); if (!requires) invalid(); let count = 0, understood = true;
            for await (const token of tokens(requires)) { count++; const uri = await prefixUri(candidate, token); if (!await supported(() => values.read(uri))) understood = false; }
            if (!count) invalid(); if (!selected && understood) selected = doc.reference(candidate);
          } else if (await local(candidate, 'Fallback') && !fallback && choices) { fallback = true; if (!selected) selected = doc.reference(candidate); }
          else invalid();
        }
        if (!choices) invalid();
        const alternative = pages.allocate(24); await write(alternative, [0, doc.reference(node), selected]);
        if (lastAlternative) await write(lastAlternative, [alternative]); else firstAlternative = alternative; lastAlternative = alternative;
        if (selected) { await mustUnderstand(await doc.node(selected)); const pointer = pages.allocate(40); await write(pointer, [top, selected, scope, output, 1]); top = pointer; }
        continue;
      }
      const opaqueNode = await isOpaque(node);
      if (!branch) {
        const known = await supported(() => doc.namespace(node));
        if (!known && opaqueNode) { await mustUnderstand(node); await append(node, output, true); continue; }
        if (!known) {
          if (!await rule(scope, 'i', () => doc.namespace(node))) unsupported();
          if (!await process(scope, node)) continue;
          for await (const attr of doc.attributes(node)) if (await namespace(attr, xml) && (await local(attr, 'base') || await local(attr, 'lang') || await local(attr, 'space'))) invalid();
          await mustUnderstand(node);
        } else { await mustUnderstand(node); await checkAttributes(node, scope); output = await append(node, output, false); }
      }
      if (opaqueNode) { const expand = await expandOpaque?.(node); check(); if (!expand) continue; }
      let first = 0, last = 0;
      for await (const child of doc.children(node)) if (child.kind === 'element') {
        const pointer = pages.allocate(40); await write(pointer, [0, doc.reference(child), scope, output, 0]);
        if (last) await write(last, [pointer]); else first = pointer; last = pointer;
      }
      if (last) { await write(last, [top]); top = first; }
    }
    let dialect: RetainedCompatibilityView['dialect'] = null;
    for (const [uri, kind] of dialects) if (await namespace(doc.root, uri)) { dialect = kind; break; }
    check();
    return Object.freeze({ dialect, close,
      async *children(node: RetainedXmlNode) {
        try { for (let pointer = (await viewRecord(node))[V.First]!; pointer;) { const data = await row(pointer, V.Count); yield await doc.node(data[V.Node]!); pointer = data[V.Next]!; } }
        catch (error) { throw failure(error); }
      },
      async *attributes(node: RetainedXmlNode) {
        try { const data = await viewRecord(node); for await (const attr of doc.attributes(node)) { check(); if (!await namespace(attr, mc) && (data[V.RawAttributes] || await supported(() => doc.namespace(attr)))) yield attr; } }
        catch (error) { throw failure(error); }
      },
      async *alternatives() {
        try { check(); for (let pointer = firstAlternative; pointer;) { const data = await row(pointer, 3); yield Object.freeze({ element: await doc.node(data[1]!), selected: data[2] ? await doc.node(data[2]!) : null }); pointer = data[0]!; } }
        catch (error) { throw failure(error); }
      }
    });
  } catch (error) { await close().catch(() => {}); throw failure(error); }
}
