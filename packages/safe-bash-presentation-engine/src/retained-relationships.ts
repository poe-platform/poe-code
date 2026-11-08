import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource } from './contracts.js';
import { OfficeError } from './errors.js';
import type { RetainedPackageContext } from './retained-package.js';
import type { XmlRange } from './retained-xml.js';
import { openRetainedXmlDocument, type RetainedXmlNode } from './retained-xml-document.js';
import { RetainedValues, characters, equal, literal } from './retained-values.js';
import { resourceContext } from './resource-limits.js';

export interface RetainedRelationship {
  id(): ByteSource;
  type(): ByteSource;
  target(): ByteSource;
  readonly external: boolean;
}
export interface RetainedRelationships {
  readonly count: number;
  records(): AsyncGenerator<RetainedRelationship>;
  get(id: string): Promise<RetainedRelationship | undefined>;
  close(): Promise<void>;
}
const namespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
function invalid(): never { throw new OfficeError('invalid-opc', 'Invalid package relationships.', 'index'); }

/** Admits one relationship part. URI resolution and graph validation are a
 * separate layer: the existing parser also accepts arbitrary nonempty values. */
export async function openRetainedRelationships(source: ByteSource, settings: RetainedPackageContext): Promise<RetainedRelationships> {
  const context = resourceContext(settings), working = { ...settings.workingStorage };
  const doc = await openRetainedXmlDocument(source, { ...context, workingStorage: working, xmlLimits: { ...context.xmlLimits,
    maxBytes: Math.min(context.xmlLimits.maxBytes, context.relationshipLimits.maxBytes) } }).catch(error => {
      if (error instanceof OfficeError && error.code === 'invalid-xml') invalid(); throw error;
    });
  const signal = context.signal ?? new AbortController().signal;
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, (working.cacheBytes ?? 1024 * 1024) / 16384);
  let closed = false, closing: Promise<void> | undefined, first = 0, last = 0, count = 0;
  const check = () => {
    if (closed) throw new OfficeError('invalid-handle', 'Relationship index is closed.', 'index');
    if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'index');
  };
  const failure = (error: unknown): unknown => error instanceof OfficeError ? error
    : new OfficeError(signal.aborted ? 'cancelled' : 'io-failure', 'Relationship storage operation failed.', 'index');
  const values = new RetainedValues(pages, check, signal);
  const close = () => {
    closed = true;
    return closing ??= (async () => {
      const results = await Promise.allSettled([pages.close(), doc.close()]);
      const failed = results.find(result => result.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason;
    })();
  };
  const matches = (node: RetainedXmlNode, name: string) => equal(doc.raw(node.localName), literal(name));
  async function whitespace(node: RetainedXmlNode) {
    if (node.kind === 'comment' || node.kind === 'instruction') return;
    if (node.kind !== 'text') invalid();
    for await (const character of characters(doc.text(node))) if (!' \t\r\n'.includes(character)) invalid();
  }
  async function* read(range: XmlRange): ByteSource { try { yield* values.read(range); } catch (error) { throw failure(error); } }
  async function row(pointer: number): Promise<number[]> {
    check(); const bytes = await pages.read(pointer, 64), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length: 8 }, (_, n) => view.getFloat64(n * 8, true));
  }
  function record(data: number[]): RetainedRelationship {
    return Object.freeze({ external: Boolean(data[7]),
      id: () => read({ start: data[1]!, length: data[2]! }),
      type: () => read({ start: data[3]!, length: data[4]! }),
      target: () => read({ start: data[5]!, length: data[6]! }) });
  }
  try {
    if (!await matches(doc.root, 'Relationships') || !await equal(doc.namespace(doc.root), literal(namespace))) invalid();
    for await (const ignoredAttribute of doc.attributes(doc.root)) invalid();
    for await (const node of doc.children(doc.root)) {
      check(); if (node.kind !== 'element') { await whitespace(node); continue; }
      if (!await matches(node, 'Relationship') || !await equal(doc.namespace(node), literal(namespace))) invalid();
      if (++count > context.relationshipLimits.maxRelationships) throw new OfficeError('resource-limit', 'Relationship limit exceeded.', 'index');
      let id: XmlRange | undefined, type: XmlRange | undefined, target: XmlRange | undefined, external = false;
      for await (const attribute of doc.attributes(node)) {
        if (!await equal(doc.namespace(attribute), literal(''))) invalid();
        if (await matches(attribute, 'Id')) id = await values.store(doc.text(attribute));
        else if (await matches(attribute, 'Type')) type = await values.store(doc.text(attribute));
        else if (await matches(attribute, 'Target')) target = await values.store(doc.text(attribute));
        else if (await matches(attribute, 'TargetMode')) {
          external = await equal(doc.text(attribute), literal('External'));
          if (!external && !await equal(doc.text(attribute), literal('Internal'))) invalid();
        } else invalid();
      }
      if (!id?.length || !type?.length || !target?.length) invalid();
      for await (const child of doc.children(node)) await whitespace(child);
      const pointer = pages.allocate(64), data = new Uint8Array(64), view = new DataView(data.buffer);
      [0, id.start, id.length, type.start, type.length, target.start, target.length, Number(external)]
        .forEach((value, n) => view.setFloat64(n * 8, value, true));
      await pages.write(pointer, data);
      if (!await values.insert('id', id, { start: pointer, length: 64 })) invalid();
      if (last) { const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, pointer, true); await pages.write(last, link); }
      else first = pointer;
      last = pointer;
    }
    await doc.close();
    return Object.freeze({ count, close,
      async *records() {
        try { check(); for (let pointer = first; pointer;) { const data = await row(pointer); yield record(data); pointer = data[0]!; } }
        catch (error) { throw failure(error); }
      },
      async get(id: string): Promise<RetainedRelationship | undefined> {
        try {
          check(); if (typeof id !== 'string') throw new OfficeError('invalid-type', 'Expected a relationship identifier.', 'usage');
          const found = await values.find('id', () => literal(id)); return found ? record(await row(found.start)) : undefined;
        } catch (error) { throw failure(error); }
      }
    });
  } catch (error) { await close().catch(() => {}); throw failure(error); }
}
