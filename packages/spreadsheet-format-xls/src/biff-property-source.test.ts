import * as properties from './biff-encrypted-properties-write.js';
import { vi } from 'vitest';
import { createBiffWriter } from './biff.js';
import { expect, it } from 'vitest';
import type { CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
import { prepareBiffPropertyContainer, prepareBiffPropertySource } from './biff-encrypted-properties-write.js';
import { createRc4Cipher, rc4Stream } from './biff-encryption.js';

function fixture() {
  const controller = new AbortController(), failure = new Error('backing failure'), cleanups: (() => void | Promise<void>)[] = [];
  const state = { closed: 0, acquired: 0, mode: '', pending: 0, writes: [] as Uint8Array[], hold: undefined as (() => Promise<void>) | undefined };
  const stored = new Uint8Array(300000), borrowed = new Uint8Array(16384); let end = 17;
  const context: CapabilityContext = { signal: controller.signal, own(fn) { cleanups.push(fn); },
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, limits: { inputBytes: 2e6, outputBytes: 2e6, cells: 10, sheets: 2, operations: 100 },
    createWorkingStorage() {
      state.acquired++; if (state.mode === 'acquire') throw failure;
      return { allocate(length) { if (state.mode === 'allocate') throw failure; const at = end; end += length; return at; },
        async write(at, bytes) {
          expect(++state.pending).toBe(1); expect(bytes.length).toBeLessThanOrEqual(16384); state.writes.push(bytes);
          try { await state.hold?.(); if (state.mode === 'write') throw failure; stored.set(bytes, at);
            if (state.mode === 'abort') controller.abort(failure);
          } finally { state.pending--; }
        }, async read(at, length) {
          expect(length).toBeLessThanOrEqual(16384); if (state.mode === 'read') throw failure;
          borrowed.set(stored.subarray(at, at + length)); return borrowed.subarray(0, state.mode === 'short' ? length - 1 : length);
        }, async close() { expect(state.pending).toBe(0); state.closed++; if (state.mode === 'close') throw failure; } };
    } };
  const key = (block: number) => new Uint8Array([42, block & 255, block >>> 8]);
  const cipher = (block: number) => createRc4Cipher(key(block), context);
  const streams = new Map(Array.from({ length: 500 }, (_, i) => [`Property${i}`, new Uint8Array(i ? 1 : 100003).fill(i % 251)]));
  return { context, state, controller, failure, cleanups, streams, key, cipher };
}
it('stages payloads and directory in bounded windows with exact restart semantics and owned reads', async () => {
  const { context, state, streams, key, cipher } = fixture();
  const expected = prepareBiffPropertyContainer(streams, context, () => {})(
    (block, length) => rc4Stream(key(block), length, context));
  const source = await prepareBiffPropertySource(streams, context, () => {})(cipher);
  expect(source.size).toBe(expected.length); expect(state.acquired).toBe(1);
  for (let at = 0; at < expected.length;) {
    const bytes = await source.read(at, expected.length); expect(bytes.length).toBeLessThanOrEqual(16384);
    expect(bytes).toEqual(expected.subarray(at, at + bytes.length)); at += bytes.length;
  }
  const [a, b] = await Promise.all([source.read(0, 50), source.read(30, 50)]);
  expect(a).toEqual(expected.subarray(0, 50)); expect(b).toEqual(expected.subarray(30, 80));
  expect(state.writes.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
  await source.close(); await source.close(); expect(state.closed).toBe(1);
  await expect(source.read(0, 1)).rejects.toThrow('closed');
});
it.each(['acquire', 'allocate', 'write', 'abort'])('cleans partial staging after %s failure', async mode => {
  const { context, state, failure, cleanups, streams, cipher } = fixture(); state.mode = mode;
  await expect(prepareBiffPropertySource(streams, context, () => {})(cipher)).rejects.toBe(failure);
  for (const close of cleanups) await close(); expect(state.closed).toBe(mode === 'acquire' ? 0 : 1);
  expect(state.writes.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});
it.each(['read', 'short', 'close'])('preserves staged %s errors', async mode => {
  const { context, state, streams, cipher, failure } = fixture();
  const source = await prepareBiffPropertySource(streams, context, () => {})(cipher); state.mode = mode;
  if (mode === 'close') await expect(source.close()).rejects.toBe(failure);
  else { if (mode === 'read') await expect(source.read(0, 1)).rejects.toBe(failure);
    else await expect(source.read(0, 1)).rejects.toThrow('Truncated'); await source.close(); }
  expect(state.closed).toBe(1);
});
it('waits for a pending write before disposal, then revokes further writes', async () => {
  const { context, state, streams, cipher, cleanups } = fixture();
  let resume!: () => void, entered!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  state.hold = () => { entered(); return new Promise<void>(resolve => { resume = resolve; }); };
  const prepared = prepareBiffPropertySource(streams, context, () => {}), pending = prepared(cipher); await writing;
  const closing = cleanups[0]!(); expect(state.closed).toBe(0); resume();
  await expect(pending).rejects.toThrow('closed'); await closing; expect(state.closed).toBe(1);
  expect(state.writes.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});
it('admits before acquisition and captures the caller storage capability before password callbacks', async () => {
  const { context, state, streams, cipher, cleanups } = fixture();
  expect(() => prepareBiffPropertySource(streams, { ...context, limits: { ...context.limits, outputBytes: 8 } }, () => {})).toThrow('limit');
  expect(state.acquired).toBe(0);
  const ctx = { ...context }, prepared = prepareBiffPropertySource(streams, ctx, () => {});
  ctx.createWorkingStorage = () => { throw new Error('replaced'); };
  const source = await prepared(cipher); await source.close();
  const disposed = prepareBiffPropertySource(streams, context, () => {}); await cleanups.at(-1)!();
  await expect(disposed(cipher)).rejects.toThrow('closed'); expect(state.acquired).toBe(1);
});

it.each([40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120, 128])('publishes CryptoAPI-%s properties through CFB without the buffered property writer', async bits => {
  const { context, state } = fixture();
  const ctx = { ...context, password: { async read() { return 'secret'; } },
    entropy: { async read() { return Uint8Array.from({ length: 32 }, (_, i) => i); } } };
  const book = { sheets: [{ id: 's', name: 'S', cells: [] }], properties: { 'dc:title': 'Hidden' },
    unsupportedRecords: [{ source: 'biff' as const, kind: 'encrypted-ancillary', disposition: 'retained' as const,
      data: { stream: 'Opaque', bytes: 'abcd'.repeat(50000) } }] };
  const options = [`encryption=rc4-cryptoapi-${bits}-properties`], bufferedContext = { ...ctx };
  delete bufferedContext.createWorkingStorage;
  const expected = await createBiffWriter(8)(book, options, bufferedContext);
  const spy = vi.spyOn(properties, 'prepareBiffPropertyContainer').mockImplementation(() => { throw new Error('buffered property writer'); });
  const original = properties.prepareBiffPropertySource;
  const ranges = vi.spyOn(properties, 'prepareBiffPropertySource').mockImplementation((streams, ...args) => {
    expect(streams.get('Opaque')).not.toBeInstanceOf(Uint8Array); return original(streams, ...args);
  });
  try {
    expect(await createBiffWriter(8)(book, options, ctx)).toEqual(expected);
    expect(spy).not.toHaveBeenCalled(); expect(state.acquired).toBe(2); expect(state.closed).toBe(2);
  } finally { spy.mockRestore(); ranges.mockRestore(); }
});

it('preserves staging and cleanup failures together', async () => {
  const { context, state, streams, cipher, failure } = fixture(), cleanupFailure = new Error('close failure');
  const acquire = context.createWorkingStorage!;
  const ctx = { ...context, createWorkingStorage() {
    const store = acquire(); return { ...store, async close() { state.closed++; throw cleanupFailure; } };
  } };
  state.mode = 'write';
  await expect(prepareBiffPropertySource(streams, ctx, () => {})(cipher)).rejects.toMatchObject({ errors: [failure, cleanupFailure] });
  expect(state.closed).toBe(1);
});
it('closes the active cipher on backing failure and does not mutate borrowed property inputs', async () => {
  const { context, state, streams, cipher, failure } = fixture(), closes: number[] = [];
  state.mode = 'write';
  await expect(prepareBiffPropertySource(streams, context, () => {})(block => {
    const value = cipher(block); return { xor: value.xor, close() { closes.push(block); value.close(); } };
  })).rejects.toBe(failure);
  expect(closes).toEqual([0, 0]);
  for (const [index, bytes] of [...streams.values()].entries()) expect(bytes.every(byte => byte === index % 251)).toBe(true);
});

it.each([false, true])('preserves empty property payloads, with an empty directory=%s', async empty => {
  const { context, cipher, key } = fixture(), streams = empty ? new Map<string, Uint8Array>() : new Map([['Empty', new Uint8Array()]]);
  const expected = prepareBiffPropertyContainer(streams, context, () => {})((block, size) => rc4Stream(key(block), size, context));
  const source = await prepareBiffPropertySource(streams, context, () => {})(cipher);
  expect(await source.read(0, source.size)).toEqual(expected); expect(await source.read(source.size, 1)).toEqual(new Uint8Array());
  await expect(source.read(-1, 1)).rejects.toThrow('Invalid'); await expect(source.read(0, NaN)).rejects.toThrow('Invalid');
  await expect(source.read(source.size + 1, 1)).rejects.toThrow('Invalid');
  const controller = new AbortController(), reason = new Error('reader cancelled'); controller.abort(reason);
  await expect(source.read(0, 1, { signal: controller.signal })).rejects.toBe(reason); await source.close();
});

it('stages generated borrowed property ranges without collecting a complete plaintext stream', async () => {
  const { context, state, cipher, key } = fixture(), borrowed = new Uint8Array(257);
  const plain = Uint8Array.from({ length: 100003 }, (_, i) => i % 251);
  const expected = prepareBiffPropertyContainer(new Map([['Generated', plain]]), context, () => {})(
    (block, size) => rc4Stream(key(block), size, context));
  let reads = 0;
  const input = { size: plain.length, async read(at: number, count: number) {
    expect(count).toBeLessThanOrEqual(16384); reads++;
    const size = Math.min(count, borrowed.length); for (let i = 0; i < size; i++) borrowed[i] = (at + i) % 251;
    return borrowed.subarray(0, size);
  } };
  const prepared = prepareBiffPropertySource(new Map([['Generated', input]]), context, () => {});
  input.size = 0; input.read = async () => { throw new Error('replaced'); };
  const source = await prepared(cipher); expect(reads).toBeGreaterThan(380);
  for (let at = 0; at < expected.length;) { const bytes = await source.read(at, expected.length); expect(bytes).toEqual(expected.subarray(at, at + bytes.length)); at += bytes.length; }
  await source.close(); expect(state.closed).toBe(1);
});

it.each(['read', 'empty', 'oversized', 'abort'])('retires staged storage after %s property input failure', async mode => {
  const { context, state, cipher, failure, controller } = fixture();
  const borrowed = new Uint8Array(16385).fill(7);
  const input = { size: 20000, async read() {
    if (mode === 'read') throw failure;
    if (mode === 'abort') controller.abort(failure);
    return mode === 'empty' ? new Uint8Array() : borrowed;
  } };
  const result = prepareBiffPropertySource(new Map([['Input', input]]), context, () => {})(cipher);
  if (mode === 'empty' || mode === 'oversized') await expect(result).rejects.toThrow('Truncated');
  else await expect(result).rejects.toBe(failure);
  expect(state.closed).toBe(1); expect(borrowed.every(byte => byte === 7)).toBe(true);
  expect(state.writes.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});
it.each([-1, Infinity, NaN, 1.5])('rejects invalid property range size %s before acquiring storage', size => {
  const { context, state } = fixture();
  expect(() => prepareBiffPropertySource(new Map([['Input', { size, async read() { return new Uint8Array(); } }]]), context, () => {})).toThrow('Invalid');
  expect(state.acquired).toBe(0);
});

it('checks node admission before capturing any input capabilities', () => {
  const { context } = fixture();
  const input = { size: 1, get read(): (position: number, count: number) => Promise<Uint8Array> { throw new Error('input inspected'); } };
  expect(() => prepareBiffPropertySource(new Map([['Input', input]]),
    { ...context, limits: { ...context.limits, workbookNodes: 0 } }, () => {})).toThrow('node limit');
});
