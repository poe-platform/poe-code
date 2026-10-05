import { BiffOriginalProperties } from './biff-property-observations.js';
import { BiffPropertyNames } from './biff-property-names.js';
import { BiffMutablePropertyValues } from './biff-property-values.js';
import { visitBiffPropertyDictionary } from './biff-property-dictionary.js';
import { encryptedBiffPropertyStream } from './biff-encrypted-properties.js';
import { readBiffProperties } from './biff-properties.js';
import { BiffPropertyRange, propertyRange, readPropertyValueRanges, readPropertySectionRanges, withPropertyValueRanges, type BiffPropertyValues } from './biff-property-range.js';
import { Binary } from './biff-binary.js';
import { readBiffPropertySections, readBiffPropertyValues } from './biff-properties-layout.js';
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
  const cleanups: (() => void | Promise<void>)[] = [], state = { closed: 0, acquired: 0, mode: '', pending: 0, writes: [] as Uint8Array[], hold: undefined as ((ordinal: number, bytes: Uint8Array) => Promise<void>) | undefined }, failure = new Error('backing failure');
  const ctx: CapabilityContext = { ...context, own(fn) { cleanups.push(fn); }, createWorkingStorage() {
    state.acquired++; if (state.mode === 'acquire') throw failure;
    const ordinal = state.acquired, data = new Uint8Array(2e6), borrowed = new Uint8Array(16384); let end = 23, output = false;
    return { allocate(length) { if (state.mode === 'allocate') throw failure; const at = end; end += length; return at; }, async write(at, bytes) {
      expect(bytes.length).toBeLessThanOrEqual(16384); expect(++state.pending).toBe(1);
      try { state.writes.push(bytes); if (ordinal > 2 && bytes.length >= 28 && bytes[0] === 0xfe && bytes[1] === 0xff) output = true; await state.hold?.(ordinal, bytes); if (state.mode === 'write') throw failure; data.set(bytes, at); } finally { state.pending--; }
    }, async read(at, length) { expect(length).toBeLessThanOrEqual(16384); if (state.mode === 'read' || state.mode === 'output-read' && output) throw failure;
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
  state.hold = async (ordinal, bytes) => {
    if (mode === 'second-write' && ordinal === 2) throw failure;
    if (ordinal > 2 && bytes.length >= 28 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      if (mode === 'output-write') throw failure;
      if (mode === 'abort') controller.abort(failure);
    }
  };  await expect(writeBiffProperties(input, retainedContext, true)).rejects.toBe(failure);
  for (const cleanup of cleanups) await cleanup();
  expect(state.closed).toBe(state.acquired);
  if (mode === 'second-write' || mode === 'read') expect(state.acquired).toBe(mode === 'second-write' ? 2 : 3);
  else expect(state.acquired).toBeGreaterThan(4);
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

it.each(['success', 'transcode-write', 'output-write', 'output-read', 'abort'])('transcodes retained legacy replacements with bounded decoding and cleanup (%s)', async mode => {
  const seed = { sheets: book.sheets, properties: { 'dc:title': 'old' } };
  const original = (await writeBiffProperties(seed, context)).streams.get('\u0005SummaryInformation')!;
  const view = new DataView(original.buffer), section = view.getUint32(44, true);
  for (let i = 0; i < view.getUint32(section + 4, true); i++) if (view.getUint32(section + 8 + i * 8, true) === 1)
    view.setUint16(section + view.getUint32(section + 12 + i * 8, true) + 4, 1252, true);
  const input = { ...seed, properties: { 'dc:title': 'a'.repeat(8191) + '😀漢'.repeat(15000) }, unsupportedRecords: [{
    source: 'biff', kind: 'ole-properties', disposition: 'retained' as const,
    data: { stream: '\u0005SummaryInformation', bytes: Array.from(original, byte => byte.toString(16).padStart(2, '0')).join(''), modeled: [[section, 2, 'dc:title']] }
  }] };
  const expected = await writeBiffProperties(input, context), { ctx, state, failure, cleanups } = fixture();
  const controller = new AbortController(), runContext = { ...ctx, signal: controller.signal };
  if (mode === 'output-read') state.mode = mode;
  state.hold = async (ordinal, bytes) => {
    if (mode === 'transcode-write' && bytes.length >= 8 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === 31) throw failure;
    if (mode === 'output-write' && ordinal > 1 && bytes.length >= 28 && bytes[0] === 0xfe && bytes[1] === 0xff) throw failure;
    if (mode === 'abort' && state.acquired === 2) controller.abort(failure);
  };  const decode = TextDecoder.prototype.decode;
  const spy = vi.spyOn(TextDecoder.prototype, 'decode').mockImplementation(function (this: TextDecoder, bytes, options) {
    expect(bytes?.byteLength ?? 0).toBeLessThanOrEqual(16384); return decode.call(this, bytes, options);
  });
  try {
    if (mode !== 'success') await expect(writeBiffProperties(input, runContext, true)).rejects.toBe(failure);
    else {
    const actual = await writeBiffProperties(input, runContext, true);
    for (const [name, source] of actual.streams) {
      const bytes = expected.streams.get(name)!; expect(source.size).toBe(bytes.length);
      for (let at = 0; at < source.size;) { const part = await source.read(at, source.size); expect(part).toEqual(bytes.subarray(at, at + part.length)); at += part.length; }
    }
    await actual.close();
    }
  } finally { spy.mockRestore(); for (const cleanup of cleanups) await cleanup(); }
  expect(state.closed).toBe(state.acquired);
});

it.each(['success', 'dictionary-write', 'dictionary-read', 'output-write', 'abort'])('edits retained dictionaries with bounded payloads and cleanup (%s)', async mode => {
  const seed = { sheets: book.sheets, properties: { Remove: 2, ['K'.repeat(18000)]: 1 } };
  const fresh = await writeBiffProperties(seed, context), stream = '\u0005DocumentSummaryInformation';
  const original = fresh.streams.get(stream)!;
  const input = { ...seed, unsupportedRecords: [{ source: 'biff', kind: 'ole-properties', disposition: 'retained' as const,
    data: { stream, bytes: Array.from(original, byte => byte.toString(16).padStart(2, '0')).join('') } }] };
  const expected = await writeBiffProperties(input, context), { ctx, state, failure, cleanups } = fixture();
  const controller = new AbortController(), runContext = { ...ctx, signal: controller.signal };
  if (mode === 'dictionary-read') state.mode = 'read';
  state.hold = async () => {
    if (mode === 'dictionary-write' && state.acquired === 1 || mode === 'output-write' && state.acquired === 3) throw failure;
    if (mode === 'abort' && state.acquired === 1) controller.abort(failure);
  };
  const sources = new Map<string, BiffPropertySource>(), push = Array.prototype.push;
  Array.prototype.push = function (this: unknown[], ...values: unknown[]) {
    for (const value of values) if (value && typeof value === 'object' && 'id' in value && 'name' in value && 'bytes' in value && value.bytes instanceof BiffPropertyRange)
      throw new Error('resident dictionary entries');
    return push.apply(this, values);
  };
  try {
    const merging = mergeBiffProperties(input, new Map(fresh.streams), new Set(), runContext, () => {}, length => {
      expect(length).toBeLessThanOrEqual(16384); return new Uint8Array(length);
    }, { sources, reserve: length => length });
    if (mode !== 'success') await expect(merging).rejects.toBe(failure);
    else {
    await merging;
    for (const [name, source] of sources) {
      const bytes = expected.streams.get(name)!; expect(source.size).toBe(bytes.length);
      for (let at = 0; at < source.size;) { const part = await source.read(at, source.size); expect(part).toEqual(bytes.subarray(at, at + part.length)); at += part.length; }
    }
    }
  } finally { Array.prototype.push = push; for (const cleanup of cleanups) await cleanup(); }
  expect(state.closed).toBe(state.acquired);
});

it.each([65001, 1200, 1252, 932].flatMap(cp => ['success', 'name-write', 'name-read', 'output-write', 'abort'].map(mode => ({ cp, mode }))))('stages new names in codepage $cp with bounded payloads and cleanup ($mode)', async ({ cp, mode }) => {
  const seed = { sheets: book.sheets, properties: { A: 1 } }, stream = '\u0005DocumentSummaryInformation';
  const original = (await writeBiffProperties(seed, context)).streams.get(stream)!;
  const sections = readBiffPropertySections(original, () => {}, () => {}), section = sections[sections.length - 1]!;
  const values = readBiffPropertyValues(new Binary(original.subarray(section.offset, section.end)), () => {}, () => {});
  const codepage = values.get(1)!.bytes; new DataView(codepage.buffer, codepage.byteOffset, codepage.byteLength).setUint16(4, cp, true);
  const name = (cp === 1252 ? 'é' : cp === 932 ? '漢' : '漢😀').repeat(18000);
  const input = { ...seed, properties: { A: 1, [name]: 2 }, unsupportedRecords: [{ source: 'biff', kind: 'ole-properties', disposition: 'retained' as const,
    data: { stream, bytes: Array.from(original, byte => byte.toString(16).padStart(2, '0')).join('') } }] };
  const fresh = await writeBiffProperties({ ...input, unsupportedRecords: [] }, context), expected = await writeBiffProperties(input, context);
  const { ctx, state, failure, cleanups } = fixture(), sources = new Map<string, BiffPropertySource>();
  const controller = new AbortController(), runContext = { ...ctx, signal: controller.signal };
  if (mode === 'name-read') state.mode = 'output-read';
  state.hold = async () => {
    if (mode === 'name-write' && state.acquired === 3 || mode === 'output-write' && state.acquired === 5) throw failure;
    if (mode === 'abort' && state.acquired === 3) controller.abort(failure);
  };
  const encode = TextEncoder.prototype.encode;
  const spy = vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(function (this: TextEncoder, text) {
    expect(text?.length ?? 0).toBeLessThanOrEqual(16384); return encode.call(this, text);
  });
  try {
    const merging = mergeBiffProperties(input, new Map(fresh.streams), new Set(), runContext, () => {}, length => {
      expect(length).toBeLessThanOrEqual(16384); return new Uint8Array(length);
    }, { sources, reserve: length => length });
    if (mode !== 'success') await expect(merging).rejects.toBe(failure);
    else {
    await merging;
    const source = sources.get(stream)!, bytes = expected.streams.get(stream)!; expect(source.size).toBe(bytes.length);
    for (let at = 0; at < source.size;) { const part = await source.read(at, source.size); expect(part).toEqual(bytes.subarray(at, at + part.length)); at += part.length; }
    }
  } finally { spy.mockRestore(); for (const close of cleanups) await close(); }
  expect(state.closed).toBe(state.acquired);
});

it('indexes unsorted property pointers in bounded caller storage', async () => {
  const { ctx, state } = fixture(), count = 300, bytes = new Uint8Array(8 + count * 12), view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length, true); view.setUint32(4, count, true);
  for (let i = 0; i < count; i++) {
    view.setUint32(8 + i * 8, i, true);
    view.setUint32(12 + i * 8, 8 + count * 8 + (count - i - 1) * 4, true);
  }
  const values = await readPropertyValueRanges(propertyRange(bytes, ctx), () => {}, () => {}, ctx);
  expect([...values.keys()]).toEqual(Array.from({ length: count }, (_, i) => count - i - 1));
  expect(state.acquired).toBe(1); expect(state.closed).toBe(1);
});

it.each(['allocate', 'write', 'read', 'abort', 'duplicate-id', 'duplicate-offset'])('cleans property pointer indexes after %s', async mode => {
  const { ctx, state, failure } = fixture(), controller = new AbortController(), count = 300;
  const bytes = new Uint8Array(8 + count * 12), view = new DataView(bytes.buffer);
  view.setUint32(4, count, true);
  for (let i = 0; i < count; i++) {
    view.setUint32(8 + i * 8, mode === 'duplicate-id' && i === count - 1 ? 0 : i, true);
    view.setUint32(12 + i * 8, 8 + count * 8 + (mode === 'duplicate-offset' && i === count - 1 ? 0 : i) * 4, true);
  }
  state.mode = mode;
  if (mode === 'abort') state.hold = async () => { controller.abort(failure); };
  const active = { ...ctx, signal: controller.signal };
  const result = readPropertyValueRanges(propertyRange(bytes, active), () => {}, () => {}, active);
  if (mode.startsWith('duplicate')) await expect(result).rejects.toThrow(mode === 'duplicate-id' ? 'duplicate property ID' : 'overlapping property values');
  else await expect(result).rejects.toBe(failure);
  expect(state.acquired).toBe(1); expect(state.closed).toBe(1);
});

it.each([false, true])('preserves index close failures alongside parse failures=%s', async malformed => {
  const { ctx, state, failure } = fixture(), bytes = new Uint8Array(20), view = new DataView(bytes.buffer);
  view.setUint32(4, 1, true); view.setUint32(12, malformed ? 0 : 16, true);
  const active = { ...ctx, createWorkingStorage() {
    const storage = ctx.createWorkingStorage!();
    return { ...storage, async close() { await storage.close(); throw failure; } };
  } };
  const result = readPropertyValueRanges(propertyRange(bytes, active), () => {}, () => {}, active);
  if (malformed) {
    const error = await result.catch(error => error) as AggregateError;
    expect(error).toBeInstanceOf(AggregateError); expect(error.errors[0].message).toContain('invalid property offset');
    expect(error.errors[1]).toBe(failure);
  } else await expect(result).rejects.toBe(failure);
  expect(state.closed).toBe(1);
});

it.each([270, 300])('replays sorted property sections from bounded storage and closes after %s entries', async stop => {
  const { ctx, state } = fixture(), count = 300, bytes = new Uint8Array(28 + count * 28), view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfffe, true); view.setUint32(24, count, true);
  for (let i = 0; i < count; i++) {
    const offset = 28 + count * 20 + (count - i - 1) * 8;
    view.setUint32(28 + i * 20, i, true); view.setUint32(44 + i * 20, offset, true); view.setUint32(offset, 8, true);
  }
  let seen = 0;
  for await (const section of readPropertySectionRanges(propertyRange(bytes, ctx), () => {}, () => {}, ctx)) {
    expect(section.offset).toBe(28 + count * 20 + seen * 8);
    expect(section.end).toBe(section.offset + 8);
    const id = new Uint8Array(16); new DataView(id.buffer).setUint32(0, count - seen - 1, true);
    expect(section.guid).toBe(Array.from(id, byte => byte.toString(16).padStart(2, '0')).join(''));
    if (++seen === stop) break;
  }
  expect(seen).toBe(stop); expect(state.acquired).toBe(1); expect(state.closed).toBe(1);
});

it.each(['allocate', 'write', 'read', 'abort', 'duplicate', 'overlap'])('rejects property section %s before yielding and cleans storage', async mode => {
  const { ctx, state, failure } = fixture(), controller = new AbortController(), count = 300;
  const bytes = new Uint8Array(28 + count * 28 + 4), view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfffe, true); view.setUint32(24, count, true);
  for (let i = 0; i < count; i++) {
    const offset = 28 + count * 20 + i * 8;
    view.setUint32(44 + i * 20, offset, true); view.setUint32(offset, mode === 'overlap' && i === count - 2 ? 12 : 8, true);
  }
  if (mode === 'duplicate') view.setUint32(44 + (count - 1) * 20, 28 + count * 20 + (count - 2) * 8, true);
  state.mode = mode;
  if (mode === 'abort') state.hold = async () => { controller.abort(failure); };
  const active = { ...ctx, signal: controller.signal }; let yielded = 0;
  const consume = async () => {
    for await (const section of readPropertySectionRanges(propertyRange(bytes, active), () => {}, () => {}, active)) {
      yielded++; expect(section.end).toBeGreaterThan(section.offset);
    }
  };
  if (mode === 'duplicate' || mode === 'overlap') await expect(consume()).rejects.toThrow('overlapping property sections');
  else await expect(consume()).rejects.toBe(failure);
  expect(yielded).toBe(0); expect(state.acquired).toBe(1); expect(state.closed).toBe(1);
});

it.each([false, true])('reports section index close errors with malformed input=%s', async malformed => {
  const { ctx, state, failure } = fixture(), bytes = new Uint8Array(56), view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfffe, true); view.setUint32(24, 1, true);
  view.setUint32(44, malformed ? 28 : 48, true); view.setUint32(48, 8, true);
  const active = { ...ctx, createWorkingStorage() {
    const storage = ctx.createWorkingStorage!();
    return { ...storage, async close() { await storage.close(); throw failure; } };
  } };
  const consume = async () => {
    for await (const section of readPropertySectionRanges(propertyRange(bytes, active), () => {}, () => {}, active)) {
      expect(section.offset).toBe(48);
    }
  };
  if (malformed) {
    const error = await consume().catch(error => error) as AggregateError;
    expect(error).toBeInstanceOf(AggregateError); expect(error.errors[0].message).toContain('invalid property section offset');
    expect(error.errors[1]).toBe(failure);
  } else await expect(consume()).rejects.toBe(failure);
  expect(state.closed).toBe(1);
});

