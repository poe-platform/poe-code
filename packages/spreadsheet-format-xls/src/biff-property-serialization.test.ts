import * as mergeProperties from './biff-properties-merge.js';
import { mergeBiffProperties } from './biff-properties-merge.js';
import type { BiffPropertySource } from './biff-encrypted-properties-write.js';
import { stagePropertyBytes } from './biff-property-bytes.js';
import { expect, it, vi } from 'vitest';
import type { CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
import { writeBiffProperties } from './biff-properties-write.js';
import { createBiffWriter, readBiff } from './biff.js';
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { inputBytes: 2e6, outputBytes: 2e6, workbookWork: 30e6, cells: 10, sheets: 2, operations: 100 } };
function fixture() {
  const cleanups: (() => void | Promise<void>)[] = [], state = { closed: 0, acquired: 0, mode: '', pending: 0, writes: [] as Uint8Array[], hold: undefined as (() => Promise<void>) | undefined }, failure = new Error('backing failure');
  const ctx: CapabilityContext = { ...context, own(fn) { cleanups.push(fn); }, createWorkingStorage() {
    state.acquired++; if (state.mode === 'acquire') throw failure;
    const ordinal = state.acquired, data = new Uint8Array(2e6), borrowed = new Uint8Array(16384); let end = 23;
    return { allocate(length) { if (state.mode === 'allocate') throw failure; const at = end; end += length; return at; }, async write(at, bytes) {
      expect(bytes.length).toBeLessThanOrEqual(16384); expect(++state.pending).toBe(1);
      try { state.writes.push(bytes); await state.hold?.(); if (state.mode === 'write') throw failure; data.set(bytes, at); } finally { state.pending--; }
    }, async read(at, length) { expect(length).toBeLessThanOrEqual(16384); if (state.mode === 'read' || state.mode === 'output-read' && ordinal > 2) throw failure;
      borrowed.set(data.subarray(at, at + length)); return borrowed.subarray(0, length); },
    async close() { expect(state.pending).toBe(0); state.closed++; } };
  } };
  return { ctx, state, failure, cleanups };
}
const book = { sheets: [{ id: 's', name: 'S', cells: [] }], properties: {
  'dc:title': '漢😀\0x'.repeat(12000), 'dc:creator': 'Writer', 'meta:page-count': 7,
  'dc:keywords': ['first', 'second'], 'meta:creation-date': '2020-01-02T03:04:05.1234567Z',
  Custom: 'é'.repeat(50000), Number: -0, Boolean: true
} };
it('serializes large Unicode properties into caller storage without large TextEncoder destinations', async () => {
  const expected = await writeBiffProperties(book, context), { ctx, state, cleanups } = fixture();
  const original = TextEncoder.prototype.encodeInto;
  const spy = vi.spyOn(TextEncoder.prototype, 'encodeInto').mockImplementation(function (this: TextEncoder, source, destination) {
    expect(destination.length).toBeLessThanOrEqual(16384); return original.call(this, source, destination);
  });
  try {
    const actual = await writeBiffProperties(book, ctx, true);
    for (const [name, source] of actual.streams) {
      expect(source).not.toBeInstanceOf(Uint8Array); expect(source.size).toBe(expected.streams.get(name)!.length);
      for (let at = 0; at < source.size;) { const bytes = await source.read(at, source.size); expect(bytes).toEqual(expected.streams.get(name)!.subarray(at, at + bytes.length)); at += bytes.length; }
    }
    await actual.close(); expect(state.closed).toBe(state.acquired);
  } finally { spy.mockRestore(); for (const cleanup of cleanups) await cleanup(); }
  expect(state.closed).toBe(state.acquired);
});
it.each([false, true])('preserves whole-export bytes with retained snapshots=%s', async retained => {
  const { ctx, state } = fixture();
  const input = retained ? await readBiff(await createBiffWriter(8)(book, [], context), context) : book;
  const edited = { ...input, properties: { ...input.properties, Custom: 'replacement' } };
  const expected = await createBiffWriter(8)(edited, [], context);
  expect(await createBiffWriter(8)(edited, [], ctx)).toEqual(expected);
  expect(state.closed).toBe(state.acquired);
});
it.each(['acquire', 'allocate', 'write'])('cleans property serialization after %s failure', async mode => {
  const { ctx, state, failure, cleanups } = fixture(); state.mode = mode;
  await expect(writeBiffProperties(book, ctx, true).then(() => undefined)).rejects.toBe(failure);
  for (const cleanup of cleanups) await cleanup(); expect(state.closed).toBe(mode === 'acquire' ? 0 : state.acquired);
});

