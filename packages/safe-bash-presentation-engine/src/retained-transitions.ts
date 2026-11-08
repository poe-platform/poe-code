import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { TransitionRecord } from './transitions.js';
import type { SelectionQuery } from './selectors.js';
import { SelectionError } from './selectors.js';
import { OfficeError } from './errors.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import { resourceContext } from './resource-limits.js';
import { openRetainedPresentationIndex } from './retained-inspection.js';
import { openRetainedPresentationValidation } from './retained-validation.js';
import { openRetainedXmlDocument, type RetainedXmlDocument, type RetainedXmlNode } from './retained-xml-document.js';
import { RetainedValues, characters, equal, literal } from './retained-values.js';
import { stageRetainedOutput, streamJson } from './retained-output.js';

const durationNamespace = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const compatibilityNamespace = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
async function transitionRecord(document: RetainedXmlDocument) {
  async function local(node: RetainedXmlNode, name: string) { return equal(document.raw(node.localName), literal(name)); }
  async function same(node: RetainedXmlNode, parent: RetainedXmlNode) { return equal(document.namespace(node), document.namespace(parent)); }
  async function attr(node: RetainedXmlNode | undefined, name: string, namespace = '') {
    if (node) for await (const value of document.attributes(node)) if (await local(value, name) && await equal(document.namespace(value), literal(namespace))) return value;
    return undefined;
  }
  async function token(node: RetainedXmlNode | undefined, tokens: readonly string[]) { if (node) for (const value of tokens) if (await equal(document.text(node), literal(value))) return value; return undefined; }
  let direct: RetainedXmlNode | undefined, wrapped = false;
  for await (const node of document.children(document.root)) if (node.kind === 'element' && await same(node, document.root) && await local(node, 'transition')) {
    if (direct) throw new OfficeError('invalid-xml', 'Multiple slide transitions.', 'parse'); direct = node;
  }
  for await (const node of document.children(document.root)) {
    if (node.kind !== 'element' || direct && document.reference(node) === document.reference(direct) || await local(node, 'cSld')) continue;
    for await (const nested of document.elements(node)) if (await same(nested, document.root) && await local(nested, 'transition')) { wrapped = true; break; }
    if (wrapped) break;
  }
  let kind: TransitionRecord['kind'] = direct || wrapped ? 'unsupported' : null, effect: RetainedXmlNode | undefined;
  if (direct && !wrapped) {
    let supported = true, sounds = 0, effects = 0;
    for await (const value of document.attributes(direct)) {
      const plain = await equal(document.namespace(value), literal(''));
      let allowed = await equal(document.namespace(value), literal(compatibilityNamespace)) || await equal(document.namespace(value), literal(durationNamespace)) && await local(value, 'dur');
      if (plain) for (const key of ['advTm', 'advClick', 'spd']) if (await local(value, key)) allowed = true;
      if (!allowed) supported = false;
    }
    for await (const node of document.children(direct)) if (node.kind === 'element') {
      if (await same(node, direct) && await local(node, 'sndAc')) sounds++;
      else { effects++; if (effects === 1) effect = node; }
    }
    if (sounds > 1 || effects !== 1 || !effect || !await same(effect, direct)) supported = false;
    let candidate: TransitionRecord['kind'] = 'unsupported';
    if (effect) {
      for (const name of ['cut', 'fade', 'push', 'wipe'] as const) if (await local(effect, name)) candidate = name;
      for await (const node of document.children(effect)) if (node.kind === 'element') supported = false;
      for await (const value of document.attributes(effect)) {
        const direction = candidate === 'push' || candidate === 'wipe';
        if (!await equal(document.namespace(value), literal('')) || !await local(value, direction ? 'dir' : 'thruBlk') || await token(value, direction ? ['l', 'r', 'u', 'd'] : ['0', 'false']) === undefined) supported = false;
      }
    }
    if (supported) kind = candidate;
  }
  async function milliseconds(node: RetainedXmlNode | undefined) {
    if (!node) return null;
    let started = false, trailing = false, digits = false, number = 0;
    const invalid = (): never => { throw new OfficeError('invalid-xml', 'Invalid transition millisecond metadata.', 'parse'); };
    for await (const character of characters(document.text(node))) {
      if (character.trim() === '') { if (started) trailing = true; continue; }
      if (trailing) invalid();
      if (!started && character === '+') { started = true; continue; }
      started = true;
      if (character < '0' || character > '9') invalid();
      digits = true; number = number * 10 + (character.charCodeAt(0) - 48); if (number > 2147483647) invalid();
    }
    if (!digits) invalid(); return number;
  }
  const duration = await milliseconds(await attr(direct, 'dur', durationNamespace)), advanceAfter = await milliseconds(await attr(direct, 'advTm'));
  const click = await attr(direct, 'advClick'), clickValue = await token(click, ['0', '1', 'true', 'false']);
  if (click && clickValue === undefined) throw new OfficeError('invalid-xml', 'Invalid transition click metadata.', 'parse');
  let direction: TransitionRecord['direction'] = null;
  if (kind === 'push' || kind === 'wipe') {
    const dir = await attr(effect, 'dir'), value = dir ? await token(dir, ['l', 'r', 'u', 'd']) : 'l';
    direction = ({ l: 'left', r: 'right', u: 'up', d: 'down' } as const)[value as 'l' | 'r' | 'u' | 'd'] ?? null;
  }
  return { kind, direction, duration: kind === 'cut' ? 0 : duration, advanceAfter, advanceOnClick: direct ? !['0', 'false'].includes(clickValue ?? 'true') : null };
}