it('decodes properties without collecting a resident value-range map', async () => {
  const input = { sheets: [], properties: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`Custom${i}`, i])) };
  const { streams } = await writeBiffProperties(input, context), { ctx, state } = fixture();
  const original = Map.prototype.set;
  Map.prototype.set = function (key, value) {
    if (value instanceof BiffPropertyRange) throw new Error('resident property value map');
    return original.call(this, key, value);
  };
  try { expect(await readBiffProperties(streams, ctx, text => text, () => {}, undefined)).toEqual(input.properties); }
  finally { Map.prototype.set = original; }
  expect(state.acquired).toBeGreaterThan(0); expect(state.closed).toBe(state.acquired);
});

it('looks up and replays value ranges beyond the cache without retaining the index after its visitor', async () => {
  const { ctx, state } = fixture(), count = 300, bytes = new Uint8Array(8 + count * 16), view = new DataView(bytes.buffer);
  view.setUint32(4, count, true); let at = 8 + count * 8;
  for (let id = count - 1; id >= 0; id--) {
    view.setUint32(8 + id * 8, id, true); view.setUint32(12 + id * 8, at, true);
    view.setUint32(at, id, true); at += 4 + id % 3 * 4;
  }
  let escaped!: BiffPropertyValues;
  const result = await withPropertyValueRanges(propertyRange(bytes, ctx), () => {}, () => {}, ctx, async values => {
    escaped = values;
    for (let i = 0; i < count; i++) {
      const id = i * 13 % count, range = (await values.get(id))!;
      expect(range.size).toBe(4 + id % 3 * 4); expect(await range.u32(0)).toBe(id);
    }
    expect(await values.get(999)).toBeUndefined();
    let seen = 0;
    for await (const [id, range] of values.entries()) {
      expect(id).toBe(count - ++seen); expect(await range.u32(0)).toBe(id);
      expect(range.size).toBe(4 + id % 3 * 4);
    }
    expect(seen).toBe(count); return values.get(150);
  });
  expect(await result!.u32(0)).toBe(150);
  expect(state.acquired).toBe(1); expect(state.closed).toBe(1);
  await expect(escaped.get(1)).rejects.toThrow('index is closed');
  const consume = async () => { for await (const entry of escaped.entries()) void entry; };
  await expect(consume()).rejects.toThrow('index is closed');
});

