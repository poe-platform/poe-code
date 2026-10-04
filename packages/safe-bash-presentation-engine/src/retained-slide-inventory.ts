import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource } from './contracts.js';
import { OfficeError } from './errors.js';
import type { SlideInventory } from './inventory.js';
import type { RetainedPackageArchive, RetainedPackageContext } from './retained-package.js';
import type { RetainedSelectionRecords } from './retained-selection.js';
import { openRetainedRelationshipGraph, type RetainedRelationshipEdge } from './retained-relationship-graph.js';
import { openRetainedXmlDocument, type RetainedXmlDocument, type RetainedXmlNode } from './retained-xml-document.js';
import { RetainedValues, literal, equal, folded, characters } from './retained-values.js';
import type { XmlRange } from './retained-xml.js';
import { resourceContext } from './resource-limits.js';
import { dialects } from './validation-schema.js';

export interface RetainedSlideInventory {
  readonly counts: { readonly slides: number; readonly slideShapes: number };
  slides(): AsyncGenerator<SlideInventory>;
  handoutMasters(): AsyncGenerator<string>;
  close(): Promise<void>;
}
enum S { Next, Id, Part, PartLength, Position, Shapes, Layout, LayoutLength, Master, MasterLength, Theme, ThemeLength, Show, Count }
function invalid(message: string): never { throw new OfficeError('invalid-opc', message, 'index'); }

/** Structure admission over borrowed selection records and archive. Text styles
 * must still be admitted separately before exposing a complete inventory. */
