import type { XmlElement } from '@poe-code/safe-fs/xml';
import { ZipStorageFailure } from '@poe-code/office-package';
import { SsconvertError, type CapabilityContext, type WorkingStorage } from '@poe-code/spreadsheet-engine/contracts';

/** Length-prefixed UTF-16 records share one serialized 16 KiB transfer window.
 * Ordered XML content is canonical; children/text are reconstructed on replay. */
export function createXlsxRecords(context: CapabilityContext, release: () => void) {
  let storage: WorkingStorage | undefined = undefined;
  let closed = false, closing: Promise<void> | undefined, pending: Promise<unknown> = Promise.resolve();
  const scratch = new Uint8Array(16384), view = new DataView(scratch.buffer);
  const check = () => { context.signal.throwIfAborted(); if (closed) throw new SsconvertError('invalid-request', 'XLSX record storage is closed'); };
  context.own(() => { closed = true; return closing ??= pending.then(async () => { scratch.fill(0); release(); await storage?.close(); }); });
  try {
    check();
    if (!context.createWorkingStorage) throw new SsconvertError('capability-denied', 'XLSX records require caller storage');
    storage = context.createWorkingStorage(); check();
  } catch (error) { throw new ZipStorageFailure(error); }
  function serial<T>(action: () => Promise<T>): Promise<T> {
    const result = pending.then(() => { check(); return action(); }).catch(error => { throw error instanceof ZipStorageFailure ? error : new ZipStorageFailure(error); });
    pending = result.then(() => undefined, () => undefined); return result;
  }
  async function append(value: unknown): Promise<number> {
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
    if (header.length !== 8) throw new SsconvertError('io', 'Truncated XLSX record header');
    const length = new DataView(header.buffer, header.byteOffset, 8).getFloat64(0, true);
    if (!Number.isSafeInteger(length) || length < 0 || length > (Number.MAX_SAFE_INTEGER - address - 8) / 2) throw new SsconvertError('io', 'Invalid XLSX record length');
    let text = '';
    for (let at = 0; at < length; at += 8192) {
      const take = Math.min(8192, length - at), bytes = await storage!.read(address + 8 + at * 2, take * 2); check();
      if (bytes.length !== take * 2) throw new SsconvertError('io', 'Truncated XLSX record payload');
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
  return { storage, check, serial, append, read };
}
