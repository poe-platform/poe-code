import { IntegerTable } from '@poe-code/safe-fs/storage';
import { SsconvertError, type CapabilityContext, type WorkingStorage } from '../contracts.js';

/** Accepted edge heads, rejection flags, visit epochs and reusable stack slots
 * share one bounded index. Edge lists preserve source order in caller storage. */
export function createGnumericNameGraph(context: CapabilityContext) {
  let storage: WorkingStorage | undefined = undefined, table: IntegerTable | undefined;
  let closed = false, closing: Promise<void> | undefined, pending: Promise<unknown> = Promise.resolve(), depth = 0;
  const scratch = new Uint8Array(16), view = new DataView(scratch.buffer);
  const check = () => { context.signal.throwIfAborted(); if (closed) throw new SsconvertError('invalid-request', 'Gnumeric name graph is closed'); };
  context.own(() => { closed = true; return closing ??= pending.then(async () => { scratch.fill(0); table = undefined; await storage?.close(); }); });
  check();
  if (!context.createWorkingStorage) throw new SsconvertError('capability-denied', 'Gnumeric name graph requires caller storage');
  storage = context.createWorkingStorage(); check(); table = new IntegerTable(storage, 128);
  const key = (index: number, tag: number) => BigInt(index) << 2n | BigInt(tag);
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(() => { check(); return operation(); }); pending = result.then(() => undefined, () => undefined); return result;
  }
  async function* edges(head: number): AsyncGenerator<number> {
    check();
    while (head) {
      const record = await serial(async () => {
        const bytes = await storage!.read(head, 16); check();
        if (bytes.length !== 16) throw new SsconvertError('io', 'Truncated Gnumeric dependency');
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), target = view.getFloat64(0, true), next = view.getFloat64(8, true);
        if (![target, next].every(value => Number.isSafeInteger(value) && value >= 0)) throw new SsconvertError('io', 'Invalid Gnumeric dependency');
        return { target, next };
      });
      head = record.next; yield record.target;
    }
    check();
  }
  return {
    list() {
      check(); let head = 0, tail = 0;
      return { get head() { return head; }, append(target: number) { return serial(async () => {
        const address = storage!.allocate(16); view.setFloat64(0, target, true); view.setFloat64(8, 0, true);
        await storage!.write(address, scratch); check();
        if (tail) { view.setFloat64(0, address, true); await storage!.write(tail + 8, scratch.subarray(0, 8)); check(); }
        else head = address;
        tail = address;
      }); } };
    },
    accept(index: number, head: number) { return serial(async () => { await table!.set(key(index, 0), BigInt(head)); check(); }); },
    async *dependencies(index: number) {
      const pointer = await serial(async () => { const value = await table!.get(key(index, 0)); check(); return value; });
      if (pointer !== undefined) yield* edges(Number(pointer));
    },
    reject(index: number) { return serial(async () => { await table!.set(key(index, 1), 1n); check(); }); },
    rejected(index: number) { return serial(async () => { const value = await table!.get(key(index, 1)); check(); return value !== undefined; }); },
    seen(index: number, epoch: number) { return serial(async () => {
      const previous = await table!.get(key(index, 2)); check();
      if (previous === BigInt(epoch)) return true;
      await table!.set(key(index, 2), BigInt(epoch)); check(); return false;
    }); },
    reset() { check(); depth = 0; },
    push(index: number) { return serial(async () => { await table!.set(key(depth, 3), BigInt(index)); check(); depth++; }); },
    pop(): Promise<number | undefined> { return serial(async () => {
      if (!depth) return undefined;
      const value = await table!.get(key(depth - 1, 3)); check();
      if (value === undefined) throw new SsconvertError('io', 'Missing Gnumeric traversal entry');
      depth--; return Number(value);
    }); }
  };
}
