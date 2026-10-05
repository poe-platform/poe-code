import { SelectionError } from './selectors.js';
import { stageRetainedOutput, streamJson, type StagedOutput } from './retained-output.js';
import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource } from './contracts.js';
import { OfficeError } from './errors.js';
import { corePropertyDefinitions, type PropertyRecord } from './properties.js';
import { readRetainedPropertyValue } from './retained-property-value.js';
import { openRetainedPresentationIndex } from './retained-inspection.js';
import { openRetainedPresentationValidation } from './retained-validation.js';
import { openRetainedXmlDocument, type RetainedXmlDocument, type RetainedXmlNode } from './retained-xml-document.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import { RetainedValues, literal, equal, folded, characters } from './retained-values.js';
import type { XmlRange } from './retained-xml.js';
import { resourceContext } from './resource-limits.js';
import { dialects } from './validation-schema.js';

export interface RetainedPropertyRecord extends Omit<PropertyRecord, 'name' | 'namespace' | 'value' | 'part'> {
  name(): ByteSource;
  namespace(): ByteSource;
  readonly value: (() => ByteSource) | number | boolean | null;
  part(): ByteSource;
}
const coreNamespace = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const terms = 'http://purl.org/dc/terms/';
const customNamespaces = ['http://schemas.openxmlformats.org/officeDocument/2006/custom-properties', 'http://purl.oclc.org/ooxml/officeDocument/customProperties'];
const valueNamespaces = ['http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes', 'http://purl.oclc.org/ooxml/officeDocument/docPropsVTypes'];
const types = ['unknown', 'string', 'number', 'boolean', 'date'] as const;
const kinds = ['unknown', 'core', 'custom'] as const;
enum F { Next, Name, NameLength, Namespace, NamespaceLength, Part, PartLength, Value, ValueLength, Type, Kind, Scalar, Count }

/** Complete metadata admission with caller-backed ordered records. The archive
 * is borrowed; arbitrary names, namespaces and string values remain streams. */
