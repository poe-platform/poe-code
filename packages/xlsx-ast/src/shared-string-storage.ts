import { IntegerTable } from '@poe-code/safe-fs/storage';
import type { XmlElement, XmlStreamLimits } from '@poe-code/safe-fs/xml';
import { ZipStorageFailure } from '@poe-code/office-package';
import { SsconvertError, type CapabilityContext, type WorkingStorage } from '@poe-code/spreadsheet-engine/contracts';
import { readXlsxString } from './xlsx-styles.js';

type SharedString = ReturnType<typeof readXlsxString>;

/** Raw children are replayed after XML validation, then recognized strings are
 * decoded at the original import phase. Only individual records are resident. */
export function createSharedStringStorage(context: CapabilityContext, acceptsNamespace: (namespace: string) => boolean) {
  let storage: WorkingStorage | undefined = undefined, index: IntegerTable | undefined;
  let closed = false, closing: Promise<void> | undefined, pending: Promise<unknown> = Promise.resolve();
  let rawStart = 0, rawEnd = 0, count = 0;
  let streamedRoot: XmlElement | undefined;
  const scratch = new Uint8Array(16384), view = new DataView(scratch.buffer);
  const check = () => { context.signal.throwIfAborted(); if (closed) throw new SsconvertError('invalid-request', 'XLSX shared strings are closed'); };
  context.own(() => { closed = true; return closing ??= pending.then(async () => { scratch.fill(0); index = undefined; streamedRoot = undefined; await storage?.close(); }); });
  try {
    check();
    if (!context.createWorkingStorage) throw new SsconvertError('capability-denied', 'XLSX shared strings require caller storage');
    storage = context.createWorkingStorage(); check(); index = new IntegerTable(storage, 128);
  } catch (error) { throw new ZipStorageFailure(error); }
  function serial<T>(action: () => Promise<T>): Promise<T> {
    const result = pending.then(() => { check(); return action(); }).catch(error => { throw error instanceof ZipStorageFailure ? error : new ZipStorageFailure(error); });
    pending = result.then(() => undefined, () => undefined); return result;
  }
  async function append(value: XmlElement | SharedString): Promise<number> {
    const text = JSON.stringify(value, function(key, value: unknown) {
      if (this.kind === 'element' && (key === 'children' || key === 'text')) return undefined;
      return value instanceof Map ? [...value] : value;
    });
    const address = storage!.allocate(8 + text.length * 2);
    view.setFloat64(0, text.length, true); await storage!.write(address, scratch.subarray(0, 8)); check();
    for (let at = 0; at < text.length; at += 8192) {
      const take = Math.min(8192, text.length - at);
      for (let i = 0; i < take; i++) view.setUint16(i * 2, text.charCodeAt(at + i), true);
      await storage!.write(address + 8 + at * 2, scratch.subarray(0, take * 2)); check();
    }
    return address;
  }
  async function read<T>(address: number): Promise<{ value: T; end: number }> {
    const header = await storage!.read(address, 8); check();
    if (header.length !== 8) throw new SsconvertError('io', 'Truncated XLSX shared string header');
    const length = new DataView(header.buffer, header.byteOffset, 8).getFloat64(0, true);
    if (!Number.isSafeInteger(length) || length < 0 || length > (Number.MAX_SAFE_INTEGER - address - 8) / 2) throw new SsconvertError('io', 'Invalid XLSX shared string length');
    let text = '';
    for (let at = 0; at < length; at += 8192) {
      const take = Math.min(8192, length - at), bytes = await storage!.read(address + 8 + at * 2, take * 2); check();
      if (bytes.length !== take * 2) throw new SsconvertError('io', 'Truncated XLSX shared string payload');
      const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), units: number[] = [];
      for (let i = 0; i < take; i++) units.push(data.getUint16(i * 2, true));
      text += String.fromCharCode(...units);
    }
    const value = JSON.parse(text, (_key, value: unknown) => {
      if (value && typeof value === 'object' && 'kind' in value && value.kind === 'element') {
        const node = value as XmlElement;
        return { ...node, namespaces: new Map(node.namespaces as unknown as [string, string][]),
          children: node.content.filter(item => item.kind === 'element'),
          text: node.content.filter(item => item.kind === 'text' || item.kind === 'cdata').map(item => item.text).join('') };
      }
      return value;
    }) as T;
    return { value, end: address + 8 + length * 2 };
  }
  const streamElements: NonNullable<XmlStreamLimits['streamElements']> = {
    matches(_node, parent, depth) { return depth === 2 && parent?.localName === 'sst' && acceptsNamespace(parent.namespace); },
    consume(node, parent) { return serial(async () => {
      const address = await append(node);
      if (!rawStart) rawStart = address;
      // Raw XML is contiguous; index records are populated only after parsing.
      rawEnd = storage!.allocate(0); streamedRoot = parent;
      parent.text = ''; (parent.content as unknown[]).length = 0;
    }); }
  };
  return {
    streamElements,
    async *children(root: XmlElement): AsyncGenerator<XmlElement> {
      check();
      if (streamedRoot !== root) { yield* root.children; return; }
      const end = rawEnd;
      for (let address = rawStart; address < end;) {
        const record = await serial(() => read<XmlElement>(address));
        if (record.end > end) throw new SsconvertError('io', 'Invalid XLSX shared string record');
        address = record.end; yield record.value;
      }
      check();
    },
    accept(node: XmlElement) { return serial(async () => { const address = await append(node); await index!.set(BigInt(count), BigInt(address)); check(); count++; }); },
    decode() { return serial(async () => {
      for (let i = 0; i < count; i++) {
        const pointer = await index!.get(BigInt(i)); check();
        if (pointer === undefined) throw new SsconvertError('io', 'Missing XLSX shared string');
        const node = (await read<XmlElement>(Number(pointer))).value;
        const address = await append(readXlsxString(node, context));
        await index!.set(BigInt(i), BigInt(address)); check();
      }
    }); },
    get(ordinal: number): Promise<SharedString | undefined> { return serial(async () => {
      if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= count) return undefined;
      const pointer = await index!.get(BigInt(ordinal)); check();
      if (pointer === undefined) throw new SsconvertError('io', 'Missing XLSX shared string');
      return (await read<SharedString>(Number(pointer))).value;
    }); }
  };
}
