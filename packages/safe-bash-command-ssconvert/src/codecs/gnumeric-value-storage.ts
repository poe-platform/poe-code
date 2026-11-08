import { ZipDirectoryIndex } from "@poe-code/office-package";
import { IntegerTable } from "@poe-code/safe-fs/storage";
import type { AxisMetadata, Cell } from "../workbook.js";
import { SsconvertError, type CapabilityContext, type WorkingStorage } from "../contracts.js";

export interface GnumericSharedExpression { formula: string; row: number; column: number; sheet: string; arrayStringLiterals?: boolean; }

export interface GnumericAxisState { metadata: AxisMetadata; implicit: boolean; }

/** Shared bounded workbook indexes and length-prefixed UTF-16 records. Cell,
 * axis and formula payloads share one 16 KiB scratch window across all sheets. */
export function createGnumericValueStorage(context: CapabilityContext) {
  let storage: WorkingStorage | undefined = undefined, cells: IntegerTable | undefined, axes: IntegerTable | undefined, bindings: IntegerTable | undefined, shared: ZipDirectoryIndex | undefined, names: ZipDirectoryIndex | undefined;
  let closed = false, closing: Promise<void> | undefined, pending: Promise<unknown> = Promise.resolve(), axisGroup = 0;
  const scratch = new Uint8Array(16384), view = new DataView(scratch.buffer);
  const check = () => { context.signal.throwIfAborted(); if (closed) throw new SsconvertError("invalid-request", "Gnumeric values are closed"); };
  context.own(() => {
    closed = true;
    return closing ??= pending.then(async () => { scratch.fill(0); cells = undefined; axes = undefined; bindings = undefined; shared = undefined; names = undefined; await storage?.close(); });
  });
  check();
  if (!context.createWorkingStorage) throw new SsconvertError("capability-denied", "Gnumeric values require caller storage");
  storage = context.createWorkingStorage(); check(); cells = new IntegerTable(storage, 128); axes = new IntegerTable(storage, 128); bindings = new IntegerTable(storage, 128);
  shared = new ZipDirectoryIndex(storage, { maximumKeyLength: Infinity, signal: context.signal });
  names = new ZipDirectoryIndex(storage, { maximumKeyLength: Infinity, signal: context.signal });
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(() => { check(); return operation(); });
    pending = result.then(() => undefined, () => undefined); return result;
  }
  async function appendRecord(value: Cell | AxisMetadata | GnumericSharedExpression | string, flag: boolean): Promise<bigint> {
    const text = JSON.stringify([value, flag]), address = storage!.allocate(8 + text.length * 2);
    view.setFloat64(0, text.length, true); await storage!.write(address, scratch.subarray(0, 8)); check();
    for (let at = 0; at < text.length; at += 8192) {
      const count = Math.min(8192, text.length - at);
      for (let i = 0; i < count; i++) view.setUint16(i * 2, text.charCodeAt(at + i), true);
      await storage!.write(address + 8 + at * 2, scratch.subarray(0, count * 2)); check();
    }
    return BigInt(address);
  }
  async function readRecord<T>(pointer: bigint): Promise<[T, boolean]> {
    const address = Number(pointer), header = await storage!.read(address, 8); check();
    if (header.length !== 8) throw new SsconvertError("io", "Truncated Gnumeric value header");
    const count = new DataView(header.buffer, header.byteOffset, 8).getFloat64(0, true);
    if (!Number.isSafeInteger(count) || count < 0 || count > (Number.MAX_SAFE_INTEGER - address - 8) / 2)
      throw new SsconvertError("io", "Invalid Gnumeric value length");
    let text = '';
    for (let at = 0; at < count; at += 8192) {
      const take = Math.min(8192, count - at), bytes = await storage!.read(address + 8 + at * 2, take * 2); check();
      if (bytes.length !== take * 2) throw new SsconvertError("io", "Truncated Gnumeric value payload");
      const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), units: number[] = [];
      for (let i = 0; i < take; i++) units.push(data.getUint16(i * 2, true));
      text += String.fromCharCode(...units);
    }
    return JSON.parse(text) as [T, boolean];
  }
  async function* records<T>(table: IntegerTable, start: bigint, end: bigint): AsyncGenerator<[T, boolean]> {
    const entries = table.entries(start, end);
    try {
      while (true) {
        const result = await serial(async () => {
          const entry = await entries.next(); check();
          return entry.done ? undefined : readRecord<T>(entry.value[1]);
        });
        if (result === undefined) return;
        yield result;
      }
    } finally { await entries.return(undefined); }
  }
  function binding(rejection: boolean) {
    const key = (node: unknown) => {
      if (typeof node !== "number" || !Number.isSafeInteger(node) || node < 0) throw new SsconvertError("io", "Invalid staged Gnumeric formula key");
      return BigInt(node) << 1n | (rejection ? 1n : 0n);
    };
    return {
      get(node: unknown): Promise<string | undefined> { return serial(async () => {
        const pointer = await bindings!.get(key(node)); check();
        return pointer === undefined ? undefined : (await readRecord<string>(pointer))[0];
      }); },
      set(node: unknown, value: string) { return serial(async () => {
        const pointer = await appendRecord(value, false);
        await bindings!.set(key(node), pointer); check();
      }); }
    };
  }
  const base = (sheet: number) => BigInt(sheet) << 38n;
  return {
    formulas: binding(false), rejections: binding(true),
    names: {
      get(key: string) { return serial(async () => { const value = await names!.get(key); check(); return value; }); },
      set(key: string, value: number) { return serial(async () => { await names!.set(key, value); check(); }); }
    },
    shared: {
      get(id: string): Promise<GnumericSharedExpression | undefined> { return serial(async () => {
        const pointer = await shared!.get(id); check();
        return pointer === undefined ? undefined : (await readRecord<GnumericSharedExpression>(BigInt(pointer)))[0];
      }); },
      set(id: string, value: GnumericSharedExpression) { return serial(async () => {
        const pointer = await appendRecord(value, false);
        await shared!.set(id, Number(pointer)); check();
      }); }
    },
    append(sheet: number, cell: Cell) { return serial(async () => {
      const negativeZero = cell.value?.kind === "number" && Object.is(cell.value.value, -0);
      const address = await appendRecord(cell, negativeZero);
      // At most 2^24 rows and 2^14 columns. Existing coordinates are replaced.
      await cells!.set(base(sheet) | BigInt(cell.row) << 14n | BigInt(cell.column), address); check();
    }); },
    async *cells(sheet: number): AsyncGenerator<Cell> {
      check();
      for await (const [cell, negativeZero] of records<Cell>(cells!, base(sheet), base(sheet + 1)))
        yield negativeZero ? { ...cell, value: { kind: 'number', value: -0 } } : cell;
    },
    axis() {
      check(); const start = BigInt(axisGroup++) << 32n, end = BigInt(axisGroup) << 32n;
      return {
        get(index: number): Promise<GnumericAxisState | undefined> { return serial(async () => {
          const pointer = await axes!.get(start | BigInt(index)); check();
          if (pointer === undefined) return undefined;
          const [metadata, implicit] = await readRecord<AxisMetadata>(pointer);
          return { metadata, implicit };
        }); },
        set(metadata: AxisMetadata, implicit: boolean) { return serial(async () => {
          const address = await appendRecord(metadata, implicit);
          await axes!.set(start | BigInt(metadata.index), address); check();
        }); },
        async *values(): AsyncGenerator<GnumericAxisState> {
          check(); for await (const [metadata, implicit] of records<AxisMetadata>(axes!, start, end)) yield { metadata, implicit };
        }
      };
    }
  };
}