it('waits for an in-flight serialized write before disposal and clears borrowed output buffers', async () => {
  const { ctx, state, cleanups } = fixture(); let resume!: () => void, entered!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  state.hold = () => { entered(); return new Promise<void>(resolve => { resume = resolve; }); };
  const pending = writeBiffProperties(book, ctx, true).then(() => undefined); await writing;
  const closing = cleanups[0]!(); expect(state.closed).toBe(0); resume();
  await expect(pending).rejects.toThrow('closed'); await closing;
  expect(state.closed).toBe(state.acquired); expect(state.writes.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});
it('copies borrowed concurrent reads and rejects reads after close', async () => {
  const { ctx, state } = fixture(); const result = await writeBiffProperties(book, ctx, true);
  const source = result.streams.values().next().value!, expected = await source.read(0, 80);
  const [a, b] = await Promise.all([source.read(0, 80), source.read(40, 80)]);
  expect(a).toEqual(expected); b.fill(0); expect(a).toEqual(expected);
  state.mode = 'read'; await expect(source.read(0, 1)).rejects.toThrow('backing failure');
  await result.close(); await expect(source.read(0, 1)).rejects.toThrow('closed');
  expect(state.closed).toBe(state.acquired);
});
it.each([1, 3])('rejects a lazy serialization whose declared size %s disagrees with its bytes', async length => {
  const { ctx, state } = fixture();
  await expect(stagePropertyBytes({ length, *chunks() { yield new Uint8Array(2); } }, ctx).then(() => undefined)).rejects.toThrow('serialization');
  expect(state.closed).toBe(1);
});

it.each([[false, false], [true, false], [false, true], [true, true]])('publishes large properties through injected safe-fs with encryption=%s retained=%s', async (encrypted, retained) => {
  const { createMemoryFileSystem } = await import('@poe-code/safe-fs/core');
  const { createEngine } = await import('@poe-code/spreadsheet-engine');
  const { xlsFormat } = await import('./index.js');
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs); let pending = 0, written = 0;
  vi.spyOn(fs, 'readFile').mockRejectedValue(new Error('whole-file read'));
  vi.spyOn(fs, 'writeFile').mockRejectedValue(new Error('whole-file write'));
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle);
    vi.spyOn(handle, 'write').mockImplementation(async (bytes, ...args) => {
      pending += bytes.length; written += bytes.length; expect(pending).toBeLessThanOrEqual(16384);
      try { await Promise.resolve(); return await write(bytes, ...args); } finally { pending -= bytes.length; }
    }); return handle;
  });
  const password = { async read() { return 'secret'; } }, entropy = { async read() { return Uint8Array.from({ length: 32 }, (_, i) => i); } };
  const options = encrypted ? ['encryption=rc4-cryptoapi-128-properties'] : [];
  const input = retained ? await readBiff(await createBiffWriter(8)(book, [], context), context) : book;
  const expected = await createBiffWriter(8)(input, options, { ...context, password, entropy });
  const engine = createEngine({ formats: [xlsFormat], password, entropy, workingFiles: { fs, directory: '/', cacheBytes: 16384 } });
  try {
    const adopted = await engine.adoptWorkbook(input, { signal: context.signal }); let at = 0;
    await engine.writeWorkbook(adopted, { kind: 'stream', sink: { async write(bytes) {
      expect(bytes.length).toBeLessThanOrEqual(16384); expect(bytes.every((byte, i) => byte === expected[at + i])).toBe(true);
      at += bytes.length; await Promise.resolve();
    } } }, { exportType: 'Gnumeric_Excel:excel_biff8', exportOptions: options }, { signal: context.signal });
    expect(at).toBe(expected.length); expect(written).toBeGreaterThan(200000); expect(await fs.readdir('/')).toEqual([]);
  } finally { await engine.dispose(); }
});

