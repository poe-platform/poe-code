import { expect, it } from 'vitest';
import type { AxisMetadata } from '@poe-code/spreadsheet-ast';
import type { WorkingStorage } from '../contracts.js';
import { createAxisStorage } from './axis-storage.js';

function fixture() {
  const bytes = new Uint8Array(4 * 1024 * 1024), borrowed = new Uint8Array(16384);
  let end = 8, active = 0, reads = 0, writes = 0;
  const windows = new Set<Uint8Array>();
  const storage: WorkingStorage = {
    allocate(length) { const position = end; end += length; expect(end).toBeLessThanOrEqual(bytes.length); return position; },
    async read(position, count) {
      expect(++active).toBe(1); reads++; expect(count).toBeLessThanOrEqual(16384);
      try { await Promise.resolve(); borrowed.set(bytes.subarray(position, position + count)); return borrowed.subarray(0, count); }
      finally { active--; }
    },
    async write(position, chunk) {
      expect(++active).toBe(1); writes++; expect(chunk.length).toBeLessThanOrEqual(16384); windows.add(chunk);
      try { await Promise.resolve(); bytes.set(chunk, position); } finally { active--; }
    },
    async close() { throw new Error('borrowed backing must remain caller-owned'); }
  };
  return { storage, bytes, windows, get reads() { return reads; }, get writes() { return writes; } };
}

it.each([false, true])('sorts axes, isolates namespaces and returns owned records, backed=%s', async backed => {
  const f = fixture(), store = createAxisStorage(backed ? f.storage : undefined, new AbortController().signal);
  const rows = store.axis(), columns = store.axis(), other = store.axis();
  const axis: AxisMetadata = { index: 7, sizePoints: -0, style: { text: '\ud800😀'.repeat(9000), values: [-0, { zero: -0 }], '': -0 } };
  const admitted = other.add(axis); Object.assign(axis, { sizePoints: 999 }); await admitted;
  for (let index = 299; index >= 0; index--) await rows.add({ index, sizePoints: 17, outlineLevel: index % 8 });
  await columns.add({ index: 7, hidden: true });
  expect(rows.maximum).toBe(299); expect(rows.outline).toBe(7); expect(rows.count).toBe(300);
  expect(await columns.get(8)).toBeUndefined(); expect(await columns.get(7)).toEqual({ index: 7, hidden: true });
  expect(Object.is((await other.get(7))!.sizePoints, -0)).toBe(true);
  expect((await other.get(7))!.style).toEqual(axis.style);
  const left = rows.values(), right = rows.values();
  for (let index = 0; index < 300; index++) {
    const [a, b] = await Promise.all([left.next(), right.next()]);
    expect(a.value).toEqual({ index, sizePoints: 17, outlineLevel: index % 8 }); expect(b.value).toEqual(a.value);
    Object.assign(a.value!, { sizePoints: 999 });
  }
  expect((await left.next()).done).toBe(true); expect((await right.next()).done).toBe(true);
  await expect(rows.add({ index: 7 })).rejects.toThrow('Duplicate');
  for (const index of [-1, 2 ** 32, NaN, 0.5]) await expect(columns.get(index)).rejects.toThrow('Invalid stored axis coordinate');
  const early = rows.values(); await early.next(); const reads = f.reads; await early.return(undefined); expect(f.reads).toBe(reads);
  await store.close(); await store.close();
  await expect(rows.get(0)).rejects.toThrow('closed'); await expect(rows.values().next()).rejects.toThrow('closed');
  if (backed) { expect(f.reads).toBeGreaterThan(0); expect(f.writes).toBeGreaterThan(0); }
});

it.each(['read', 'write', 'cancel-read', 'cancel-write'])('preserves %s errors and closes pending work', async mode => {
  const f = fixture(), controller = new AbortController(), failure = new Error('backing failed');
  let fail = false;
  const store = createAxisStorage({ ...f.storage,
    async read(position, count) {
      if (fail && mode.endsWith('read')) { if (mode.startsWith('cancel')) controller.abort(failure); else throw failure; }
      return f.storage.read(position, count);
    }, async write(position, bytes) {
      if (fail && mode.endsWith('write')) { if (mode.startsWith('cancel')) controller.abort(failure); else throw failure; }
      return f.storage.write(position, bytes);
    }
  }, controller.signal), axis = store.axis();
  await axis.add({ index: 0, sizePoints: 17 }); fail = true;
  const operation = mode.endsWith('read') ? axis.get(0) : axis.add({ index: 1, sizePoints: 22 });
  await expect(operation).rejects.toBe(failure); await store.close();
});

it('rejects changed iteration and malformed backing lengths', async () => {
  const f = fixture(); let truncate = false;
  const store = createAxisStorage({ ...f.storage, async read(position, count) {
    const bytes = await f.storage.read(position, count); return truncate && count === 8 ? bytes.subarray(0, 7) : bytes;
  } }, new AbortController().signal), axis = store.axis();
  await axis.add({ index: 0 });
  const cursor = axis.values(); await cursor.next(); await axis.add({ index: 1 });
  await expect(cursor.next()).rejects.toThrow('changed during replay');
  truncate = true; await expect(axis.get(0)).rejects.toThrow('Truncated axis header');
  await store.close();
});


it('waits for pending writes before erasing the transfer window on close', async () => {
  const f = fixture(); let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let window: Uint8Array | undefined;
  const store = createAxisStorage({ ...f.storage, async write(position, bytes) {
    window = bytes; entered(); await gate; await f.storage.write(position, bytes);
  } }, new AbortController().signal);
  const writing = store.axis().add({ index: 0, sizePoints: 17 });
  await started;
  const rejected = expect(writing).rejects.toThrow('closed');
  let finished = false;
  const closing = store.close().then(() => { finished = true; });
  await Promise.resolve(); expect(finished).toBe(false);
  release(); await rejected; await closing;
  expect(window!.every(byte => byte === 0)).toBe(true);
});