it.each(['lookup-read', 'replay-write', 'abort', 'consumer'])('closes value indexes after visitor %s failure', async mode => {
  const { ctx, state, failure } = fixture(), controller = new AbortController(), count = 300;
  const bytes = new Uint8Array(8 + count * 12), view = new DataView(bytes.buffer);
  view.setUint32(4, count, true);
  for (let i = 0; i < count; i++) {
    view.setUint32(8 + i * 8, i, true); view.setUint32(12 + i * 8, 8 + count * 8 + i * 4, true);
  }
  const active = { ...ctx, signal: controller.signal };
  await expect(withPropertyValueRanges(propertyRange(bytes, active), () => {}, () => {}, active, async values => {
    if (mode === 'consumer') throw failure;
    if (mode === 'abort') controller.abort(failure);
    state.mode = mode === 'lookup-read' ? 'read' : mode === 'replay-write' ? 'write' : '';
    if (mode === 'lookup-read') await values.get(0);
    else for await (const entry of values.entries()) void entry;
  })).rejects.toBe(failure);
  expect(state.closed).toBe(1);
});

it.each([false, true])('preflights plaintext property collisions=%s without a resident value map', async collision => {
  const { ctx, state } = fixture(), bytes = new Uint8Array(72), view = new DataView(bytes.buffer), encrypted = new Uint8Array(8);
  view.setUint16(0, 0xfffe, true); view.setUint32(24, 1, true); view.setUint32(44, 48, true);
  bytes.set(Buffer.from('02d5cdd59c2e1b10939708002b2cf9ae', 'hex'), 28);
  view.setUint32(48, 24, true); view.setUint32(52, 1, true);
  view.setUint32(56, collision ? 2 : 1, true); view.setUint32(60, 16, true); view.setUint32(64, 2, true);
  const streams = new Map([['ENCRYPTION', encrypted], ['\u0005DocumentSummaryInformation', bytes]]), original = Map.prototype.set;
  Map.prototype.set = function (key, value) {
    if (value instanceof BiffPropertyRange) throw new Error('resident property value map');
    return original.call(this, key, value);
  };
  try {
    const result = encryptedBiffPropertyStream(streams, ctx, () => {});
    if (collision) await expect(result).rejects.toThrow('ambiguous plaintext');
    else expect(await result).toBe(encrypted);
  } finally { Map.prototype.set = original; }
  expect(state.acquired).toBe(2); expect(state.closed).toBe(2);
});

