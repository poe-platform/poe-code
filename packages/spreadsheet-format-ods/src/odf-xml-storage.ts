import type { XmlContent, XmlElement, XmlStreamLimits } from '@poe-code/safe-fs/xml';
import { ZipStorageFailure } from '@poe-code/office-package';
import { SsconvertError, type CapabilityContext, type WorkingStorage } from '@poe-code/spreadsheet-engine/contracts';

type Chain = { head: number; tail: number };
/** Canonical mixed content lives in linked caller-backed records. Nested staged
 * containers carry chain references, preserving order without resident row lists. */
export function createOdfXmlStorage(context: CapabilityContext, tableNamespaces: readonly string[]) {
  let storage: WorkingStorage | undefined = undefined, closed = false, closing: Promise<void> | undefined;
  let pending: Promise<unknown> = Promise.resolve();
  const groups = new WeakMap<XmlElement, Chain>(), scratch = new Uint8Array(16384), view = new DataView(scratch.buffer);
  const check = () => { context.signal.throwIfAborted(); if (closed) throw new SsconvertError('invalid-request', 'ODF XML storage is closed'); };
  const close = () => {
    closed = true;
    return closing ??= pending.then(async () => { scratch.fill(0); await storage?.close(); });
  };
  context.own(close); check();
  try { storage = context.createWorkingStorage!(); } catch (error) { throw new ZipStorageFailure(error); }
  check();
  function serial<T>(action: () => Promise<T>): Promise<T> {
    const result = pending.then(async () => { check(); try { return await action(); } catch (error) { throw new ZipStorageFailure(error); } });
    pending = result.then(() => undefined, () => undefined); return result;
  }
  async function append(parent: XmlElement, content: readonly XmlContent[]) {
    return serial(async () => {
      const text = JSON.stringify(content, (_key, value: unknown) => {
        if (value instanceof Map) return [...value];
        if (value && typeof value === 'object' && 'kind' in value && value.kind === 'element') {
          const node = value as XmlElement;
          return { ...node, children: undefined, text: undefined, storedContent: groups.get(node) };
        }
        return value;
      });
      const address = storage!.allocate(16 + text.length * 2);
      scratch.fill(0, 0, 16); view.setFloat64(8, text.length, true);
      await storage!.write(address, scratch.subarray(0, 16)); check();
      for (let offset = 0; offset < text.length; offset += 8192) {
        const count = Math.min(8192, text.length - offset);
        for (let i = 0; i < count; i++) view.setUint16(i * 2, text.charCodeAt(offset + i), true);
        await storage!.write(address + 16 + offset * 2, scratch.subarray(0, count * 2)); check();
      }
      const chain = groups.get(parent);
      if (chain) { view.setFloat64(0, address, true); await storage!.write(chain.tail, scratch.subarray(0, 8)); check(); chain.tail = address; }
      else groups.set(parent, { head: address, tail: address });
    });
  }
  async function read(address: number) {
    const header = await storage!.read(address, 16); check();
    if (header.length !== 16) throw new SsconvertError('io', 'Truncated ODF XML header');
    const data = new DataView(header.buffer, header.byteOffset, 16), next = data.getFloat64(0, true), length = data.getFloat64(8, true);
    if (!Number.isSafeInteger(next) || next < 0 || !Number.isSafeInteger(length) || length < 0 || length > (Number.MAX_SAFE_INTEGER - address - 16) / 2)
      throw new SsconvertError('io', 'Invalid ODF XML record');
    let text = '';
    for (let offset = 0; offset < length; offset += 8192) {
      const count = Math.min(8192, length - offset), bytes = await storage!.read(address + 16 + offset * 2, count * 2); check();
      if (bytes.length !== count * 2) throw new SsconvertError('io', 'Truncated ODF XML content');
      const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), units: number[] = [];
      for (let i = 0; i < count; i++) units.push(data.getUint16(i * 2, true));
      text += String.fromCharCode(...units);
    }
    const content = JSON.parse(text, (_key, value: unknown) => {
      if (value && typeof value === 'object' && 'kind' in value && value.kind === 'element') {
        const { storedContent, ...node } = value as XmlElement & { storedContent?: Chain };
        const result: XmlElement = { ...node, namespaces: new Map(node.namespaces as unknown as [string, string][]),
          children: node.content.filter((item): item is XmlElement => item.kind === 'element'),
          text: node.content.filter(item => item.kind === 'text' || item.kind === 'cdata').map(item => item.text).join('') };
        if (storedContent) groups.set(result, storedContent);
        return result;
      }
      return value;
    }) as XmlContent[];
    return { next, content };
  }
  async function* content(parent: XmlElement): AsyncGenerator<XmlContent> {
    check(); const chain = groups.get(parent);
    if (chain) {
      const tail = chain.tail;
      for (let address = chain.head;;) {
        const record = await serial(() => read(address));
        yield* record.content;
        if (address === tail) break;
        if (record.next <= address) throw new SsconvertError('io', 'Invalid ODF XML chain');
        address = record.next;
      }
    }
    yield* parent.content; check();
  }
  async function* children(parent: XmlElement): AsyncGenerator<XmlElement> {
    for await (const item of content(parent)) if (item.kind === 'element') yield item;
  }
  async function materialize(parent: XmlElement): Promise<XmlElement> {
    const items: XmlContent[] = [];
    for await (const item of content(parent)) items.push(item.kind === 'element' ? await materialize(item) : item);
    return { ...parent, content: items, children: items.filter((item): item is XmlElement => item.kind === 'element'),
      text: items.filter(item => item.kind === 'text' || item.kind === 'cdata').map(item => item.text).join('') };
  }
  const streamElements: NonNullable<XmlStreamLimits['streamElements']> = {
    captureBefore: true,
    matches(element, parent) { return element.localName === 'table-row' && tableNamespaces.includes(element.namespace)
      && !!parent && tableNamespaces.includes(parent.namespace) && ['table', 'table-row-group', 'table-header-rows', 'table-rows'].includes(parent.localName); },
    async consume(element, parent, before = []) { await append(parent, [...before, element]); }
  };
  return { streamElements, content, children, append, materialize, has: (parent: XmlElement) => groups.has(parent), close };
}
