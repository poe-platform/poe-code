import { PagedStorage } from '@poe-code/safe-fs/storage';
import { stageRetainedXmlEdits, type RetainedXmlEdit } from '@poe-code/office-xml';
import type { ByteSource, Location } from './contracts.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import { asciiKey, partName } from './package-uri.js';
import { OfficeError } from './errors.js';
import { prepareSlideMutationOptions, type MutateSlidesOptions } from './slides.js';
import { SelectionError, type SelectionQuery } from './selectors.js';
import { openRetainedContentTypes } from './retained-content-types.js';
import { openRetainedRelationshipGraph } from './retained-relationship-graph.js';
import { openRetainedPresentationIndex } from './retained-inspection.js';
import { openRetainedPresentationValidation } from './retained-validation.js';
import { openRetainedXmlDocument, type RetainedXmlNode } from './retained-xml-document.js';
import { RetainedValues, literal, equal, characters } from './retained-values.js';
import { resourceContext } from './resource-limits.js';

type Archive = Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>;
export interface RetainedSlideSettings extends Archive {
  readonly changed: boolean;
  readonly affected: number;
  targets(): AsyncGenerator<Location>;
  replacement(part: string): Promise<ByteSource | undefined>;
  close(): Promise<void>;
}
function unsupported(message: string): never { throw new OfficeError('unsupported-edit', message, 'validate-intent'); }
async function contains(source: ByteSource, needles: readonly string[], lower = false) {
  const maximum = Math.max(...needles.map(value => value.length)); let window = '';
  for await (const character of characters(source)) { window = (window + (lower ? character.toLowerCase() : character)).slice(-maximum); if (needles.some(value => window.endsWith(value))) return true; }
  return false;
}
async function* escaped(text: string, quote: string): ByteSource {
  let buffer = '';
  for (const character of text) {
    buffer += character === '&' ? '&amp;' : character === '<' ? '&lt;' : character === '>' ? '&gt;' : character === quote ? quote === '"' ? '&quot;' : '&apos;' : character === '\t' ? '&#9;' : character === '\n' ? '&#10;' : character === '\r' ? '&#13;' : character;
    if (buffer.length >= 4096) { yield* literal(buffer); buffer = ''; }
  }
  if (buffer) yield* literal(buffer);
}

/** A validated caller-backed changed-part view. The original archive is borrowed;
 * when changed is false, callers retain their exact original archive bytes. */