it('looks up custom names without retaining decoded dictionary strings', async () => {
  const input = { sheets: [], properties: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`DictionaryName${i}`, i])) };
  const { streams } = await writeBiffProperties(input, context), { ctx, state } = fixture(); let accounted = 0;
  const original = Map.prototype.set;
  Map.prototype.set = function (key, value) {
    if (typeof key === 'number' && typeof value === 'string' && value.startsWith('DictionaryName')) throw new Error('resident dictionary names');
    return original.call(this, key, value);
  };
  try {
    expect(await readBiffProperties(streams, ctx, text => { if (text.startsWith('DictionaryName')) accounted++; return text; }, () => {}, undefined)).toEqual(input.properties);
  } finally { Map.prototype.set = original; }
  expect(accounted).toBe(600); expect(state.closed).toBe(state.acquired);
});

it.each(['success', 'allocate', 'write', 'read', 'abort', 'duplicate', 'lookup-read', 'consumer', 'unsupported'])('indexes dictionary names with bounded storage and cleanup (%s)', async mode => {
  const { ctx, state, failure } = fixture(), controller = new AbortController(), count = 300;
  const bytes = new Uint8Array(4 + count * 13), view = new DataView(bytes.buffer);
  view.setUint32(0, count, true);
  for (let i = 0; i < count; i++) {
    const at = 4 + i * 13;
    view.setUint32(at, mode === 'duplicate' && i === count - 1 ? 2 : i + 2, true);
    view.setUint32(at + 4, 5, true); bytes.set(new TextEncoder().encode(`N${String(i).padStart(3, '0')}`), at + 8);
  }
  const active = { ...ctx, signal: controller.signal }; let entered = false, accounted = 0, escaped!: (id: number) => Promise<string | undefined>;
  state.mode = mode;
  if (mode === 'abort') state.hold = async () => { controller.abort(failure); };
  const result = visitBiffPropertyDictionary(propertyRange(bytes, active), mode === 'unsupported' ? 777 : 65001, active,
    amount => expect(amount).toBe(count), text => { accounted++; return text; }, () => {}, async get => {
      entered = true; escaped = get;
      if (mode === 'consumer') throw failure;
      if (mode === 'lookup-read') { state.mode = 'read'; await get(2); return; }
      for (let i = 0; i < count; i++) {
        const id = i * 13 % count;
        expect(await get(id + 2)).toBe(`N${String(id).padStart(3, '0')}`);
      }
      expect(await get(999)).toBeUndefined(); expect(accounted).toBe(count);
    });
  if (mode === 'success' || mode === 'unsupported') expect(await result).toBe(mode === 'success');
  else if (mode === 'duplicate') await expect(result).rejects.toThrow('invalid property dictionary entry');
  else await expect(result).rejects.toBe(failure);
  expect(entered).toBe(['success', 'lookup-read', 'consumer'].includes(mode));
  expect(state.acquired).toBe(1); expect(state.closed).toBe(1);
  if (escaped) await expect(escaped(2)).rejects.toThrow('dictionary index is closed');
});

it.each([false, true])('preserves dictionary close failures with consumer error=%s', async consumerError => {
  const { ctx, state, failure } = fixture(), bytes = new Uint8Array(4), consumer = new Error('consumer');
  const active = { ...ctx, createWorkingStorage() {
    const storage = ctx.createWorkingStorage!();
    return { ...storage, async close() { await storage.close(); throw failure; } };
  } };
  const result = visitBiffPropertyDictionary(propertyRange(bytes, active), 65001, active, () => {}, text => text, () => {}, async () => {
    if (consumerError) throw consumer;
  });
  if (consumerError) {
    const error = await result.catch(error => error) as AggregateError;
    expect(error).toBeInstanceOf(AggregateError); expect(error.errors).toEqual([consumer, failure]);
  } else await expect(result).rejects.toBe(failure);
  expect(state.closed).toBe(1);
});

