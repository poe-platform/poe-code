import { expect, it } from 'vitest';
import { decryptBiffPropertySources } from './biff-encrypted-properties.js';
import { prepareBiffPropertyContainer } from './biff-encrypted-properties-write.js';
import { createRc4Cipher, rc4Stream } from './biff-encryption.js';
import type { CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
const base: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { inputBytes: 2e6, outputBytes: 10, cells: 10, sheets: 2, operations: 100 } };
const key = (block: number) => new Uint8Array([42, block & 255, block >>> 8]);
function fixture(mode = '') {
  const controller = new AbortController(), failure = new Error(mode), cleanups: (() => void | Promise<void>)[] = [];
  let opened = 0, closed = 0, ciphers = 0, retired = 0;
  const windows: Uint8Array[] = [];
  const context: CapabilityContext = { ...base, signal: controller.signal, own(fn) { cleanups.push(fn); }, createWorkingStorage() {
    opened++; if (mode === 'acquire' || mode === 'second' && opened === 2) throw failure;
    const ordinal = opened, data = new Uint8Array(120000); let end = 0;
    return { allocate(size) { const at = end; end += size; return at; }, async write(at, bytes) {
      expect(bytes.length).toBeLessThanOrEqual(16384); await Promise.resolve();
      if (mode === 'write') throw failure; data.set(bytes, at); if (mode === 'abort') controller.abort(failure);
    }, async read(at, size) { if (mode === 'read' && ordinal > 1 || mode === 'table-read' && ordinal === 1) throw failure; return data.subarray(at, at + size); }, async close() { closed++; data.fill(0); } };
  } };
  const streams = new Map([['Large', new Uint8Array(100003).fill(37)], ['Other', new Uint8Array([1, 2, 3])]]);
  const encrypted = prepareBiffPropertyContainer(streams, { ...base, limits: { ...base.limits, outputBytes: 2e6 } }, () => {})((block, length) => rc4Stream(key(block), length, base));
  const cipher = (block: number) => { ciphers++; const rc4 = createRc4Cipher(key(block), context); return {
    xor(bytes: Uint8Array) { expect(bytes.length).toBeLessThanOrEqual(16384); windows.push(bytes); rc4.xor(bytes); }, close() { retired++; rc4.close(); }
  }; };
  return { context, cipher, encrypted, streams, cleanups, failure, windows, state: () => ({ opened, closed, ciphers, retired }) };
}
it('stages decrypted payloads in caller storage with owned bounded reads and input-sized admission', async () => {
  const f = fixture(), result = await decryptBiffPropertySources(f.encrypted, f.cipher, f.context, () => {});
  expect(f.state().opened).toBe(3);
  for (const [name, source] of result) {
    const expected = f.streams.get(name)!; expect(source.size).toBe(expected.length);
    for (let at = 0; at < source.size; at += 16384) expect(await source.read(at, 16384)).toEqual(expected.subarray(at, at + 16384));
    const first = await source.read(0, 3); first.fill(0); expect(await source.read(0, 3)).toEqual(expected.subarray(0, 3));
  }
  expect(f.state().ciphers).toBe(f.state().retired); expect(f.windows.every(b => b.every(v => v === 0))).toBe(true);
  const source = result.get('Large')!; for (const close of f.cleanups) await close();
  expect(f.state().closed).toBe(3); await expect(source.read(0, 1)).rejects.toThrow('closed');
});
it.each(['acquire', 'write', 'abort', 'second'])('cleans cipher and partial staging after %s failure', async mode => {
  const f = fixture(mode); await expect(decryptBiffPropertySources(f.encrypted, f.cipher, f.context, () => {})).rejects.toBe(f.failure);
  expect(f.state().closed).toBe(mode === 'acquire' ? 0 : 1); expect(f.state().ciphers).toBe(f.state().retired);
  expect(f.windows.every(b => b.every(v => v === 0))).toBe(true);
  for (const close of f.cleanups) await close();
});
it('imports encrypted properties through injected safe-fs without the buffered payload decoder', async () => {
  const { vi } = await import('vitest'), properties = await import('./biff-encrypted-properties.js');
  const { createBiffWriter, readBiff } = await import('./biff.js');
  const { createEngine } = await import('@poe-code/spreadsheet-engine');
  const { createMemoryFileSystem } = await import('@poe-code/safe-fs/core');
  const context = { ...base, limits: { ...base.limits, outputBytes: 2e6 }, password: { async read() { return 'secret'; } },
    entropy: { async read() { return Uint8Array.from({ length: 32 }, (_, i) => i); } } };
  const book = { sheets: [{ id: 's', name: 'S', cells: [] }], properties: { 'dc:title': '漢😀'.repeat(10000) },
    unsupportedRecords: [{ source: 'biff', kind: 'encrypted-ancillary', disposition: 'retained' as const,
      data: { stream: 'Opaque', bytes: '42'.repeat(20000) } }] };
  const encrypted = await createBiffWriter(8)(book, ['encryption=rc4-cryptoapi-128-properties'], context);
  const fs = createMemoryFileSystem(), forbid = vi.spyOn(properties, 'decryptBiffPropertyContainer').mockImplementation(() => { throw new Error('buffered plaintext'); });
  const ranges = await import('./biff-range.js'), load = ranges.readBiffRange;
  const rangeSpy = vi.spyOn(ranges, 'readBiffRange').mockImplementation(async (...args) => {
    const result = await load(...args);
    const name = [...result.propertySources!.keys()].find(name => name.toUpperCase() === 'ENCRYPTION');
    expect(name).toBeDefined(); expect(result.streams!.get(name!)!.length).toBe(0); return result;
  });
  let writes = 0;
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [],
    readSource(input, ctx) { return readBiff(input, { ...ctx, password: context.password, createWorkingStorage() {
      const store = ctx.createWorkingStorage!(); return { ...store, async write(at, bytes) { writes++; expect(bytes.length).toBeLessThanOrEqual(16384); await store.write(at, bytes); } };
    } }); }
  }] });
  try {
    const result = await engine.readWorkbook({ kind: 'range', source: { size: encrypted.length, async read(at, count) { return encrypted.subarray(at, at + Math.min(count, 257)); } } },
      { importType: 'fixture' }, { signal: base.signal });
    expect(result.properties).toEqual(book.properties);
    expect(result.unsupportedRecords).toContainEqual(book.unsupportedRecords[0]); expect(writes).toBeGreaterThan(5);
  } finally { forbid.mockRestore(); rangeSpy.mockRestore(); await engine.dispose(); }
  expect(await fs.readdir('/')).toEqual([]);
});
it('preserves backing read errors after successful staging', async () => {
  const f = fixture('read'), result = await decryptBiffPropertySources(f.encrypted, f.cipher, f.context, () => {});
  await expect(result.get('Large')!.read(0, 4)).rejects.toBe(f.failure);
  for (const close of f.cleanups) await close(); expect(f.state().closed).toBe(3);
});
it('decrypts a borrowed short ciphertext source using bounded range reads', async () => {
  const f = fixture(), borrowed = new Uint8Array(257); let reads = 0;
  const source = { size: f.encrypted.length, async read(at: number, count: number) {
    expect(count).toBeLessThanOrEqual(16384); reads++;
    const part = f.encrypted.subarray(at, at + Math.min(count, 257)); borrowed.set(part); return borrowed.subarray(0, part.length);
  } };
  const result = await decryptBiffPropertySources(source, f.cipher, f.context, () => {});
  expect(reads).toBeGreaterThan(300);
  for (const [name, range] of result) for (let at = 0; at < range.size; at += 16384)
    expect(await range.read(at, 16384)).toEqual(f.streams.get(name)!.subarray(at, at + 16384));
  for (const close of f.cleanups) await close(); expect(f.state().closed).toBe(3);
});
it.each(['read', 'empty', 'abort'])('cleans staging after ciphertext %s failure', async mode => {
  const f = fixture(), failure = new Error(mode), controller = new AbortController();
  const source = { size: f.encrypted.length, async read(at: number, count: number) {
    if (at >= 8 && at < 100000) {
      if (mode === 'read') throw failure;
      if (mode === 'empty') return new Uint8Array();
      controller.abort(failure);
    }
    return f.encrypted.subarray(at, at + count);
  } };
  const result = decryptBiffPropertySources(source, f.cipher, { ...f.context, signal: controller.signal }, () => {});
  if (mode === 'empty') await expect(result).rejects.toThrow('truncated'); else await expect(result).rejects.toBe(failure);
  for (const close of f.cleanups) await close(); expect(f.state().closed).toBe(f.state().opened);
  expect(f.state().ciphers).toBe(f.state().retired);
});
it('captures ciphertext capabilities during preflight before password acquisition', async () => {
  const { encryptedBiffPropertyStream } = await import('./biff-encrypted-properties.js');
  const f = fixture();
  const source = { size: f.encrypted.length, async read(at: number, count: number) { return f.encrypted.subarray(at, at + count); } };
  const admitted = await encryptedBiffPropertyStream(new Map([['encryption', new Uint8Array()]]), f.context, () => {}, new Map([['encryption', source]]));
  source.size = 0; source.read = async () => { throw new Error('replaced'); };
  const result = await decryptBiffPropertySources(admitted, f.cipher, f.context, () => {});
  expect(await result.get('Other')!.read(0, 3)).toEqual(f.streams.get('Other'));
  for (const close of f.cleanups) await close();
});
it('stages and retires the descriptor table before opening plaintext payload storage', async () => {
  const f = fixture(), allocations: number[] = [];
  const context = { ...f.context, createWorkingStorage() {
    const store = f.context.createWorkingStorage!(); return { ...store, allocate(size: number) { allocations.push(size); return store.allocate(size); } };
  } };
  const header = f.encrypted.slice(0, 8), cipher = createRc4Cipher(key(0), context); cipher.xor(header); cipher.close();
  const tableSize = new DataView(header.buffer).getUint32(4, true);
  const result = await decryptBiffPropertySources(f.encrypted, f.cipher, context, () => {});
  expect(allocations).toEqual([tableSize, 100003, 3]); expect(f.state().closed).toBe(1);
  expect(await result.get('Other')!.read(0, 3)).toEqual(f.streams.get('Other'));
  for (const close of f.cleanups) await close(); expect(f.state().closed).toBe(3);
});
it('closes descriptor storage on parsing read failure before opening payload storage', async () => {
  const f = fixture('table-read');
  await expect(decryptBiffPropertySources(f.encrypted, f.cipher, f.context, () => {})).rejects.toBe(f.failure);
  expect(f.state().opened).toBe(1); expect(f.state().closed).toBe(1);
  for (const close of f.cleanups) await close(); expect(f.state().closed).toBe(1);
});
it.each(['range', 'overlap', 'flags', 'name', 'terminator', 'size', 'count'])('preserves malformed descriptor %s rejection on the staged path', async mode => {
  const f = fixture(), bytes = new Uint8Array(52), view = new DataView(bytes.buffer);
  view.setUint32(0, 12, true); view.setUint32(4, 40, true); bytes.set([1, 2, 3, 4], 8);
  view.setUint32(12, 1, true); view.setUint32(16, 8, true); view.setUint32(20, 4, true);
  view.setUint16(24, 7, true); bytes[26] = 9; bytes[27] = 1;
  for (let i = 0; i < 9; i++) view.setUint16(32 + i * 2, 'Ancillary'.charCodeAt(i), true);
  if (mode === 'range') view.setUint32(16, 100, true);
  if (mode === 'overlap') view.setUint32(16, 12, true);
  if (mode === 'flags') bytes[27] = 0;
  if (mode === 'name') bytes[26] = 32;
  if (mode === 'terminator') bytes[50] = 1;
  if (mode === 'size') view.setUint32(4, 39, true);
  if (mode === 'count') view.setUint32(12, 2, true);
  await expect(decryptBiffPropertySources(bytes, () => ({ xor() {}, close() {} }), f.context, () => {})).rejects.toThrow('Invalid Excel BIFF');
  expect(f.state().opened).toBe(1); expect(f.state().closed).toBe(1);
  for (const close of f.cleanups) await close();
});
it('parses a large staged table using fixed-size reads and closes it before payload replay', async () => {
  const streams = new Map(Array.from({ length: 800 }, (_, i) => [`Property${i}`, new Uint8Array([i % 251])]));
  const context = { ...base, limits: { ...base.limits, outputBytes: 2e6 } };
  const encrypted = prepareBiffPropertyContainer(streams, context, () => {})((block, length) => rc4Stream(key(block), length, context));
  const cleanups: (() => void | Promise<void>)[] = []; let opened = 0, closed = 0, tableReads = 0;
  const result = await decryptBiffPropertySources(encrypted, block => createRc4Cipher(key(block), context), { ...context,
    own(close) { cleanups.push(close); }, createWorkingStorage() {
      const ordinal = ++opened; let bytes = new Uint8Array();
      if (ordinal > 1) expect(closed).toBe(1);
      return { allocate(size) { if (ordinal === 1) expect(size).toBeGreaterThan(16384); bytes = new Uint8Array(size); return 0; },
        async write(at, part) { expect(part.length).toBeLessThanOrEqual(16384); bytes.set(part, at); },
        async read(at, size) { if (ordinal === 1) { tableReads++; expect(size).toBeLessThanOrEqual(64); } return bytes.subarray(at, at + size); },
        async close() { closed++; bytes.fill(0); } };
    }
  }, () => {});
  expect(tableReads).toBe(1601); expect(closed).toBe(1);
  expect(await result.get('Property799')!.read(0, 1)).toEqual(streams.get('Property799'));
  for (const close of cleanups) await close(); expect(closed).toBe(801);
});
