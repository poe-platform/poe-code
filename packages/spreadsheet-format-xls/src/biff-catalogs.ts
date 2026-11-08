import { IntegerTable } from '@poe-code/safe-fs/storage';
import { SsconvertError, type CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
import { createBiffSharedStrings } from './biff-shared-strings.js';

export interface BiffFont { name: string; attributes: Record<string, number>; color: number; codepage: number; }

/** Parsed catalogs share a fixed index cache and UTF-16 backing records. XF
 * entries own the fixed-width style fields so scalar replay can retire its input. */
export function createBiffCatalogs(context: CapabilityContext) {
  let closed = false, closing: Promise<void> | undefined, pending: Promise<unknown> = Promise.resolve();
  let index: IntegerTable | undefined, values: ReturnType<typeof createBiffSharedStrings> | undefined;
  const resources: (() => void | Promise<void>)[] = [], memory = context.createWorkingStorage ? undefined : new Map<bigint, string>();
  const check = () => { context.signal.throwIfAborted(); if (closed) throw new SsconvertError('invalid-request', 'BIFF catalogs are closed'); };
  const close = () => {
    closed = true;
    return closing ??= pending.then(async () => {
      index = undefined; values = undefined; memory?.clear();
      const errors: unknown[] = [];
      for (const cleanup of resources) try { await cleanup(); } catch (error) { errors.push(error); }
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, 'BIFF catalog cleanup failed');
    });
  };
  context.own(close); check();
  if (context.createWorkingStorage) {
    const storage = context.createWorkingStorage(); resources.push(() => storage.close()); check();
    index = new IntegerTable(storage, 128);
    values = createBiffSharedStrings({ ...context, own(cleanup) { resources.push(cleanup); } });
  }
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(() => { check(); return operation(); });
    pending = result.then(() => undefined, () => undefined); return result;
  }
  function table<T>(namespace: number) {
    const base = BigInt(namespace) << 60n; let count = 0;
    const key = (id: number) => {
      if (!Number.isSafeInteger(id) || id < 0) throw new SsconvertError('io', 'Invalid BIFF catalog index');
      return base | BigInt(id);
    };
    const write = async (id: number, value: T) => {
      const address = key(id), text = JSON.stringify(value);
      if (memory) memory.set(address, text);
      else {
        const ordinal = await values!.append({ text }); check();
        await index!.set(address, BigInt(ordinal)); check();
      }
      count = Math.max(count, id + 1);
    };
    return {
      get count() { return count; },
      append(value: T) { return serial(async () => { const id = count; await write(id, value); return id; }); },
      set(id: number, value: T) { return serial(() => write(id, value)); },
      get(id: number): Promise<T | undefined> { return serial(async () => {
        const address = key(id); let text: string | undefined;
        if (memory) text = memory.get(address);
        else {
          const ordinal = await index!.get(address); check();
          if (ordinal === undefined) return undefined;
          const value = await values!.get(Number(ordinal)); check();
          if (!value) throw new SsconvertError('io', 'Missing BIFF catalog value');
          text = value.text;
        }
        return text === undefined ? undefined : JSON.parse(text) as T;
      }); }
    };
  }
  return { fonts: table<BiffFont>(0), xfs: table<{ bytes: readonly number[]; revision: number }>(1), formats: table<string>(2), close };
}
