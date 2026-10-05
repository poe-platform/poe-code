import type { PresentationSettings } from './presentation-settings.js';
import type { ByteSource } from './contracts.js';
import { OfficeError } from './errors.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import { openRetainedPresentationIndex } from './retained-inspection.js';
import { openRetainedPresentationValidation } from './retained-validation.js';
import { openRetainedContentTypes } from './retained-content-types.js';
import { openRetainedXmlDocument, type RetainedXmlDocument as Document, type RetainedXmlNode as Node } from './retained-xml-document.js';
import { resourceContext } from './resource-limits.js';
import { dialects } from './validation-schema.js';
import { characters, literal, equal } from './retained-values.js';
import { stageRetainedOutput, streamJson, type StagedOutput } from './retained-output.js';

export interface RetainedPresentationSettingsValue extends Omit<PresentationSettings, 'printProperties' | 'viewProperties'> {
  readonly printProperties: { readonly part: string; xml(): ByteSource } | null;
  readonly viewProperties: { readonly part: string; xml(): ByteSource } | null;
}

const invalid = (message: string): never => { throw new OfficeError('invalid-opc', message, 'index'); };
async function child(document: Document, parent: Node, name: string) {
  let found: Node | undefined;
  for await (const node of document.children(parent)) if (node.kind === 'element' && await equal(document.raw(node.localName), literal(name)) && await equal(document.namespace(node), document.namespace(parent))) {
    if (found) invalid('Duplicate presentation setting.'); found = node;
  }
  return found;
}
async function attribute(document: Document, node: Node, name: string) {
  for await (const value of document.attributes(node)) if (await equal(document.raw(value.localName), literal(name)) && await equal(document.namespace(value), literal(''))) return value;
  return undefined;
}
async function numeric(document: Document, node: Node | undefined, name: string) {
  const value = node && await attribute(document, node, name); if (!value) return null;
  let started = false, ended = false, digits = false, negative = false, number = 0;
  for await (const character of characters(document.text(value))) {
    if (character.trim() === '') { if (started) ended = true; continue; }
    if (ended) invalid('Invalid numeric presentation setting.');
    if (!started && (character === '+' || character === '-')) { negative = character === '-'; started = true; continue; }
    started = true;
    if (character < '0' || character > '9') invalid('Invalid numeric presentation setting.');
    digits = true; number = number * 10 + (character.charCodeAt(0) - 48);
    if (!Number.isSafeInteger(number)) invalid('Invalid numeric presentation setting.');
  }
  if (!digits) invalid('Invalid numeric presentation setting.');
  return negative ? -number : number;
}
async function* escaped(source: ByteSource): ByteSource {
  let buffer = '';
  for await (const character of characters(source)) {
    buffer += ({ '&': '&amp;', '<': '&lt;', '"': '&quot;', '\t': '&#9;', '\n': '&#10;', '\r': '&#13;' } as Record<string, string>)[character] ?? character;
    if (buffer.length >= 2048) { yield* literal(buffer); buffer = ''; }
  }
  if (buffer) yield* literal(buffer);
}
// Print properties are a direct child of the admitted properties root. Root
// declarations provide all inherited bindings, in original insertion order.
async function* standalone(document: Document, node: Node, maxCharacters: number): ByteSource {
  async function* declarations(): ByteSource {
    if (node === document.root) return;
    for await (const inherited of document.declarations(document.root)) {
      if (await equal(document.raw(inherited.name), literal('xmlns:xml'))) continue;
      let local = false;
      for await (const own of document.declarations(node)) if (await equal(document.raw(own.name), document.raw(inherited.name))) { local = true; break; }
      if (local) continue;
      yield* literal(' '); yield* document.raw(inherited.name); yield* literal('="'); yield* escaped(document.text(inherited)); yield* literal('"');
    }
  }
  async function* markup(): ByteSource {
    let remaining = node.name.length + 1;
    for await (const bytes of document.markup(node)) {
      if (remaining) { const size = Math.min(remaining, bytes.length); yield bytes.subarray(0, size); remaining -= size; if (!remaining) yield* declarations(); if (size < bytes.length) yield bytes.subarray(size); }
      else yield bytes;
    }
  }
  let count = 0; const decoder = new TextDecoder();
  for await (const bytes of markup()) { count += decoder.decode(bytes, { stream: true }).length; if (count > maxCharacters) throw new OfficeError('resource-limit', 'XML resource limit exceeded.', 'parse'); yield bytes; }
  count += decoder.decode().length;
  if (count > maxCharacters) throw new OfficeError('resource-limit', 'XML resource limit exceeded.', 'parse');
}

