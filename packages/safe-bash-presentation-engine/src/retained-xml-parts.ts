import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ValidationLimits } from './validation.js';
import type { ByteSource, Location } from './contracts.js';
import { OfficeError } from './errors.js';
import { partName, packageUri } from './package-uri.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import { openRetainedContentTypes } from './retained-content-types.js';
import { openRetainedXml, type RetainedXml } from './retained-xml.js';
import { openRetainedXmlDocument } from './retained-xml-document.js';
import { characters, literal } from './retained-values.js';
import { stageRetainedOutput, streamJson, type StagedOutput } from './retained-output.js';
import { openRetainedPresentationIndex, type RetainedInspectionSelection } from './retained-inspection.js';
import { SelectionError } from './selectors.js';
import type { RetainedSelectionRecord } from './retained-selection.js';

export interface RetainedXmlPartContext extends RetainedPackageContext { readonly validationLimits?: ValidationLimits }
type Archive = Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>;
export interface RetainedXmlPart {
  readonly part: string;
  readonly format: 'original' | 'pretty';
  bytes(): ByteSource;
  xml(): ByteSource;
  close(): Promise<void>;
}
// A stored tree of source spans permits pretty traversal without a JS stack or
// collecting long text, opening tags, or namespace declarations.
enum F { Parent, First, Last, Next, Start, Open, Close, End, Mixed, Count }
async function prettySpans(xml: RetainedXml, settings: RetainedPackageContext) {
  const working = settings.workingStorage, signal = settings.signal ?? new AbortController().signal;
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, (working.cacheBytes ?? 1024 * 1024) / 16384);
  async function row(pointer: number) { const bytes = await pages.read(pointer, F.Count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return Array.from({ length: F.Count }, (_, i) => view.getFloat64(i * 8, true)); }
  async function save(pointer: number, row: number[]) { const bytes = new Uint8Array(F.Count * 8), view = new DataView(bytes.buffer); row.forEach((value, i) => view.setFloat64(i * 8, value, true)); await pages.write(pointer, bytes); }
  let current = 0, root = 0;
  try {
    for await (const token of xml.tokens()) {
      if (token.kind === 'start-name') {
        const pointer = pages.allocate(F.Count * 8), value = Array<number>(F.Count).fill(0); value[F.Parent] = current; value[F.Start] = token.range.start - 1;
        if (current) { const parent = await row(current); if (parent[F.Last]) { const previous = await row(parent[F.Last]!); previous[F.Next] = pointer; await save(parent[F.Last]!, previous); } else parent[F.First] = pointer; parent[F.Last] = pointer; await save(current, parent); }
        else root = pointer;
        await save(pointer, value); current = pointer;
      } else if (token.kind === 'start-end') {
        const value = await row(current); value[F.Open] = token.range.start;
        if (token.empty) value[F.End] = token.range.start;
        await save(current, value); if (token.empty) current = value[F.Parent]!;
      } else if (token.kind === 'end-name') {
        const value = await row(current); value[F.Close] = token.range.start - 2;
        let end = token.range.start + token.range.length;
        outer: for await (const bytes of xml.read({ start: end, length: xml.byteLength - end })) for (const byte of bytes) { end++; if (byte === 62) break outer; }
        value[F.End] = end; await save(current, value); current = value[F.Parent]!;
      } else if (current && ['text', 'comment', 'cdata', 'instruction'].includes(token.kind)) {
        let mixed = token.kind !== 'text';
        if (!mixed) for await (const character of characters(xml.value(token.range))) if (character.trim()) { mixed = true; break; }
        if (mixed) { const value = await row(current); value[F.Mixed] = 1; await save(current, value); }
      }
    }
    const formatted = !(await row(root))[F.Mixed] && Boolean((await row(root))[F.First]);
    async function* indent(depth: number): ByteSource { yield* literal('\n'); const spaces = new Uint8Array(4096).fill(32); for (let left = depth * 2; left; left -= Math.min(left, spaces.length)) yield spaces.subarray(0, Math.min(left, spaces.length)); }
    async function* render(): ByteSource {
      let pointer = root, depth = 0, returning = false;
      while (pointer) {
        signal.throwIfAborted(); const value = await row(pointer);
        if (returning) { yield* indent(depth); yield* xml.read({ start: value[F.Close]!, length: value[F.End]! - value[F.Close]! }); }
        else if (value[F.Mixed] || !value[F.First]) yield* xml.read({ start: value[F.Start]!, length: value[F.End]! - value[F.Start]! });
        else { yield* xml.read({ start: value[F.Start]!, length: value[F.Open]! - value[F.Start]! }); pointer = value[F.First]!; depth++; yield* indent(depth); continue; }
        if (value[F.Next]) { pointer = value[F.Next]!; returning = false; yield* indent(depth); }
        else { pointer = value[F.Parent]!; depth--; returning = true; }
      }
    }
    return { formatted, render, close: () => pages.close() };
  } catch (error) { await pages.close().catch(() => {}); throw error; }
}

