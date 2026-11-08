import { expect, it } from 'vitest';
import { createOdfCellStorage } from './odf-cell-storage.js';

it('orders owned cell records across sheets and preserves all signed zeros and UTF-16', async () => {
  const bytes = new Uint8Array(4 * 1024 * 1024), borrowed = new Uint8Array(16384); let end = 8, reads = 0, writes = 0;
  const store = createOdfCellStorage({ allocate(length) { const at = end; end += length; expect(end).toBeLessThan(bytes.length); return at; },
    async read(at, length) { reads++; expect(length).toBeLessThanOrEqual(16384); borrowed.set(bytes.subarray(at, at + length)); return borrowed.subarray(0, length); },
    async write(at, value) { writes++; expect(value.length).toBeLessThanOrEqual(16384); bytes.set(value, at); }, async close() { throw new Error('borrowed backing closed'); }
  }, new AbortController().signal);
  for (let row = 199; row >= 0; row--) for (const sheet of [1, 0]) await store.append(sheet, { row, column: row % 3,
    value: { kind: 'number', value: -0 }, style: { nested: { zero: -0, text: '\ud800😀' } } });
  for (let pass = 0; pass < 2; pass++) await Promise.all([0, 1].map(async sheet => {
    let row = 0;
    for await (const cell of store.cells(sheet)) {
      expect(cell).toEqual({ row, column: row % 3, value: { kind: 'number', value: -0 }, style: { nested: { zero: -0, text: '\ud800😀' } } });
      Object.assign(cell, { row: 999, value: { kind: 'blank' }, style: {} }); row++;
    }
    expect(row).toBe(200);
  }));
  expect(reads).toBeGreaterThan(0); expect(writes).toBeGreaterThan(0);
  await store.close();
  await expect(store.cells(0).next()).rejects.toThrow('closed');
});

it('waits for pending writes before erasing scratch on close', async () => {
  let release!: () => void, entered!: () => void, borrowed: Uint8Array | undefined;
  const enteredWrite = new Promise<void>(resolve => { entered = resolve; });
  const writing = new Promise<void>(resolve => { release = resolve; });
  const store = createOdfCellStorage({ allocate() { return 8; }, async read() { throw new Error('unexpected read'); },
    async write(_position, bytes) { borrowed = bytes; entered(); await writing; }, async close() { throw new Error('borrowed backing closed'); }
  }, new AbortController().signal);
  const append = expect(store.append(0, { row: 0, column: 0, value: { kind: 'number', value: 42 } })).rejects.toThrow('closed');
  await enteredWrite;
  const before = borrowed!.slice(); let closed = false;
  const close = store.close().then(() => { closed = true; });
  await Promise.resolve(); expect(closed).toBe(false); expect(borrowed).toEqual(before);
  release(); await append; await close;
  expect(borrowed!.every(byte => byte === 0)).toBe(true);
});
