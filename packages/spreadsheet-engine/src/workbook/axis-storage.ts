import { IntegerTable } from '@poe-code/safe-fs/storage';
import type { AxisMetadata } from '@poe-code/spreadsheet-ast';
import { SsconvertError, type WorkingStorage } from '../contracts.js';

/** Coordinate-ordered axes share one bounded index and transfer window. The
 * caller owns backing lifetime; without backing this is an explicit RAM path.
 * Inputs must already be owned and validated workbook metadata. */
export function createAxisStorage(storage: WorkingStorage | undefined, signal: AbortSignal) {
  let table = storage ? new IntegerTable(storage, 128) : undefined;
  const memory = storage ? undefined : new Map<bigint, string>();
  const scratch = new Uint8Array(16384), view = new DataView(scratch.buffer);
  let sequence = 0, closed = false, pending: Promise<unknown> = Promise.resolve();
  const check = () => { signal.throwIfAborted(); if (closed) throw new SsconvertError('invalid-request', 'Axis storage is closed'); };
  function serial<T>(action: () => Promise<T>): Promise<T> {
    const result = pending.then(() => { check(); return action(); });
    pending = result.then(() => undefined, () => undefined); return result;
  }
  function encode(axis: AxisMetadata): string {
    let ordinal = 0;
    const negativeZeros: number[] = [];
    const payload = JSON.stringify(axis, (_key, value: unknown) => {
      if (typeof value === 'number') { if (Object.is(value, -0)) negativeZeros.push(ordinal); ordinal++; }
      return value;
    });
    return '[' + payload + ',' + JSON.stringify(negativeZeros) + ']';
  }
  function decode(text: string): AxisMetadata {
    const [axis, negativeZeros] = JSON.parse(text) as [AxisMetadata, number[]];
    let ordinal = 0, next = 0;
    function restore(value: unknown) {
      if (!value || typeof value !== 'object') return;
      const object = value as Record<string, unknown>;
      for (const key of Object.keys(object)) {
        if (typeof object[key] === 'number') {
          if (negativeZeros[next] === ordinal) { object[key] = -0; next++; }
          ordinal++;
        } else restore(object[key]);
      }
    }
    if (negativeZeros.length) restore(axis);
    return axis;
  }
  async function read(pointer: bigint): Promise<AxisMetadata> {
    const position = Number(pointer), header = await storage!.read(position, 8); check();
    if (header.length !== 8) throw new SsconvertError('io', 'Truncated axis header');
    const length = new DataView(header.buffer, header.byteOffset, 8).getFloat64(0, true);
    if (!Number.isSafeInteger(length) || length < 0 || length > (Number.MAX_SAFE_INTEGER - position - 8) / 2)
      throw new SsconvertError('io', 'Invalid axis record length');
    let text = '';
    for (let offset = 0; offset < length; offset += 8192) {
      const count = Math.min(8192, length - offset), bytes = await storage!.read(position + 8 + offset * 2, count * 2); check();
      if (bytes.length !== count * 2) throw new SsconvertError('io', 'Truncated axis record');
      const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), units = [];
      for (let i = 0; i < count; i++) units.push(data.getUint16(i * 2, true));
      text += String.fromCharCode(...units);
    }
    return decode(text);
  }
  return {
    async close() { closed = true; await pending; scratch.fill(0); table = undefined; memory?.clear(); },
    axis() {
      check(); const start = BigInt(sequence++) << 32n, end = BigInt(sequence) << 32n;
      let maximum = -1, outline = 0, count = 0;
      function coordinate(index: number): bigint {
        if (!Number.isSafeInteger(index) || index < 0 || index >= 2 ** 32)
          throw new SsconvertError('invalid-request', 'Invalid stored axis coordinate');
        return start + BigInt(index);
      }
      return {
        get maximum() { return maximum; }, get outline() { return outline; }, get count() { return count; },
        add(axis: AxisMetadata) {
          check();
          const key = coordinate(axis.index), text = encode(axis);
          const index = axis.index, level = axis.outlineLevel ?? 0;
          return serial(async () => {
            if (table ? await table.get(key) !== undefined : memory!.has(key))
              throw new SsconvertError('invalid-request', 'Duplicate stored axis coordinate');
            check();
            if (storage) {
              const position = storage.allocate(8 + text.length * 2);
              view.setFloat64(0, text.length, true); await storage.write(position, scratch.subarray(0, 8)); check();
              for (let offset = 0; offset < text.length; offset += 8192) {
                const count = Math.min(8192, text.length - offset);
                for (let i = 0; i < count; i++) view.setUint16(i * 2, text.charCodeAt(offset + i), true);
                await storage.write(position + 8 + offset * 2, scratch.subarray(0, count * 2)); check();
              }
              await table!.set(key, BigInt(position)); check();
            } else memory!.set(key, text);
            maximum = Math.max(maximum, index); outline = Math.max(outline, level); count++;
          });
        },
        get(index: number): Promise<AxisMetadata | undefined> { return serial(async () => {
          const key = coordinate(index);
          if (memory) { const text = memory.get(key); return text === undefined ? undefined : decode(text); }
          const pointer = await table!.get(key); check();
          return pointer === undefined ? undefined : read(pointer);
        }); },
        async *values(): AsyncGenerator<AxisMetadata> {
          check(); const expected = count;
          const entries = table?.entries(start, end);
          try {
            if (entries) while (true) {
              const value = await serial(async () => {
                if (count !== expected) throw new SsconvertError('invalid-request', 'Axis storage changed during replay');
                const next = await entries.next(); check();
                return next.done ? undefined : read(next.value[1]);
              });
              if (value === undefined) break; yield value;
            }
            else for (const [, text] of [...memory!].filter(([key]) => key >= start && key < end).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
              check(); yield decode(text);
            }
            check();
            if (count !== expected) throw new SsconvertError('invalid-request', 'Axis storage changed during replay');
          } finally { await entries?.return(undefined); }
        }
      };
    }
  };
}