/** Retained presentation settings; arbitrary print/view XML stays in caller storage. */
export async function openRetainedPresentationSettings(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  fingerprint: string,
  settings: RetainedPackageContext
) {
  const context = { ...resourceContext(settings), workingStorage: { ...settings.workingStorage } };
  const index = await openRetainedPresentationIndex(archive, fingerprint, context), owned: { close(): Promise<void> }[] = [index];
  let closed = false, closing: Promise<void> | undefined;
  const close = () => { closed = true; return closing ??= (async () => { const results = await Promise.allSettled(owned.map(item => item.close())); for (const result of results) if (result.status === 'rejected') throw result.reason; })(); };
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Settings are closed.', 'index'); if (context.signal?.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'index'); };
  try {
    const validation = await openRetainedPresentationValidation(archive, context, { ...context.xmlLimits, ...context.relationshipLimits, maxBytes: Math.min(context.xmlLimits.maxBytes, context.relationshipLimits.maxBytes), maxEntries: context.archiveLimits.maxMembers });
    const valid = validation.valid; try { await validation.close(); } catch (error) { if (valid) await Promise.reject(error); }
    if (!valid) throw new OfficeError('invalid-opc', 'Settings require a valid presentation graph.', 'validate-intent');
    const types = await openRetainedContentTypes(archive.read('/[Content_Types].xml'), context); owned.push(types);
    const main = await openRetainedXmlDocument(archive.read(index.records.main), context); owned.push(main);
    let dialect = dialects[0]!; for (const candidate of dialects) if (await equal(main.namespace(main.root), literal(candidate.p))) dialect = candidate;
    async function related(kind: 'presProps' | 'viewProps') {
      let count = 0, external = false, part: string | undefined;
      for await (const edge of index.graph.outgoing(index.records.main)) if (await equal(edge.type(), literal(`${dialect.r}/${kind}`))) {
        count++; external ||= edge.external;
        // Resolved ZIP members bound this name. Relationship payloads remain streamed.
        if (edge.targetPart) { const decoder = new TextDecoder(); part = ''; for await (const bytes of edge.targetPart()) part += decoder.decode(bytes, { stream: true }); part += decoder.decode(); }
      }
      const label = kind === 'presProps' ? 'presentation' : 'view';
      if (count > 1 || external) invalid(`Ambiguous ${label} properties.`);
      if (!part) return undefined;
      if (!await equal(await types.get(part), literal(`application/vnd.openxmlformats-officedocument.presentationml.${kind}+xml`))) invalid(`Invalid ${label} properties content type.`);
      const document = await openRetainedXmlDocument(archive.read(part), context); owned.push(document);
      if (!await equal(document.namespace(document.root), literal(dialect.p)) || !await equal(document.raw(document.root.localName), literal(kind === 'presProps' ? 'presentationPr' : 'viewPr'))) invalid(`Invalid ${label} properties root.`);
      return { part, document };
    }
    const properties = await related('presProps'), view = await related('viewProps');
    // Admit XML serialization before scalar settings, preserving eager error order.
    const viewXml = view ? () => standalone(view.document, view.document.root, context.xmlLimits.maxBytes) : undefined;
    if (viewXml) for await (const ignored of viewXml()) check();
    const print = properties && await child(properties.document, properties.document.root, 'prnPr');
    const slide = await child(main, main.root, 'sldSz'), notes = await child(main, main.root, 'notesSz');
    const width = await numeric(main, slide, 'cx'), height = await numeric(main, slide, 'cy'), notesWidth = await numeric(main, notes, 'cx'), notesHeight = await numeric(main, notes, 'cy');
    const show = properties && await child(properties.document, properties.document.root, 'showPr');
    const loopAttribute = show && await attribute(properties!.document, show, 'loop'); let loop = '';
    if (loopAttribute) { let trailing = false; for await (const character of characters(properties!.document.text(loopAttribute))) {
      if (character.trim() === '') { if (loop) trailing = true; continue; }
      if (trailing || loop.length >= 5) invalid('Invalid slideshow loop setting.'); loop += character;
    } if (!['0', '1', 'true', 'false'].includes(loop)) invalid('Invalid slideshow loop setting.'); }
    let mode = '', count = 0;
    if (show) for (const name of ['present', 'browse', 'kiosk']) if (await child(properties!.document, show, name)) { mode = name; count++; }
    if (count > 1) invalid('Ambiguous slideshow mode.');
    const slideNumberStart = await numeric(main, main.root, 'firstSlideNum') ?? 1;
    if (slideNumberStart < -2147483648 || slideNumberStart > 2147483647) invalid('Invalid slide numbering value.');
    const printXml = print ? () => standalone(properties!.document, print, context.xmlLimits.maxBytes) : undefined;
    if (printXml) for await (const ignored of printXml()) check();
    const value: RetainedPresentationSettingsValue = { width, height, orientation: width === null || height === null ? null : width >= height ? 'landscape' : 'portrait', notesWidth, notesHeight,
      notesOrientation: notesWidth === null || notesHeight === null ? null : notesWidth >= notesHeight ? 'landscape' : 'portrait', slideNumberStart, loop: loop === '1' || loop === 'true', showType: mode === 'browse' ? 'window' : mode === 'kiosk' ? 'kiosk' : 'speaker',
      printProperties: printXml ? { part: properties!.part, xml: printXml } : null, viewProperties: viewXml ? { part: view!.part, xml: viewXml } : null };
    check(); return Object.freeze({ close, settings() { check(); return value; }, async *locations() { check(); for await (const record of index.records.records('part')) if (record.scope === 'presentation') yield record.location; check(); } });
  } catch (error) { await close().catch(() => {}); throw error instanceof OfficeError ? error : new OfficeError(context.signal?.aborted ? 'cancelled' : 'io-failure', 'Settings storage operation failed.', 'index'); }
}