it('merges retained values without a resident range map', async () => {
  const seed = { sheets: book.sheets, properties: { 'dc:title': 'original', Custom: 2 } };
  const fresh = await writeBiffProperties(seed, context), stream = '\u0005SummaryInformation', bytes = fresh.streams.get(stream)!;
  const input = { ...seed, properties: { ...seed.properties, 'dc:title': 'replacement' }, unsupportedRecords: [{ source: 'biff', kind: 'ole-properties', disposition: 'retained' as const,
    data: { stream, bytes: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') } }] };
  const expected = await writeBiffProperties(input, context), { ctx, state } = fixture(), original = Map.prototype.set;
  Map.prototype.set = function (key, value) {
    if (typeof key === 'number' && value instanceof BiffPropertyRange) throw new Error('resident merge value map');
    return original.call(this, key, value);
  };
  try {
    const actual = await writeBiffProperties(input, ctx, true);
    for (const [name, source] of actual.streams) expect(await source.read(0, source.size)).toEqual(expected.streams.get(name));
    await actual.close();
  } finally { Map.prototype.set = original; }
  expect(state.closed).toBe(state.acquired);
});

it.each([false, true])('replays property identities without transient arrays (legacy merge=%s)', async merge => {
  const seed = { sheets: book.sheets, properties: { 'dc:title': 'original', A: 1, B: 2 } };
  const fresh = await writeBiffProperties(seed, context), stream = '\u0005SummaryInformation', bytes = fresh.streams.get(stream)!;
  const input = { ...seed, properties: { 'dc:title': 'edited', A: 3, B: 4, C: 5 }, unsupportedRecords: [{
    source: 'biff', kind: 'ole-properties', disposition: 'retained' as const,
    data: { stream, bytes: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') }
  }] };
  const expected = await writeBiffProperties(input, context), { ctx, state } = fixture();
  const push = Array.prototype.push;
  let identityArrays = 0;
  // Avoid a mock wrapper: Vitest itself uses Array#push while recording calls.
  Array.prototype.push = function (...items) {
    for (const item of items) if (Array.isArray(item) && item.length === 3 &&
      typeof item[0] === 'number' && typeof item[1] === 'number' && typeof item[2] === 'string') identityArrays++;
    return push.apply(this, items);
  };
  try {
    if (merge) {
      const actual = await writeBiffProperties(input, ctx, true);
      try {
        for (const [name, source] of actual.streams) expect(await source.read(0, source.size)).toEqual(expected.streams.get(name));
      } finally { await actual.close(); }
    } else expect(await readBiffProperties(fresh.streams, ctx, text => text, () => {}, undefined)).toEqual(seed.properties);
  } finally { Array.prototype.push = push; }
  expect(identityArrays).toBe(0);
  expect(state.closed).toBe(state.acquired);
});

it.each([false, true])('keeps dictionary rewrite storage handles independent of property count (adding=%s)', async adding => {
  const counts: number[] = [];
  for (const count of [1, 12]) {
    const seed = { sheets: book.sheets, properties: Object.fromEntries(Array.from({ length: count }, (_, i) => [`P${i}`, i])) };
    const fresh = await writeBiffProperties(adding ? { ...seed, properties: { Original: 1 } } : seed, context), stream = '\u0005DocumentSummaryInformation';
    const input = { ...seed, unsupportedRecords: [{ source: 'biff', kind: 'ole-properties', disposition: 'retained' as const,
      data: { stream, bytes: Array.from(fresh.streams.get(stream)!, byte => byte.toString(16).padStart(2, '0')).join('') }
    }] };
    const expected = await writeBiffProperties(input, context), { ctx, state } = fixture();
    const actual = await writeBiffProperties(input, ctx, true);
    try {
      for (const [name, source] of actual.streams) expect(await source.read(0, source.size)).toEqual(expected.streams.get(name));
      counts.push(state.acquired);
    } finally { await actual.close(); }
    expect(state.closed).toBe(state.acquired);
  }
  expect(counts[1]).toBe(counts[0]);
});

it('keeps transcoding storage handles independent of the number of legacy replacements', async () => {
  const counts: number[] = [];
  for (const count of [1, 12]) {
    const seed = { sheets: book.sheets, properties: Object.fromEntries(Array.from({ length: count }, (_, i) => [`P${i}`, 'old'])) };
    const fresh = await writeBiffProperties(seed, context), stream = '\u0005DocumentSummaryInformation';
    const modeled: [number, number, string][] = [];
    await readBiffProperties(fresh.streams, context, text => text, () => {}, undefined,
      property => { if (property.stream === stream) modeled.push([property.section, property.id, property.key]); });
    const bytes = fresh.streams.get(stream)!;
    for (const section of readBiffPropertySections(bytes, () => {}, () => {})) {
      const values = readBiffPropertyValues(new Binary(bytes.subarray(section.offset, section.end)), () => {}, () => {});
      const cp = values.get(1)!.bytes; new DataView(cp.buffer, cp.byteOffset, cp.byteLength).setUint16(4, 1252, true);
    }
    const input = { ...seed, properties: Object.fromEntries(Object.keys(seed.properties).map(key => [key, 'new 漢😀'])),
      unsupportedRecords: [{ source: 'biff', kind: 'ole-properties', disposition: 'retained' as const,
        data: { stream, bytes: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''), modeled }
      }] };
    const expected = await writeBiffProperties(input, context), { ctx, state } = fixture();
    const actual = await writeBiffProperties(input, ctx, true);
    try {
      for (const [name, source] of actual.streams) expect(await source.read(0, source.size)).toEqual(expected.streams.get(name));
      counts.push(state.acquired);
    } finally { await actual.close(); }
    expect(state.closed).toBe(state.acquired);
  }
  expect(counts[1]).toBe(counts[0]);
});

it.each([false, true])('streams borrowed property fragments into atomic payload snapshots (stored=%s)', async stored => {
  const { ctx, state } = fixture(), active = stored ? ctx : context;
  const values = new BiffMutablePropertyValues(active, () => {}), borrowed = new Uint8Array(257);
  try {
    await values.set(2, { size: 40001, async *chunks() {
      for (let at = 0; at < 40001; at += borrowed.length) {
        const length = Math.min(borrowed.length, 40001 - at);
        for (let i = 0; i < length; i++) borrowed[i] = (at + i) % 251;
        yield borrowed.subarray(0, length);
      }
      borrowed.fill(0);
    } });
    const payload = (await values.get(2))!;
    for (let at = 0; at < payload.size;) {
      const bytes = await payload.read(at, payload.size - at);
      expect(bytes).toEqual(Uint8Array.from({ length: bytes.length }, (_, i) => (at + i) % 251)); at += bytes.length;
    }
    for (const size of [2, 4]) {
      await expect(values.set(2, { size, async *chunks() { yield new Uint8Array(3); } })).rejects.toThrow('serialization');
      expect((await values.get(2))!.size).toBe(40001);
    }
    const failure = new Error('producer failure');
    await expect(values.set(3, { size: 40001, async *chunks() { yield new Uint8Array(20000); throw failure; } })).rejects.toBe(failure);
    expect(values.size).toBe(1); expect(await values.get(3)).toBeUndefined();
    for (const size of [-1, 0.5, 2e6 + 1]) {
      await expect(values.set(3, { size, chunks() { throw new Error('must not iterate'); } })).rejects.toThrow('serialization size');
    }
  } finally { await values.close(); }
  expect(state.closed).toBe(state.acquired);
});

it.each([false, true])('tracks serialized property sizes through replacement, deletion and failed producers (stored=%s)', async stored => {
  const { ctx, state } = fixture(), active = stored ? ctx : context;
  const values = new BiffMutablePropertyValues(active, () => {});
  try {
    expect(values.serializedSize).toBe(8);
    await values.set(1, propertyRange(new Uint8Array(3), active)); expect(values.serializedSize).toBe(20);
    await values.set(2, propertyRange(new Uint8Array(9), active)); expect(values.serializedSize).toBe(40);
    await values.set(1, propertyRange(new Uint8Array(5), active)); expect(values.serializedSize).toBe(44);
    await expect(values.set(1, { size: 20, async *chunks() { yield new Uint8Array(1); } })).rejects.toThrow('serialization');
    expect(values.serializedSize).toBe(44);
    await values.delete(2); expect(values.serializedSize).toBe(24);
    await values.delete(2); expect(values.serializedSize).toBe(24);
    await values.set(2, propertyRange(new Uint8Array(0), active)); expect(values.serializedSize).toBe(32);
    await values.set(1, { size: 1, async *chunks() { yield new Uint8Array(1); } }); expect(values.serializedSize).toBe(28);
  } finally { await values.close(); }
  expect(state.closed).toBe(state.acquired);
});

it('replays merged sections without retaining output plans', async () => {
  const seed = { sheets: book.sheets, properties: { 'dc:title': 'old' } }, stream = '\u0005SummaryInformation';
  const fresh = await writeBiffProperties(seed, context), bytes = fresh.streams.get(stream)!;
  const input = { ...seed, properties: { 'dc:title': 'new', Custom: 3 }, unsupportedRecords: [{
    source: 'biff', kind: 'ole-properties', disposition: 'retained' as const,
    data: { stream, bytes: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') }
  }] };
  const expected = await writeBiffProperties(input, context), { ctx, state } = fixture(), push = Array.prototype.push;
  Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
    for (const item of items) if (item && typeof item === 'object' && 'length' in item && 'chunks' in item &&
      typeof item.length === 'number' && typeof item.chunks === 'function') throw new Error('resident section output plans');
    return push.apply(this, items);
  };
  try {
    const actual = await writeBiffProperties(input, ctx, true);
    try { for (const [name, source] of actual.streams) expect(await source.read(0, source.size)).toEqual(expected.streams.get(name)); }
    finally { await actual.close(); }
  } finally { Array.prototype.push = push; }
  expect(state.closed).toBe(state.acquired);
});

it('observes properties sequentially without materializing a returned property record', async () => {
  const seed = { sheets: book.sheets, properties: { 'dc:title': 'Title', A: 1, AB: 2, a: 3 } };
  const fresh = await writeBiffProperties(seed, context), { ctx, state } = fixture();
  const observed: Record<string, unknown> = {}; let pending = 0;
  const result = await readBiffProperties(fresh.streams, ctx, text => text, () => {}, undefined, async property => {
    expect(++pending).toBe(1); await Promise.resolve(); observed[property.key] = property.value; pending--;
  }, false);
  expect(result).toEqual({}); expect(observed).toEqual(seed.properties); expect(pending).toBe(0);
  expect(state.closed).toBe(state.acquired);
});

it('merges without retaining decoded property observations in maps', async () => {
  const seed = { sheets: book.sheets, properties: { 'dc:title': 'old', A: 'value', B: 3 } };
  const fresh = await writeBiffProperties(seed, context), stream = '\u0005SummaryInformation', bytes = fresh.streams.get(stream)!;
  const input = { ...seed, properties: { ...seed.properties, 'dc:title': 'new' }, unsupportedRecords: [{
    source: 'biff', kind: 'ole-properties', disposition: 'retained' as const,
    data: { stream, bytes: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') }
  }] };
  const expected = await writeBiffProperties(input, context), { ctx, state } = fixture(), set = Map.prototype.set;
  Map.prototype.set = function (key, value) {
    if (value && typeof value === 'object' && 'stream' in value && 'section' in value && 'id' in value && 'key' in value && 'value' in value)
      throw new Error('resident decoded property observations');
    return set.call(this, key, value);
  };
  try {
    const actual = await writeBiffProperties(input, ctx, true);
    try { for (const [name, source] of actual.streams) expect(await source.read(0, source.size)).toEqual(expected.streams.get(name)); }
    finally { await actual.close(); }
  } finally { Map.prototype.set = set; }
  expect(state.closed).toBe(state.acquired);
});

it.each([false, true])('merges without resident name sets (exposed=%s)', async exposed => {
  const seed = { sheets: book.sheets, properties: { 'dc:title': 'old' } };
  const fresh = await writeBiffProperties(seed, context), stream = '\u0005SummaryInformation', bytes = fresh.streams.get(stream)!;
  const input = { ...seed, properties: exposed ? {} : { 'dc:title': 'changed' }, unsupportedRecords: [{
    source: 'biff', kind: 'ole-properties', disposition: 'retained' as const,
    data: { stream, ...(exposed ? { modeled: [] } : {}), bytes: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') }
  }] };
  const expected = await writeBiffProperties(input, context), freshReplacement = await writeBiffProperties({ sheets: input.sheets, properties: input.properties }, context);
  const { ctx, state } = fixture(), add = Set.prototype.add, warnings: string[] = [];
  const active: CapabilityContext = { ...ctx, diagnostic: async diagnostic => { warnings.push(diagnostic.message); } };
  const replacements = new Map(freshReplacement.streams);
  Set.prototype.add = function (value) {
    if (value === 'dc:title') throw new Error('resident retained property name');
    return add.call(this, value);
  };
  try {
    await mergeBiffProperties(input, replacements, new Set(), active, () => {}, length => new Uint8Array(length));
    expect(replacements).toEqual(expected.streams);
  } finally { Set.prototype.add = add; }
  expect(state.closed).toBe(state.acquired);
  expect(warnings).toHaveLength(exposed ? 1 : 0);
  if (exposed) expect(warnings[0]).toContain('dc:title');
});

it.each(['read', 'abort', 'close'])('rejects property-name replay after %s and retires storage', async mode => {
  const { ctx, state, failure } = fixture(), controller = new AbortController();
  const names = new BiffPropertyNames({ ...ctx, signal: controller.signal }, () => {});
  await names.add('first'); await names.add('second');
  const values = names.values()[Symbol.asyncIterator](); expect(await values.next()).toEqual({ done: false, value: 'first' });
  if (mode === 'read') state.mode = 'read';
  else if (mode === 'abort') controller.abort(failure);
  else await names.close();
  try {
    if (mode === 'close') await expect(values.next()).rejects.toThrow('closed');
    else await expect(values.next()).rejects.toBe(failure);
  } finally { await names.close(); }
  expect(state.closed).toBe(state.acquired);
});

it('preserves mutable property insertion order and detached payloads beyond the index cache', async () => {
  const { ctx, state, cleanups } = fixture(), values = new BiffMutablePropertyValues(ctx, () => {});
  const range = (id: number) => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, id, true); return propertyRange(bytes, ctx); };
  try {
    for (let id = 0; id < 300; id++) await values.set(id, range(id));
    const detached = (await values.get(2))!;
    await values.set(5, range(55)); expect(await values.delete(2)).toBe(true);
    expect(await values.delete(999)).toBe(false); expect(await values.get(2)).toBeUndefined();
    expect(await detached.u32(0)).toBe(2);
    await values.set(2, range(22)); await values.set(7, (await values.get(7))!);
    const ids: number[] = [];
    for await (const [id, value] of values.entries()) {
      ids.push(id); expect(await value.u32(0)).toBe(id === 5 ? 55 : id === 2 ? 22 : id);
    }
    expect(ids).toEqual([...Array.from({ length: 300 }, (_, i) => i).filter(id => id !== 2), 2]);
    expect(values.size).toBe(300); expect(values.serializedSize).toBe(3608);
    const first = (await values.get(0))!, last = (await values.get(299))!;
    expect(await Promise.all([first.u32(0), last.u32(0)])).toEqual([0, 299]);
    await values.close(); await expect(first.u32(0)).rejects.toThrow('closed');
  } finally { await values.close(); for (const cleanup of cleanups) await cleanup(); }
  expect(state.acquired).toBe(1); expect(state.closed).toBe(1);
  expect(state.writes.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});

it.each(['success', 'allocate', 'write', 'read', 'source-read', 'abort'])('owns bounded mutable property payloads and cleans after %s', async mode => {
  const { ctx, state, failure } = fixture(), controller = new AbortController(), active = { ...ctx, signal: controller.signal };
  const values = new BiffMutablePropertyValues(active, () => {}), borrowed = new Uint8Array(257);
  state.mode = mode === 'allocate' || mode === 'write' ? mode : '';
  if (mode === 'abort') state.hold = async () => { controller.abort(failure); };
  const source = propertyRange({ size: 40001, async read(at, count) {
    if (mode === 'source-read' && at > 16384) throw failure;
    const length = Math.min(count, borrowed.length, 40001 - at);
    for (let i = 0; i < length; i++) borrowed[i] = (at + i) % 251;
    return borrowed.subarray(0, length);
  } }, active);
  const run = async () => {
    await values.set(2, source); borrowed.fill(0);
    if (mode === 'read') state.mode = mode;
    const result = (await values.get(2))!;
    for (let at = 0; at < result.size;) {
      const bytes = await result.read(at, result.size); expect(bytes.length).toBeLessThanOrEqual(16384);
      expect(bytes).toEqual(Uint8Array.from({ length: bytes.length }, (_, i) => (at + i) % 251)); at += bytes.length;
    }
  };
  try { if (mode === 'success') await run(); else await expect(run()).rejects.toBe(failure); }
  finally { await values.close(); }
  expect(state.closed).toBe(1); expect(state.pending).toBe(0);
});

it('waits for mutable property writes during disposal', async () => {
  const { ctx, state } = fixture(), values = new BiffMutablePropertyValues(ctx, () => {});
  let entered!: () => void, resume!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { resume = resolve; });
  state.hold = async () => { entered(); await gate; };
  const operation = values.set(2, propertyRange(new Uint8Array(4), ctx)); await writing;
  const closing = values.close(); expect(state.closed).toBe(0); resume();
  await expect(operation).rejects.toThrow('closed'); await closing;
  expect(state.closed).toBe(1); expect(state.pending).toBe(0);
});

it('closes mutable value storage once even when cleanup fails', async () => {
  const { ctx, state, failure } = fixture();
  const active = { ...ctx, createWorkingStorage() {
    const storage = ctx.createWorkingStorage!();
    return { ...storage, async close() { await storage.close(); throw failure; } };
  } };
  const values = new BiffMutablePropertyValues(active, () => {});
  await values.set(2, propertyRange(new Uint8Array(4), active));
  await expect(values.close()).rejects.toBe(failure); await expect(values.close()).rejects.toBe(failure);
  expect(state.closed).toBe(1); await expect(values.get(2)).rejects.toThrow('closed');
});

it.each([false, true])('retains exact property-name identity beyond the bounded cache (stored=%s)', async stored => {
  const { ctx, state, cleanups } = fixture(), names = new BiffPropertyNames(stored ? ctx : context, () => {});
  const input = ['', 'A', 'AB', 'a', 'A\0', 'A\0B', '😀', '\ud800', 'x'.repeat(50000), ...Array.from({ length: 300 }, (_, i) => `Name${i}`)];
  try {
    for (const name of input) { expect(await names.has(name)).toBe(false); await names.add(name); }
    for (const name of input) { expect(await names.has(name)).toBe(true); await names.add(name); }
    for (const name of ['B', 'Ab', 'A\0C', 'Name301']) expect(await names.has(name)).toBe(false);
    const replayed: string[] = []; for await (const name of names.values()) replayed.push(name);
    expect(replayed).toEqual(input);
  } finally { await names.close(); for (const close of cleanups) await close(); }
  expect(state.closed).toBe(state.acquired); expect(state.acquired).toBe(stored ? 1 : 0);
  expect(state.writes.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});
it('compares exact names when their bounded hash keys collide', async () => {
  const { ctx, state } = fixture(), names = new BiffPropertyNames(ctx, () => {});
  const hash = vi.spyOn(names as unknown as { fingerprint(name: string): bigint }, 'fingerprint').mockReturnValue(1n);
  try {
    for (const name of ['', 'AB', 'AC', 'A\0', 'Longer']) await names.add(name);
    for (const name of ['', 'AB', 'AC', 'A\0', 'Longer']) expect(await names.has(name)).toBe(true);
    for (const name of ['A', 'AD', 'A\u0001', 'Longer!']) expect(await names.has(name)).toBe(false);
    const replayed: string[] = []; for await (const name of names.values()) replayed.push(name);
    expect(replayed).toEqual(['', 'AB', 'AC', 'A\0', 'Longer']);
  } finally { hash.mockRestore(); await names.close(); }
  expect(state.closed).toBe(state.acquired);
});
it.each(['allocate', 'write', 'read', 'abort'])('closes the property-name index after %s failure', async mode => {
  const { ctx, state, failure, cleanups } = fixture(), controller = new AbortController();
  const names = new BiffPropertyNames({ ...ctx, signal: controller.signal }, () => {});
  if (mode === 'abort') state.hold = async () => { controller.abort(failure); };
  else state.mode = mode;
  try {
    await expect((async () => { await names.add('Name'); await names.has('Name'); })()).rejects.toBe(failure);
  } finally { await names.close(); for (const close of cleanups) await close(); }
  expect(state.closed).toBe(state.acquired);
});
it('waits for async observer failures before cleaning observation indexes', async () => {
  const fresh = await writeBiffProperties({ sheets: book.sheets, properties: { A: 1 } }, context), { ctx, state, failure } = fixture();
  await expect(readBiffProperties(fresh.streams, ctx, text => text, () => {}, undefined, async () => {
    await Promise.resolve(); throw failure;
  }, false)).rejects.toBe(failure);
  expect(state.closed).toBe(state.acquired);
});

it('waits for an in-flight name write during disposal', async () => {
  const { ctx, state, cleanups } = fixture(), names = new BiffPropertyNames(ctx, () => {});
  let entered!: () => void, resume!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  state.hold = () => { entered(); return new Promise<void>(resolve => { resume = resolve; }); };
  const adding = names.add('Name'); await writing;
  const closing = names.close(); expect(state.closed).toBe(0); resume();
  await expect(adding).rejects.toThrow('closed'); await closing;
  for (const close of cleanups) await close();
  expect(state.closed).toBe(1); expect(state.writes.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});

it.each([false, true])('keeps first supported duplicate-name ownership during observation (unsupported first=%s)', async unsupported => {
  const fresh = await writeBiffProperties({ sheets: book.sheets, properties: { A: 1, B: 2 } }, context);
  const bytes = fresh.streams.get('\u0005DocumentSummaryInformation')!;
  const section = readBiffPropertySections(bytes, () => {}, () => {}).at(-1)!;
  const values = readBiffPropertyValues(new Binary(bytes.subarray(section.offset, section.end)), () => {}, () => {});
  const dictionary = values.get(0)!.bytes, view = new DataView(dictionary.buffer, dictionary.byteOffset, dictionary.byteLength);
  let at = 4;
  for (let i = 0; i < view.getUint32(0, true); i++) {
    if (dictionary[at + 8] === 66) dictionary[at + 8] = 65;
    at += 8 + view.getUint32(at + 4, true);
  }
  if (unsupported) {
    const value = values.get(2)!.bytes; new DataView(value.buffer, value.byteOffset, value.byteLength).setUint32(0, 0xffff, true);
  }
  const { ctx, state } = fixture(), observed: unknown[] = [];
  expect(await readBiffProperties(fresh.streams, ctx, text => text, () => {}, undefined, property => {
    observed.push([property.key, property.value]);
  }, false)).toEqual({});
  expect(observed).toEqual([['A', unsupported ? 2 : 1]]); expect(state.closed).toBe(state.acquired);
});

it.each([false, true])('replays original identities beyond bounded caches with exact UTF-16 keys (stored=%s)', async stored => {
  const { ctx, state, cleanups } = fixture(), originals = new BiffOriginalProperties(stored ? ctx : context, () => {});
  const streams = ['\u0005SummaryInformation', '\u0005DocumentSummaryInformation'];
  const records = Array.from({ length: 300 }, (_, i) => ({ stream: streams[i % 2]!, section: 0xffffff00 + Math.floor(i / 2),
    id: 0xffffffff, key: i === 0 ? 'A\0😀\ud800'.repeat(5000) : `Key${i}`, unchanged: i % 3 === 0 }));
  try {
    for (const record of records) await originals.add(record);
    await expect(originals.add(records[0]!)).rejects.toThrow('Duplicate');
    for (const record of records) expect(await originals.get(record.stream, record.section, record.id)).toEqual(record);
    let at = 0;
    for await (const record of originals.values()) expect(record).toEqual(records[at++]);
    expect(at).toBe(records.length);
    for (const id of [-1, 0.5, NaN, Infinity, 0x100000000]) expect(await originals.get(streams[0]!, 10, id)).toBeUndefined();
    expect(await originals.get('other', 1, 2)).toBeUndefined();
    expect(await originals.get(streams[0]!, 0xffffff00, 3)).toBeUndefined();
  } finally { await originals.close(); for (const close of cleanups) await close(); }
  await expect(originals.get(streams[0]!, 1, 2)).rejects.toThrow('closed');
  expect(state.closed).toBe(state.acquired); expect(state.acquired).toBe(stored ? 1 : 0);
  expect(state.writes.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});
it.each(['allocate', 'write', 'read', 'abort'])('cleans original identity storage after %s failure', async mode => {
  const { ctx, state, failure, cleanups } = fixture(), controller = new AbortController();
  const originals = new BiffOriginalProperties({ ...ctx, signal: controller.signal }, () => {});
  if (mode === 'abort') state.hold = async () => { controller.abort(failure); }; else state.mode = mode;
  try {
    await expect((async () => {
      await originals.add({ stream: '\u0005SummaryInformation', section: 48, id: 2, key: 'Name', unchanged: true });
      await originals.get('\u0005SummaryInformation', 48, 2);
    })()).rejects.toBe(failure);
  } finally { await originals.close(); for (const close of cleanups) await close(); }
  expect(state.closed).toBe(state.acquired);
});
it('waits for original identity writes during disposal', async () => {
  const { ctx, state, cleanups } = fixture(), originals = new BiffOriginalProperties(ctx, () => {});
  let entered!: () => void, resume!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  state.hold = () => { entered(); return new Promise<void>(resolve => { resume = resolve; }); };
  const adding = originals.add({ stream: '\u0005SummaryInformation', section: 48, id: 2, key: 'Name', unchanged: true });
  await writing; const closing = originals.close(); expect(state.closed).toBe(0); resume();
  await expect(adding).rejects.toThrow('closed'); await closing;
  for (const close of cleanups) await close();
  expect(state.closed).toBe(1); expect(state.writes.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
});
