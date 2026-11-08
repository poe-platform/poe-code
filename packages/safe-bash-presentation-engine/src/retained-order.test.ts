import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { PagedStorage } from '@poe-code/safe-fs/storage';
import { RetainedValues, literal } from './retained-values.js';
import { RetainedOrder } from './retained-order.js';
it('sorts retained Unicode keys in stable JavaScript string order without scalar collection', async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal, pages = new PagedStorage({ fs, cwd: '/', env: {}, signal }, 1);
  const values = new RetainedValues(pages, () => signal.throwIfAborted(), signal), order = new RetainedOrder(pages, values, () => signal.throwIfAborted());
  const keys = ['z', '\uffff', '😀', '', 'aa', 'a', 'aa', 'é', 'éa', 'Ω', '𐀀', '\ud7ff', '\ue000'];
  for (const [i, key] of keys.entries()) await order.add(literal(key), { start: i, length: 1 });
  const expected = keys.map((key, i) => ({ key, i })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(value => value.i);
  await order.seal(); const actual = []; for await (const value of order.entries()) actual.push(value.start);
  expect(actual).toEqual(expected); await expect(order.add(literal('new'), { start: 1, length: 1 })).rejects.toThrow();
  await pages.close(); expect(await fs.readdir('/')).toEqual([]);
});
it('does not expose an in-progress or failed sort', async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal, pages = new PagedStorage({ fs, cwd: '/', env: {}, signal }, 1);
  let fail = false;
  const check = () => { if (fail) throw new Error('injected sort failure'); };
  const values = new RetainedValues(pages, check, signal), order = new RetainedOrder(pages, values, check);
  await order.add(literal('b'), { start: 2, length: 1 });
  await order.add(literal('a'), { start: 1, length: 1 });
  const sorting = order.seal();
  await expect(order.entries().next()).rejects.toMatchObject({ code: 'invalid-handle' });
  fail = true;
  await expect(sorting).rejects.toThrow('injected sort failure');
  fail = false;
  await expect(order.entries().next()).rejects.toMatchObject({ code: 'invalid-handle' });
  await expect(order.seal()).rejects.toMatchObject({ code: 'invalid-handle' });
  await pages.close(); expect(await fs.readdir('/')).toEqual([]);
});
it('compares spilled keys across chunk boundaries while their producers reuse buffers', async () => {
  const fs = createMemoryFileSystem(), signal = new AbortController().signal, pages = new PagedStorage({ fs, cwd: '/', env: {}, signal }, 1);
  const values = new RetainedValues(pages, () => signal.throwIfAborted(), signal), order = new RetainedOrder(pages, values, () => signal.throwIfAborted());
  async function* key(suffix: string) {
    const chunk = new Uint8Array(4096);
    for (let n = 0; n < 8; n++) { chunk.fill(97); yield chunk; chunk.fill(255); }
    yield new TextEncoder().encode(suffix);
  }
  for (const [i, suffix] of ['z', '😀', '', 'a', '😀', '\uffff'].entries()) await order.add(key(suffix), { start: i, length: 1 });
  await order.seal(); await order.seal();
  const actual = []; for await (const value of order.entries()) actual.push(value.start);
  expect(actual).toEqual([2, 3, 0, 1, 4, 5]);
  await pages.close(); expect(await fs.readdir('/')).toEqual([]);
});