export async function openRetainedSlideSettings(archive: Archive, fingerprint: string, options: Omit<MutateSlidesOptions, 'position'>, settings: RetainedPackageContext): Promise<RetainedSlideSettings> {
  const context = resourceContext(settings), workingStorage = { ...settings.workingStorage }, signal = context.signal ?? new AbortController().signal, resources = { ...context, workingStorage, signal };
  const prepared = prepareSlideMutationOptions(options, context);
  if ('position' in options) throw new OfficeError('invalid-value', 'Slide settings do not reorder slides.', 'usage');
  const queries = prepared.map(query => ({ ...query, ...(query.position ? { position: { ...query.position } } : {}) })) as SelectionQuery[];
  const name = options.name, hidden = options.hidden, allowEmpty = options.allowEmpty;
  const limits = { ...context.xmlLimits, ...context.relationshipLimits, maxBytes: Math.min(context.xmlLimits.maxBytes, context.relationshipLimits.maxBytes), maxEntries: context.archiveLimits.maxMembers };
  // Validate storage before constructing caches or opening archive members.
  if (!workingStorage.fs || !workingStorage.directory?.startsWith('/') || workingStorage.cacheBytes !== undefined && (!Number.isSafeInteger(workingStorage.cacheBytes) || workingStorage.cacheBytes < 16384 || workingStorage.cacheBytes % 16384)) throw new OfficeError('invalid-value', 'Explicit slide mutation storage and a valid cache budget are required.', 'usage');
  const pages = new PagedStorage({ fs: workingStorage.fs, cwd: workingStorage.directory, env: {}, signal }, (workingStorage.cacheBytes ?? 1024 * 1024) / 16384);
  let closed = false, closing: Promise<void> | undefined, first = 0, last = 0, affected = 0, changed = false;
  let types: Awaited<ReturnType<typeof openRetainedContentTypes>> | undefined, graph: Awaited<ReturnType<typeof openRetainedRelationshipGraph>> | undefined, index: Awaited<ReturnType<typeof openRetainedPresentationIndex>> | undefined;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Slide mutation is closed.', 'serialize'); if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'serialize'); };
  const close = () => { closed = true; return closing ??= (async () => { const results = await Promise.allSettled([types?.close(), graph?.close(), index?.close(), pages.close()]); for (const result of results) if (result.status === 'rejected') throw result.reason; })(); };
  const values = new RetainedValues(pages, check, signal);
  async function write(pointer: number, row: number[]) { const bytes = new Uint8Array(row.length * 8), view = new DataView(bytes.buffer); row.forEach((value, i) => view.setFloat64(i * 8, value, true)); await pages.write(pointer, bytes); }
  async function row(pointer: number, count: number) { const bytes = await pages.read(pointer, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return Array.from({ length: count }, (_, i) => view.getFloat64(i * 8, true)); }
  async function* entries(): AsyncGenerator<{ location: Location; part: string }> { check(); for (let pointer = first; pointer;) { const item = await row(pointer, 3); let text = ''; const decoder = new TextDecoder(); for await (const bytes of values.read({ start: item[1]!, length: item[2]! })) text += decoder.decode(bytes, { stream: true }); yield JSON.parse(text + decoder.decode()) as { location: Location; part: string }; pointer = item[0]!; check(); } }
  async function replacement(part: string): Promise<ByteSource | undefined> { check(); const value = await values.find('changes', () => literal(asciiKey(partName(part, false)))); return value ? values.read(value) : undefined; }
  const candidate: Archive = {
    async *parts() { check(); for await (const part of archive.parts()) { check(); yield part; } },
    async has(part) { check(); return archive.has(part); },
    async byteLength(part) { check(); return (await values.find('changes', () => literal(asciiKey(partName(part, false)))))?.length ?? archive.byteLength(part); },
    async *read(part) { check(); const value = await replacement(part); if (value) yield* value; else yield* archive.read(part); check(); }
  };
  try {
    types = await openRetainedContentTypes(archive.read('/[Content_Types].xml'), resources, limits);
    graph = await openRetainedRelationshipGraph(archive, { ...resources, xmlLimits: { ...context.xmlLimits, maxBytes: context.relationshipLimits.maxBytes } });
    for await (const part of archive.parts()) if (part !== '/[Content_Types].xml' && (part.toLowerCase().startsWith('/_xmlsignatures/') || await contains(await types.get(part), ['digital-signature', 'macroenabled', 'vbaproject'], true))) unsupported('Signed and macro-enabled packages cannot be changed.');
    async function* owners() { yield '/'; yield* graph!.parts(); }
    for await (const owner of owners()) for await (const edge of graph.outgoing(owner)) {
      if (await contains(edge.type(), ['/digital-signature/'])) unsupported('Signed and macro-enabled packages cannot be changed.');
      let suffix = ''; for await (const character of characters(edge.type())) suffix = (suffix + character).slice(-11); if (suffix === '/vbaProject') unsupported('Signed and macro-enabled packages cannot be changed.');
    }
    await types.close(); types = undefined; await graph.close(); graph = undefined;
    const validation = await openRetainedPresentationValidation(archive, resources, limits); const valid = validation.valid; await validation.close();
    if (!valid) throw new OfficeError('invalid-opc', 'Slide editing requires a valid presentation graph.', 'validate-intent');
    index = await openRetainedPresentationIndex(archive, fingerprint, resources);
    for (const query of queries) {
      try { for await (const record of index.records.select(query)) {
        if (record.kind !== 'slide' || await values.find('selected', () => literal(record.id))) throw new SelectionError('invalid-selection');
        const id = await values.store(literal(record.id)); await values.insert('selected', id, id);
        const target = await values.store(literal(JSON.stringify({ location: record.location, part: record.part }))), pointer = pages.allocate(24); await write(pointer, [0, target.start, target.length]);
        if (last) await write(last, [pointer]); else first = pointer; last = pointer; affected++;
      } } catch (error) { if (!(allowEmpty && error instanceof SelectionError && error.code === 'missing-selection')) throw error; }
    }
    const presentation = await openRetainedXmlDocument(archive.read(index.records.main), resources); let failed = false;
    try {
      let stack = pages.allocate(16); await write(stack, [0, presentation.reference(presentation.root)]);
      while (stack) {
        const frame = await row(stack, 2); stack = frame[0]!; const node = await presentation.node(frame[1]!);
        if (node.kind !== 'element') continue;
        if (await equal(presentation.namespace(node), literal('http://schemas.openxmlformats.org/markup-compatibility/2006'))) unsupported('Conditional presentation structure cannot be changed.');
        if (await equal(presentation.raw(node.localName), literal('modifyVerifier')) && await equal(presentation.namespace(node), presentation.namespace(presentation.root))) unsupported('Protected presentations cannot be changed.');
        for await (const child of presentation.children(node)) { const pointer = pages.allocate(16); await write(pointer, [stack, presentation.reference(child)]); stack = pointer; }
      }
    } catch (error) { failed = true; throw error; } finally { try { await presentation.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
    for await (const target of entries()) {
      const document = await openRetainedXmlDocument(archive.read(target.part), resources); let failed = false;
      try {
        const changes: { node: number; attribute: string; value: string | null; existing: boolean }[] = [];
        async function attr(node: RetainedXmlNode, key: string) { for await (const value of document.attributes(node)) if (await equal(document.namespace(value), literal('')) && await equal(document.raw(value.localName), literal(key))) return value; return undefined; }
        if (name !== undefined) {
          let common: RetainedXmlNode | undefined;
          for await (const child of document.children(document.root)) if (child.kind === 'element' && await equal(document.namespace(child), document.namespace(document.root)) && await equal(document.raw(child.localName), literal('cSld'))) { if (common) throw new OfficeError('ambiguous-selection', 'Ambiguous presentation structure.', 'select'); common = child; }
          if (!common) unsupported('Conditional slide labels cannot be changed.');
          const value = await attr(common, 'name');
          if (!await equal(value ? document.text(value) : literal(''), literal(name))) changes.push({ node: common.name.start, attribute: 'name', value: name || null, existing: Boolean(value) });
        }
        if (hidden !== undefined) {
          const value = await attr(document.root, 'show'); let show = '', started = false, trailing = false;
          if (value) for await (const character of characters(document.text(value))) { if (!character.trim()) { if (started) trailing = true; } else { if (trailing || show.length >= 5) throw new OfficeError('invalid-opc', 'Invalid slide visibility.', 'validate-intent'); started = true; show += character; } }
          if (value && !['0','1','true','false'].includes(show)) throw new OfficeError('invalid-opc', 'Invalid slide visibility.', 'validate-intent');
          if ((show === '0' || show === 'false') !== hidden) changes.push({ node: document.root.name.start, attribute: 'show', value: hidden ? '0' : '1', existing: Boolean(value) });
        }
        if (changes.length) {
          const mutation = await stageRetainedXmlEdits(archive.read(target.part), async function* (xml): AsyncGenerator<RetainedXmlEdit> {
            let active: (typeof changes)[number] | undefined, attributeStart = 0, matching = false;
            for await (const token of xml.tokens()) {
              if (token.kind === 'start-name') { active = changes.find(change => change.node === token.range.start); matching = false; }
              else if (active && token.kind === 'attribute-name') { attributeStart = token.range.start; matching = await equal(xml.read(token.range), literal(active.attribute)); }
              else if (active && token.kind === 'attribute-value') {
                if (matching) {
                  if (active.value === null) yield { range: { start: attributeStart, length: token.range.start + token.range.length + 1 - attributeStart }, replacement: literal('') };
                  else { let quote = '"'; for await (const bytes of xml.read({ start: token.range.start - 1, length: 1 })) quote = String.fromCharCode(bytes[0]!); yield { range: token.range, replacement: escaped(active.value, quote) }; }
                }
              } else if (active && token.kind === 'start-end') {
                if (!active.existing && active.value !== null) { const change = active; yield { range: { start: token.range.start - (token.empty ? 2 : 1), length: 0 }, replacement: (async function* () { yield* literal(` ${change.attribute}="`); yield* escaped(change.value!, '"'); yield* literal('"'); })() }; }
                active = undefined;
              }
            }
          }, resources);
          let mutationFailed = false;
          try { const value = await values.store(mutation.bytes()), key = await values.store(literal(asciiKey(target.part))); await values.insert('changes', key, value); changed = true; } catch (error) { mutationFailed = true; throw error; } finally { try { await mutation.close(); } catch (error) { if (!mutationFailed) await Promise.reject(error); } }
        }
      } catch (error) { failed = true; throw error; } finally { try { await document.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
    }
    if (changed) { const result = await openRetainedPresentationValidation(candidate, resources, limits); const valid = result.valid; await result.close(); if (!valid) throw new OfficeError('invalid-opc', 'Changed slides fail graph validation.', 'validate-result'); }
    await index.close(); index = undefined; check();
    return Object.freeze({ ...candidate, changed, affected, replacement, async *targets() { for await (const entry of entries()) yield entry.location; }, close });
  } catch (error) { await close().catch(() => {}); throw error; }
}