/** Borrow an admitted archive; all decoded XML and pretty state use caller storage. */
export async function openRetainedXmlPart(archive: Archive, requested: string, settings: RetainedXmlPartContext, options: { readonly pretty?: boolean } = {}): Promise<RetainedXmlPart> {
  if (Object.keys(options).some(key => key !== 'pretty') || options.pretty !== undefined && typeof options.pretty !== 'boolean') throw new OfficeError('invalid-value', 'Invalid XML display options.', 'usage');
  settings = { ...settings, workingStorage: { ...settings.workingStorage }, ...(settings.validationLimits ? { validationLimits: { ...settings.validationLimits } } : {}) };
  const pretty = options.pretty ?? false, part = partName(requested, false), limits = settings.validationLimits;
  if (!limits) throw new OfficeError('invalid-value', 'XML operations require explicit validation limits.', 'usage');
  if (part !== requested || !await archive.has(part)) throw new OfficeError('missing-selection', 'An exact existing package part is required.', 'select');
  if (part !== '/[Content_Types].xml') {
    const types = await openRetainedContentTypes(archive.read('/[Content_Types].xml'), { ...settings, xmlLimits: { maxBytes: limits.maxBytes, maxNodes: Infinity, maxDepth: Infinity } }, limits); let failed = false;
    try {
      let prefix = '', suffix = '';
      for await (const character of characters(await types.get(part))) { if (character === ';') break; if (!character.trim()) continue; if (prefix.length < 16) prefix += character.toLowerCase(); suffix = (suffix + character.toLowerCase()).slice(-4); }
      if (prefix !== 'application/xml' && prefix !== 'text/xml' && suffix !== '+xml') throw new OfficeError('unsupported-profile', 'The selected part is not XML.', 'select');
    } catch (error) { failed = true; throw error; } finally { try { await types.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
  }
  const context = { ...settings, xmlLimits: limits };
  const document = await openRetainedXmlDocument(archive.read(part), context); await document.close();
  const xml = await openRetainedXml(archive.read(part), context); let spans: Awaited<ReturnType<typeof prettySpans>> | undefined, closed = false, closing: Promise<void> | undefined;
  const check = () => { if (closed) throw new OfficeError('invalid-handle', 'XML part is closed.', 'select'); if (settings.signal?.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'select'); };
  const close = () => { closed = true; return closing ??= (async () => { const results = await Promise.allSettled([xml.close(), spans?.close()]); for (const result of results) if (result.status === 'rejected') throw result.reason; })(); };
  try {
    if (pretty) spans = await prettySpans(xml, context);
    return Object.freeze({ part, format: pretty ? 'pretty' : 'original', close,
      async *bytes() { check(); for await (const bytes of archive.read(part)) { check(); yield bytes; } check(); },
      async *xml() { check(); const source = spans ? spans.render() : xml.read({ start: 0, length: xml.byteLength });
        let count = 0; for await (const bytes of source) { check(); count += bytes.length; if (spans?.formatted && count > limits.maxBytes) throw new OfficeError('resource-limit', 'Pretty XML byte limit exceeded.', 'serialize'); yield bytes; } check(); }
    });
  } catch (error) { await close().catch(() => {}); throw error; }
}

export async function stageRetainedXmlPart(archive: Archive, fingerprint: string, selection: RetainedInspectionSelection, settings: RetainedXmlPartContext, output: { readonly json: boolean; readonly pretty?: boolean; readonly maxOutputBytes: number }): Promise<StagedOutput> {
  const options = { ...selection }, format = { ...output }, index = await openRetainedPresentationIndex(archive, fingerprint, settings);
  let xml: RetainedXmlPart | undefined, staged: StagedOutput | undefined;
  try {
    let metadata = false;
    if (options.scope === 'shared' && options.part) {
      metadata = options.part === '/[Content_Types].xml' || options.part === packageUri('/').relsUri;
      if (!metadata) for await (const record of index.records.records('part')) if (packageUri(record.part).relsUri === options.part) { metadata = true; break; }
    }
    async function* selected() {
      if (options.token) { yield* index.records.select({ token: options.token }); return; }
      const scope = options.scope ?? 'slides', all = options.all ?? false;
      if (options.slide !== undefined) for await (const slide of index.records.select({ kind: 'slide', position: { coordinateSystem: 'one-based', value: options.slide } })) {
        if (options.shape) yield* index.records.select({ kind: 'object', owner: slide.part, name: options.shape, scope, all }); else yield slide;
      }
      else if (options.part) yield* index.records.select(options.shape ? { kind: 'object', owner: options.part, name: options.shape, scope, all } : { kind: 'part', part: options.part, scope, all });
      else if (scope === 'slides') yield* index.records.records('slide');
      else for await (const record of index.records.records('part')) if (record.location.scope === scope) yield record;
    }
    let record: RetainedSelectionRecord | undefined, count = 0;
    if (!metadata) { for await (const item of selected()) { record = item; count++; } if (count !== 1 || record!.kind === 'object') throw new SelectionError('invalid-selection'); }
    const part = metadata ? options.part! : record!.part;
    const location: Location = metadata ? { fingerprint, scope: 'shared', owner: part, objectId: part, coordinateSystem: 'identity' } : record!.location;
    xml = await openRetainedXmlPart(archive, part, settings, { pretty: format.pretty ?? false });
    const data = xml;
    async function* render(): ByteSource {
      if (format.json) { yield* streamJson({ version: 1, operation: 'xml.get', ok: true, data: { part, format: data.format, xml: data.xml }, warnings: [], errors: [], affected: 0, locations: [location] }); yield* literal('\n'); }
      else if (format.pretty) { yield* literal('Pretty XML (not original bytes)\n'); yield* data.xml(); yield* literal('\n'); }
      else yield* data.bytes();
    }
    staged = await stageRetainedOutput(render(), settings, format.maxOutputBytes);
    await xml.close(); await index.close(); return staged;
  } catch (error) { await Promise.allSettled([xml?.close(), index.close(), staged?.close()]); throw error; }
}