// The human response has a fixed-depth schema; only XML scalar values stream.
async function* pretty(value: unknown, depth = 0): ByteSource {
  if (value && typeof value === 'object') {
    const array = Array.isArray(value), entries = array ? value.map((item, i) => [String(i), item] as const) : Object.entries(value);
    yield* literal(array ? '[\n' : '{\n'); let first = true;
    for (const [key, item] of entries) { if (!first) yield* literal(',\n'); first = false; yield* literal('  '.repeat(depth + 1)); if (!array) yield* literal(JSON.stringify(key) + ': '); yield* pretty(item, depth + 1); }
    yield* literal('\n' + '  '.repeat(depth) + (array ? ']' : '}'));
  } else yield* streamJson(value);
}
export async function stageRetainedPresentationSettings(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  fingerprint: string,
  settings: RetainedPackageContext,
  output: { readonly operation: 'settings.list' | 'settings.get'; readonly json: boolean; readonly maxOutputBytes: number }
): Promise<StagedOutput> {
  const format = { ...output };
  if (!['settings.list', 'settings.get'].includes(format.operation)) throw new OfficeError('invalid-value', 'Invalid settings read operation.', 'usage');
  const view = await openRetainedPresentationSettings(archive, fingerprint, settings); let staged: StagedOutput | undefined;
  try {
    const data = { fingerprint, ...(format.operation === 'settings.list' ? { records: [view.settings()] } : { settings: view.settings() }) };
    async function* render(): ByteSource { if (format.json) yield* streamJson({ version: 1, operation: format.operation, ok: true, data, warnings: [], errors: [], affected: 0, locations: view.locations() }); else yield* pretty(data); yield* literal('\n'); }
    staged = await stageRetainedOutput(render(), settings, format.maxOutputBytes); await view.close(); return staged;
  } catch (error) { await Promise.allSettled([view.close(), staged?.close()]); throw error; }
}