export async function openRetainedProperties(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  fingerprint: string,
  query: { readonly name?: string },
  settings: RetainedPackageContext
) {
  if (!query || typeof query !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(query)) || Object.keys(query).some(key => key !== 'name')) throw new OfficeError('invalid-value', 'Invalid property options.', 'usage');
  if (query.name !== undefined && (typeof query.name !== 'string' || !query.name)) throw new OfficeError('invalid-value', 'Expected property name.', 'usage');
  const selected = query.name, context = resourceContext(settings), working = { ...settings.workingStorage }, signal = context.signal ?? new AbortController().signal;
  const index = await openRetainedPresentationIndex(archive, fingerprint, { ...context, workingStorage: working });
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, (working.cacheBytes ?? 1024 * 1024) / 16384);
  let closed = false, closing: Promise<void> | undefined, head = 0, tail = 0;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Properties are closed.', 'index'); if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'index'); };
  const close = () => { closed = true; return closing ??= (async () => { const outcomes = await Promise.allSettled([index.close(), pages.close()]); for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason; })(); };
  const values = new RetainedValues(pages, check, signal);
  const range = (row: number[], offset: number): XmlRange => ({ start: row[offset]!, length: row[offset + 1]! });
  async function row(pointer: number) { check(); const bytes = await pages.read(pointer, F.Count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return Array.from({ length: F.Count }, (_, n) => view.getFloat64(n * 8, true)); }
  async function write(pointer: number, numbers: number[]) { check(); const bytes = new Uint8Array(numbers.length * 8), view = new DataView(bytes.buffer); numbers.forEach((number, n) => view.setFloat64(n * 8, number, true)); await pages.write(pointer, bytes); }
  // Only admitted ZIP names or fixed-schema scalar values use this decoder.
  async function bounded(value: XmlRange) { const decoder = new TextDecoder(); let result = ''; for await (const bytes of values.read(value)) result += decoder.decode(bytes, { stream: true }); return result + decoder.decode(); }
  async function matches(document: RetainedXmlDocument, node: RetainedXmlNode, local: string, namespace: string) { return await equal(document.raw(node.localName), literal(local)) && await equal(document.namespace(node), literal(namespace)); }
  async function attribute(document: RetainedXmlDocument, node: RetainedXmlNode, local: string, namespace = '') { for await (const attr of document.attributes(node)) if (await matches(document, attr, local, namespace)) return attr; return undefined; }
  async function unknownType(document: RetainedXmlDocument, node: RetainedXmlNode) {
    const annotation = await attribute(document, node, 'type', 'http://www.w3.org/2001/XMLSchema-instance');
    if (!annotation) return false;
    if (!await equal(document.namespace(node), literal(terms))) return true;
    let colons = 0, local = '';
    for await (const char of characters(document.text(annotation))) { if (char === ':') { colons++; local = ''; } else if (local.length <= 6) local += char; }
    if (colons > 1 || local !== 'W3CDTF') return true;
    async function* prefix() { if (colons) for await (const char of characters(document.text(annotation!))) { if (char === ':') break; yield* literal(char); } }
    const resolved = await document.resolveNamespace(node, prefix);
    return !resolved || !await equal(resolved, literal(terms));
  }
  try {
    const validation = await openRetainedPresentationValidation(archive, { ...context, workingStorage: working }, { ...context.xmlLimits, ...context.relationshipLimits, maxBytes: Math.min(context.xmlLimits.maxBytes, context.relationshipLimits.maxBytes), maxEntries: context.archiveLimits.maxMembers });
    const valid = validation.valid; try { await validation.close(); } catch (error) { if (valid) await Promise.reject(error); }
    if (!valid) throw new OfficeError('invalid-opc', 'Invalid presentation graph.', 'validate-intent');
    for await (const part of archive.parts()) { const key = await values.store(folded(literal(part))), value = await values.store(literal(part)); await values.insert('parts', key, value); }
    const main = await openRetainedXmlDocument(archive.read(index.records.main), { ...context, workingStorage: working }); let dialect = dialects[0]!, failed = false;
    try { for (const candidate of dialects) if (await equal(main.namespace(main.root), literal(candidate.p))) dialect = candidate; }
    catch (error) { failed = true; throw error; }
    finally { try { await main.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
    for await (const edge of index.inventory.relationships) {
      if (edge.owner !== '/' || edge.external) continue;
      const core = await equal(edge.type(), literal('http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties'));
      if (!core && !await equal(edge.type(), literal(`${dialect.r}/custom-properties`))) continue;
      const original = edge.targetPart ? await values.find('parts', () => folded(edge.targetPart!())) : undefined;
      if (!original) throw new OfficeError('missing-binding', 'Package member is absent.', 'index');
      const part = await values.store(edge.targetPart!());
      const document = await openRetainedXmlDocument(archive.read(await bounded(original)), { ...context, workingStorage: working }); let failed = false;
      try {
        let admitted = core ? await matches(document, document.root, 'coreProperties', coreNamespace) : false;
        if (!core) for (const namespace of customNamespaces) if (await matches(document, document.root, 'Properties', namespace)) admitted = true;
        if (!admitted) throw new OfficeError('invalid-opc', 'Invalid metadata root.', 'index');
        for await (const node of document.children(document.root)) {
          if (node.kind !== 'element') continue;
          let definition: [string, readonly [string, string, PropertyRecord['type']]] | undefined;
          if (core) for (const [name, schema] of Object.entries(corePropertyDefinitions)) if (await matches(document, node, schema[1], schema[0])) { definition = [name, schema]; break; }
          const custom = !core && await equal(document.namespace(node), document.namespace(document.root)) && await equal(document.raw(node.localName), literal('property'));
          let valueNode: RetainedXmlNode | undefined, count = 0;
          if (custom) for await (const child of document.children(node)) if (child.kind === 'element') { valueNode = child; count++; }
          if (count !== 1) valueNode = undefined;
          let type: PropertyRecord['type'] = definition?.[1][2] ?? 'unknown';
          if (!definition && valueNode) for (const namespace of valueNamespaces) for (const [local, value] of Object.entries({ lpwstr: 'string', lpstr: 'string', bstr: 'string', i4: 'number', int: 'number', r8: 'number', bool: 'boolean', filetime: 'date' } as const)) if (await matches(document, valueNode, local, namespace)) type = value;
          if (await unknownType(document, node)) type = 'unknown';
          const nameAttribute = custom ? await attribute(document, node, 'name') : undefined;
          const name = await values.store(definition ? literal(definition[0]) : nameAttribute ? document.text(nameAttribute) : document.raw(node.localName));
          const namespace = await values.store(document.namespace(node));
          let value: XmlRange, scalar = false;
          if (type === 'string' || type === 'unknown') value = await values.store(document.text(valueNode ?? node));
          else { const decoded = await readRetainedPropertyValue(type, document.text(valueNode ?? node), check); scalar = typeof decoded !== 'string'; value = await values.store(literal(scalar ? JSON.stringify(Object.is(decoded, -0) ? '-0' : decoded) : decoded as string)); }
          const pointer = pages.allocate(F.Count * 8);
          await write(pointer, [0, name.start, name.length, namespace.start, namespace.length, part.start, part.length, value.start, value.length, types.indexOf(type), kinds.indexOf(definition ? 'core' : custom ? 'custom' : 'unknown'), Number(scalar)]);
          if (tail) await write(tail, [pointer]); else head = pointer; tail = pointer;
        }
      } catch (error) { failed = true; throw error; }
      finally { try { await document.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
    }
    await index.close();
    return Object.freeze({ close, async *records(): AsyncGenerator<RetainedPropertyRecord> {
      check();
      for (let pointer = head; pointer;) {
        const data = await row(pointer); pointer = data[F.Next]!;
        if (selected !== undefined && !await equal(values.read(range(data, F.Name)), literal(selected))) continue;
        const scalar = data[F.Scalar] ? JSON.parse(await bounded(range(data, F.Value))) as number | boolean | null | '-0' : undefined;
        yield { name: () => values.read(range(data, F.Name)), kind: kinds[data[F.Kind]!]!, type: types[data[F.Type]!]!, value: data[F.Scalar] ? scalar === '-0' ? -0 : scalar! : () => values.read(range(data, F.Value)), part: () => values.read(range(data, F.Part)), namespace: () => values.read(range(data, F.Namespace)) };
      }
      check();
    } });
  } catch (error) { await close().catch(() => {}); throw error instanceof OfficeError ? error : new OfficeError(signal.aborted ? 'cancelled' : 'io-failure', 'Property storage operation failed.', 'index'); }
}

/** Admit and stage complete property responses before a sink sees any bytes. */
export async function stageRetainedProperties(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  fingerprint: string,
  query: { readonly name?: string },
  settings: RetainedPackageContext,
  output: { readonly operation: 'properties.list' | 'properties.get'; readonly json: boolean; readonly maxOutputBytes: number }
): Promise<StagedOutput> {
  const format = { ...output };
  if (!['properties.list', 'properties.get'].includes(format.operation)) throw new OfficeError('invalid-value', 'Invalid property read operation.', 'usage');
  const properties = await openRetainedProperties(archive, fingerprint, query, settings); let staged: StagedOutput | undefined;
  try {
    if (format.operation === 'properties.get') { let count = 0; for await (const ignoredRecord of properties.records()) count++; if (count !== 1) throw new SelectionError(count ? 'ambiguous-selection' : 'missing-selection'); }
    async function* render(): ByteSource {
      if (format.json) { yield* streamJson({ version: 1, operation: format.operation, ok: true, data: { properties: properties.records() }, affected: 0, warnings: [], errors: [], locations: [] }); yield* literal('\n'); }
      else for await (const property of properties.records()) { yield* streamJson(property.name); yield* literal(': '); yield* streamJson(property.value); yield* literal('\n'); }
    }
    staged = await stageRetainedOutput(render(), settings, format.maxOutputBytes); await properties.close(); return staged;
  } catch (error) { await Promise.allSettled([properties.close(), staged?.close()]); throw error; }
}