/** Borrow the archive and own only bounded caches and caller-backed records. */
export async function openRetainedTransitions(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  fingerprint: string,
  options: { readonly selection?: SelectionQuery },
  settings: RetainedPackageContext
) {
  if (!options || Object.keys(options).some(key => key !== 'selection')) throw new OfficeError('invalid-value', 'Invalid transition query.', 'usage');
  const selection = options.selection ? { ...options.selection, kind: options.selection.kind ?? 'slide' as const, ...(options.selection.position ? { position: { ...options.selection.position } } : {}) } : undefined;
  const context = { ...resourceContext(settings), workingStorage: { ...settings.workingStorage } }, signal = context.signal ?? new AbortController().signal;
  const index = await openRetainedPresentationIndex(archive, fingerprint, context);
  const pages = new PagedStorage({ fs: context.workingStorage.fs, cwd: context.workingStorage.directory, env: {}, signal }, (context.workingStorage.cacheBytes ?? 1024 * 1024) / 16384);
  let closed = false, closing: Promise<void> | undefined, head = 0, tail = 0, count = 0;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'Transitions are closed.', 'index'); if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'index'); };
  const close = () => { closed = true; return closing ??= (async () => { const results = await Promise.allSettled([index.close(), pages.close()]); for (const result of results) if (result.status === 'rejected') throw result.reason; })(); };
  const failure = (error: unknown) => error instanceof OfficeError ? error : new OfficeError(signal.aborted ? 'cancelled' : 'io-failure', 'Transition storage operation failed.', 'index');
  const values = new RetainedValues(pages, check, signal);
  async function write(pointer: number, numbers: number[]) { const bytes = new Uint8Array(numbers.length * 8), view = new DataView(bytes.buffer); numbers.forEach((number, n) => view.setFloat64(n * 8, number, true)); await pages.write(pointer, bytes); }
  try {
    const validation = await openRetainedPresentationValidation(archive, context, { ...context.xmlLimits, ...context.relationshipLimits, maxBytes: Math.min(context.xmlLimits.maxBytes, context.relationshipLimits.maxBytes), maxEntries: context.archiveLimits.maxMembers });
    const valid = validation.valid; try { await validation.close(); } catch (error) { if (valid) await Promise.reject(error); }
    if (!valid) throw new OfficeError('invalid-opc', 'Invalid presentation graph.', 'validate-intent');
    if (selection) for await (const record of index.records.select(selection)) if (record.kind !== 'slide') throw new SelectionError('invalid-selection');
    for await (const record of selection ? index.records.select(selection) : index.records.records('slide')) {
      const document = await openRetainedXmlDocument(archive.read(record.part), context); let failed = false;
      try {
        const formatting = await transitionRecord(document);
        const value: TransitionRecord = { selector: record.token, location: record.location, slide: record.position, part: record.part, ...formatting };
        const stored = await values.store(literal(JSON.stringify(value))), pointer = pages.allocate(24);
        await write(pointer, [0, stored.start, stored.length]); if (tail) await write(tail, [pointer]); else head = pointer; tail = pointer; count++;
      } catch (error) { failed = true; throw error; }
      finally { try { await document.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
    }
    await index.close(); check();
    return Object.freeze({ close, count, async *records(): AsyncGenerator<TransitionRecord> {
      try {
        check(); for (let pointer = head; pointer;) {
          const bytes = await pages.read(pointer, 24), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); pointer = view.getFloat64(0, true);
          // Only fixed-schema scalars and ZIP-bounded part/token strings occur here.
          let json = ''; const decoder = new TextDecoder(); for await (const chunk of values.read({ start: view.getFloat64(8, true), length: view.getFloat64(16, true) })) json += decoder.decode(chunk, { stream: true });
          check(); yield JSON.parse(json + decoder.decode()) as TransitionRecord;
        } check();
      } catch (error) { throw failure(error); }
    } });
  } catch (error) { await close().catch(() => {}); throw failure(error); }
}

export async function stageRetainedTransitions(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  fingerprint: string,
  options: { readonly selection?: SelectionQuery },
  settings: RetainedPackageContext,
  output: { readonly operation: 'transitions.list' | 'transitions.get'; readonly json: boolean; readonly maxOutputBytes: number }
) {
  const format = { ...output }, reader = await openRetainedTransitions(archive, fingerprint, options, settings);
  let staged: Awaited<ReturnType<typeof stageRetainedOutput>> | undefined;
  async function* locations() { for await (const record of reader.records()) yield record.location; }
  async function* items() {
    for await (const record of reader.records()) if (record.kind !== null) yield { location: record.location, kind: record.kind, name: null, fields: (['direction', 'duration', 'advanceAfter', 'advanceOnClick'] as const).map(name => ({ name, value: { type: record[name] === null ? 'null' : typeof record[name], value: record[name] } })) };
  }
  async function* render() {
    if (format.json) { yield* streamJson({ version: 1, operation: format.operation, ok: true, data: { items: items() }, warnings: [], errors: [], affected: 0, locations: locations() }); yield* literal('\n'); }
    else for await (const record of reader.records()) if (record.kind !== null) yield* literal(`Slide ${record.slide}: ${record.kind}${record.direction ? ' ' + record.direction : ''}\n  Duration: ${record.duration === null ? 'unspecified' : record.duration + ' ms'}\n  Advance: ${record.advanceAfter === null ? 'manual' : record.advanceAfter + ' ms'}; click: ${record.advanceOnClick === null ? 'unspecified' : record.advanceOnClick ? 'enabled' : 'disabled'}\n`);
  }
  try {
    if (format.operation === 'transitions.get' && reader.count !== 1) throw new SelectionError(reader.count ? 'ambiguous-selection' : 'missing-selection');
    staged = await stageRetainedOutput(render(), settings, format.maxOutputBytes); await reader.close(); return staged;
  } catch (error) { await Promise.allSettled([reader.close(), staged?.close()]); throw error; }
}