it('merges retained properties without allocating complete snapshot, section or stream bytes', async () => {
  const input = await readBiff(await createBiffWriter(8)(book, [], context), context);
  const expected = { streams: new Map<string, Uint8Array>() }, { ctx, state, cleanups } = fixture();
  await mergeBiffProperties(input, expected.streams, new Set(), context, () => {}, length => new Uint8Array(length));
  const sources = new Map<string, BiffPropertySource>(), allocations: number[] = [];
  try {
    await mergeBiffProperties(input, new Map(), new Set(), ctx, () => {}, length => {
      allocations.push(length); return new Uint8Array(length);
    }, { sources, reserve: length => length });
    expect(sources.size).toBe(expected.streams.size);
    expect(allocations.filter(size => size > 16384)).toHaveLength(0);
    for (const [name, source] of sources) {
      const bytes = expected.streams.get(name)!; expect(source.size).toBe(bytes.length);
      for (let at = 0; at < source.size;) { const part = await source.read(at, source.size); expect(part).toEqual(bytes.subarray(at, at + part.length)); at += part.length; }
    }
  } finally { for (const cleanup of cleanups) await cleanup(); }
  expect(state.closed).toBe(state.acquired);
});

it.each(['second-write', 'output-write', 'read', 'output-read', 'abort'])('cleans retained merge output after %s failure', async mode => {
  const input = await readBiff(await createBiffWriter(8)(book, [], context), context);
  const { ctx, state, failure, cleanups } = fixture(), controller = new AbortController();
  const retainedContext = { ...ctx, signal: controller.signal };
  if (mode === 'read' || mode === 'output-read') state.mode = mode;
  state.hold = async () => {
    if (state.acquired === (mode === 'second-write' ? 2 : 4)) {
      if (mode === 'second-write' || mode === 'output-write') throw failure;
      if (mode === 'abort') controller.abort(failure);
    }
  };
  await expect(writeBiffProperties(input, retainedContext, true)).rejects.toBe(failure);
  for (const cleanup of cleanups) await cleanup();
  expect(state.closed).toBe(state.acquired); expect(state.acquired).toBe(mode === 'second-write' || mode === 'read' ? 2 : 4);
  expect(state.writes.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});

it('keeps freshly serialized merge inputs in caller storage', async () => {
  const input = await readBiff(await createBiffWriter(8)(book, [], context), context);
  const { ctx, state, cleanups } = fixture(), merge = mergeProperties.mergeBiffProperties;
  const spy = vi.spyOn(mergeProperties, 'mergeBiffProperties').mockImplementation(async (...args) => {
    expect(args[1].size).toBeGreaterThan(0);
    for (const source of args[1].values()) expect(source).not.toBeInstanceOf(Uint8Array);
    return merge(...args);
  });
  try { const result = await writeBiffProperties(input, ctx, true); await result.close(); }
  finally { spy.mockRestore(); for (const cleanup of cleanups) await cleanup(); }
  expect(state.closed).toBe(state.acquired);
});

it.each(['odd', 'invalid-tail'])('rejects %s snapshot hex before opening output storage', async mode => {
  const input = await readBiff(await createBiffWriter(8)(book, [], context), context);
  const snapshot = input.unsupportedRecords!.find(record => record.kind === 'ole-properties')!;
  const data = snapshot.data as { bytes: string; stream: string };
  const corrupted = { ...input, unsupportedRecords: [{ ...snapshot, data: { ...data,
    bytes: data.bytes.slice(0, -1) + (mode === 'odd' ? '' : 'g') } }] };
  const { ctx, state } = fixture();
  await expect(mergeBiffProperties(corrupted, new Map(), new Set(), ctx, () => {}, length => new Uint8Array(length),
    { sources: new Map(), reserve: length => length })).rejects.toThrow('invalid retained property bytes');
  expect(state.acquired).toBe(0);
});