export async function openRetainedSlideInventory(
  archive: Pick<RetainedPackageArchive, 'parts' | 'has' | 'read' | 'byteLength'>,
  records: Pick<RetainedSelectionRecords, 'main' | 'records'>,
  settings: RetainedPackageContext
): Promise<RetainedSlideInventory> {
  const context = resourceContext(settings), working = { ...settings.workingStorage }, cacheBytes = working.cacheBytes ?? 1024 * 1024;
  if (!working.fs || typeof working.directory !== 'string' || !working.directory.startsWith('/') || !Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384)
    throw new OfficeError('invalid-value', 'Explicit slide inventory storage and a valid cache budget are required.', 'usage');
  const signal = context.signal ?? new AbortController().signal;
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, cacheBytes / 16384);
  let closed = false, closing: Promise<void> | undefined, firstSlide = 0, lastSlide = 0, firstHandout = 0, lastHandout = 0, slides = 0, slideShapes = 0;
  const check = () => {
    if (closed) throw new OfficeError('invalid-handle', 'Slide inventory is closed.', 'index');
    if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'index');
  };
  const failure = (error: unknown) => error instanceof OfficeError ? error : new OfficeError(signal.aborted ? 'cancelled' : 'io-failure', 'Slide inventory storage operation failed.', 'index');
  const close = () => { closed = true; return closing ??= pages.close(); };
  const values = new RetainedValues(pages, check, signal);
  const range = (data: number[], field: number): XmlRange => ({ start: data[field]!, length: data[field + 1]! });
  async function row(pointer: number, count: number) {
    check(); const bytes = await pages.read(pointer, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length: count }, (_, n) => view.getFloat64(n * 8, true));
  }
  async function write(pointer: number, data: number[]) {
    check(); const bytes = new Uint8Array(data.length * 8), view = new DataView(bytes.buffer);
    data.forEach((value, n) => view.setFloat64(n * 8, value, true)); await pages.write(pointer, bytes);
  }
  // Only names already admitted by the archive use this bounded decoder.
  async function part(value: XmlRange) {
    const decoder = new TextDecoder(); let result = '';
    for await (const bytes of values.read(value)) result += decoder.decode(bytes, { stream: true });
    return result + decoder.decode();
  }
  async function type(edge: RetainedRelationshipEdge, kind: string) {
    for (const d of dialects) if (await equal(edge.type(), literal(`${d.r}/${kind}`))) return true;
    return false;
  }
  let graph: Awaited<ReturnType<typeof openRetainedRelationshipGraph>> | undefined, document: RetainedXmlDocument | undefined;
  async function open(name: string) {
    if (document) { const old = document; document = undefined; await old.close(); }
    return document = await openRetainedXmlDocument(archive.read(name), { ...context, workingStorage: working });
  }
  async function target(owner: string | null, kind: string): Promise<XmlRange | undefined> {
    if (owner === null) return undefined;
    let count = 0, result: XmlRange | undefined;
    for await (const edge of graph!.outgoing(owner)) if (await type(edge, kind)) {
      if (++count > 1) invalid('Ambiguous presentation inheritance relationship.');
      result = edge.targetPart ? await values.find('present', () => folded(edge.targetPart!())) : undefined;
    }
    return result;
  }
  async function visibility(source: ByteSource) {
    let value = '', trailing = false;
    for await (const character of characters(source)) {
      if (!character.trim()) { if (value) trailing = true; continue; }
      if (trailing || value.length >= 5) throw new OfficeError('invalid-xml', 'Invalid slide visibility.', 'index');
      value += character;
    }
    if (!['true', 'false', '1', '0'].includes(value)) throw new OfficeError('invalid-xml', 'Invalid slide visibility.', 'index');
    return value === 'true' || value === '1' ? 1 : 0;
  }
  try {
    graph = await openRetainedRelationshipGraph(archive, { ...context, workingStorage: working,
      xmlLimits: { maxBytes: context.relationshipLimits.maxBytes, maxNodes: Infinity, maxDepth: Infinity } });
    for await (const name of archive.parts()) {
      const original = await values.store(literal(name)), key = await values.store(folded(literal(name))); await values.insert('present', key, original);
    }
    // Count drawing records once; slide admission then does an indexed lookup.
    for await (const record of records.records('object')) if (record.scope === 'slides') {
      const previous = await values.find('shapes', () => literal(record.part));
      if (previous) await write(previous.start, [(await row(previous.start, 1))[0]! + 1]);
      else { const key = await values.store(literal(record.part)), pointer = pages.allocate(8); await write(pointer, [1]); await values.insert('shapes', key, { start: pointer, length: 8 }); }
    }
    for await (const record of records.records('slide')) {
      check(); const layout = await target(record.part, 'slideLayout'), master = await target(layout ? await part(layout) : null, 'slideMaster'), theme = await target(master ? await part(master) : null, 'theme');
      const doc = await open(record.part); let show = -1;
      for await (const attribute of doc.attributes(doc.root)) if (await equal(doc.namespace(attribute), literal('')) && await equal(doc.raw(attribute.localName), literal('show'))) show = await visibility(doc.text(attribute));
      const name = await values.store(literal(record.part)), shapeRow = await values.find('shapes', () => literal(record.part)), count = shapeRow ? (await row(shapeRow.start, 1))[0]! : 0, pointer = pages.allocate(S.Count * 8);
      await write(pointer, [0, Number(record.id), name.start, name.length, record.position, count, layout?.start ?? 0, layout?.length ?? 0, master?.start ?? 0, master?.length ?? 0, theme?.start ?? 0, theme?.length ?? 0, show]);
      if (lastSlide) await write(lastSlide, [pointer]); else firstSlide = pointer; lastSlide = pointer; slides++; slideShapes += count;
    }
    const doc = await open(records.main);
    async function named(node: RetainedXmlNode, parent: RetainedXmlNode, name: string) {
      return node.kind === 'element' && await equal(doc.namespace(node), doc.namespace(parent)) && await equal(doc.raw(node.localName), literal(name));
    }
    for await (const list of doc.children(doc.root)) if (await named(list, doc.root, 'handoutMasterIdLst')) {
      for await (const node of doc.children(list)) if (await named(node, list, 'handoutMasterId')) {
        let id: (() => ByteSource) | undefined;
        for await (const attribute of doc.attributes(node)) {
          let relationship = false; for (const d of dialects) if (await equal(doc.namespace(attribute), literal(d.r))) relationship = true;
          if (relationship && await equal(doc.raw(attribute.localName), literal('id'))) { id = () => doc.text(attribute); break; }
        }
        const edge = id ? await graph.get(records.main, id) : undefined;
        const resolved = edge?.targetPart && !edge.external && await type(edge, 'handoutMaster') ? await values.find('present', () => folded(edge.targetPart!())) : undefined;
        if (!resolved) invalid('Invalid handout master reference.');
        const pointer = pages.allocate(24); await write(pointer, [0, resolved.start, resolved.length]);
        if (lastHandout) await write(lastHandout, [pointer]); else firstHandout = pointer; lastHandout = pointer;
      }
    }
    const retired = await Promise.allSettled([doc.close(), graph.close()]); document = undefined; graph = undefined;
    for (const result of retired) if (result.status === 'rejected') throw result.reason;
    check();
    return Object.freeze({ close, counts: Object.freeze({ slides, slideShapes }),
      async *slides() {
        try { check(); for (let pointer = firstSlide; pointer;) {
          const data = await row(pointer, S.Count), explicit = data[S.Show] === -1 ? null : !!data[S.Show];
          yield Object.freeze({ id: String(data[S.Id]), part: await part(range(data, S.Part)), position: data[S.Position]!, shapeCount: data[S.Shapes]!,
            layout: data[S.Layout] ? await part(range(data, S.Layout)) : null, master: data[S.Master] ? await part(range(data, S.Master)) : null,
            theme: data[S.Theme] ? await part(range(data, S.Theme)) : null, show: Object.freeze({ explicit, effective: explicit ?? true }) });
          pointer = data[S.Next]!;
        } } catch (error) { throw failure(error); }
      },
      async *handoutMasters() {
        try { check(); for (let pointer = firstHandout; pointer;) { const data = await row(pointer, 3); yield await part(range(data, 1)); pointer = data[0]!; } }
        catch (error) { throw failure(error); }
      }
    });
  } catch (error) { await Promise.allSettled([document?.close(), graph?.close(), close()]); throw failure(error); }
}
