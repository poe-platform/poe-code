import { expect, it } from "vitest";
import { createEngine } from "@poe-code/spreadsheet-engine";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createBiffRecordStore } from "./biff-record-storage.js";

it('indexes record headers in caller storage and loads owned payloads only on demand', async () => {
  const count = 2048, width = 132, bytes = new Uint8Array(count * width), view = new DataView(bytes.buffer);
  for (let i = 0; i < count; i++) { view.setUint16(i * width, 0x203, true); view.setUint16(i * width + 2, 128, true); bytes.fill(i % 251, i * width + 4, (i + 1) * width); }
  const fs = createMemoryFileSystem(), borrowed = new Uint8Array(16384);
  let payloads = false, reads = 0;
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [],
    async readSource(source, context) {
      const records = await createBiffRecordStore(source, context);
      expect(records.length).toBe(count); expect(reads).toBe(count);
      const { decryptBiffRecords } = await import('./biff-encryption.js');
      expect(await decryptBiffRecords(records, 8, context)).toBeUndefined();
      expect(reads).toBe(count);
      payloads = true;
      const first = await records.get(0), last = await records.get(count - 1);
      expect(first!.data.bytes).toEqual(new Uint8Array(128));
      expect(last!.data.bytes).toEqual(new Uint8Array(128).fill((count - 1) % 251));
      const replacement = new Uint8Array(128).fill(253);
      await records.set(0, replacement); replacement.fill(0);
      expect((await records.get(0))!.data.bytes).toEqual(new Uint8Array(128).fill(253));
      expect(first!.data.bytes).toEqual(new Uint8Array(128));
      expect((await records.atOffset((count - 1) * width))!.opcode).toBe(0x203);
      expect(await records.atOffset(1)).toBeUndefined();
      expect(await records.get(count)).toBeUndefined();
      await records.close();
      await expect(records.get(0)).rejects.toThrow('closed');
      return { sheets: [] };
    }
  }] });
  await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, length) {
    reads++; if (!payloads) expect(length).toBe(4);
    borrowed.set(bytes.subarray(position, position + length)); return borrowed.subarray(0, length);
  } } }, { importType: 'fixture' }, { signal: new AbortController().signal });
  expect(await fs.readdir('/')).toEqual([]); await engine.dispose();
});

it('stores non-contiguous sheet selections across append blocks without retaining records', async () => {
  const { createBiffRecordSelections } = await import('./biff-record-storage.js');
  const { Binary } = await import('./biff-binary.js');
  const fs = createMemoryFileSystem();
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [],
    async read() {
      throw new Error('context required');
    }, async readSource(_source, context) {
      let accesses = 0;
      const create = createBiffRecordSelections({ length: 10000, async get(index) { accesses++; return { opcode: index, offset: index * 4, data: new Binary(new Uint8Array()) }; } }, context);
      const first = create(), second = create();
      for (let i = 0; i < 4100; i++) { await first.append(i * 2); if (i % 1000 === 0) await second.append(i); }
      expect(accesses).toBe(0);
      for (const i of [0, 2047, 2048, 4099, 3]) expect((await first.get(i))!.opcode).toBe(i * 2);
      for (let i = 0; i < 5; i++) expect((await second.get(i))!.opcode).toBe(i * 1000);
      expect(await second.get(5)).toBeUndefined();
      return { sheets: [] };
    }
  }] });
  await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: new AbortController().signal });
  expect(await fs.readdir('/')).toEqual([]); await engine.dispose();
});

it.each(['xor', 'rc4', 'rc4-cryptoapi-128-properties'])('reads encrypted %s records and sheet metadata through caller storage', async encryption => {
  const { createBiffWriter, readBiff } = await import('./biff.js');
  const context = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' },
    limits: { inputBytes: 2e6, outputBytes: 2e6, cells: 2000, sheets: 5, operations: 100 },
    password: { async read() { return encryption === 'xor' ? new Uint8Array([112, 97, 115, 115]) : 'password'; } },
    entropy: { async read({ length }: { length: number }) { return Uint8Array.from({ length }, (_, i) => i + 1); } } };
  const book = { properties: { title: 'Private title' }, sheets: [0, 1].map(i => ({ id: String(i), name: 'Data' + i, view: { printHeader: 'Private &P', marginLeft: 40 }, cells: [
    { row: 0, column: 0, value: { kind: 'string' as const, value: 'Long text '.repeat(1500) } },
    { row: 1, column: 0, formula: '=41+1', value: { kind: 'number' as const, value: 42 } }
  ] })) };
  const bytes = await createBiffWriter(8)(book, [`encryption=${encryption}`], context), expected = await readBiff(bytes, context);
  const fs = createMemoryFileSystem(), borrowed = new Uint8Array(257);
  const engine = createEngine({ password: context.password, workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{
    id: 'fixture', description: 'fixture', extensions: [], async readSource(source, ctx) {
      const result = await readBiff(source, ctx); expect(result).toEqual(expected); return result;
    }
  }] });
  await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, maximum) {
    const length = Math.min(maximum, 257); borrowed.set(bytes.subarray(position, position + length)); return borrowed.subarray(0, length);
  } } }, { importType: 'fixture' }, { signal: context.signal });
  expect(await fs.readdir('/')).toEqual([]); await engine.dispose();
});

it('coalesces staged decrypted records under a one-page caller cache', async () => {
  const { createBiffWriter, readBiff } = await import('./biff.js');
  const context = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' },
    limits: { inputBytes: 2e6, outputBytes: 2e6, cells: 2000, sheets: 5, operations: 100 },
    password: { async read() { return 'password'; } }, entropy: { async read({ length }: { length: number }) { return Uint8Array.from({ length }, (_, i) => i + 1); } } };
  const bytes = await createBiffWriter(8)({ sheets: [{ id: 's', name: 'Data', cells: Array.from({ length: 1000 }, (_, row) => ({ row, column: 0, value: { kind: 'number' as const, value: row } })) }] }, ['encryption=rc4'], context);
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs); let written = 0;
  fs.open = async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle);
    handle.write = async (chunk, position, options) => { written += chunk.length; expect(chunk.length).toBeLessThanOrEqual(16384); return write(chunk, position, options); };
    return handle;
  };
  const engine = createEngine({ password: context.password, workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{
    id: 'fixture', description: 'fixture', extensions: [], async readSource(source, ctx) { return readBiff(source, ctx); }
  }] });
  const push = Array.prototype.push;
  Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
    for (const item of items) if (item && typeof item === 'object' && 'opcode' in item && 'offset' in item && 'data' in item)
      throw new Error('retained BIFF record array');
    return push.apply(this, items);
  };
  try {
    const book = await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, length) { return bytes.subarray(position, position + length); } } }, { importType: 'fixture' }, { signal: context.signal });
    expect(book.sheets[0]!.cells).toHaveLength(1000);
  } finally { Array.prototype.push = push; }
  expect(written).toBeLessThan(1024 * 1024);
  expect(await fs.readdir('/')).toEqual([]); await engine.dispose();
});

it('rejects duplicate stored FILEPASS declarations before password or payload access', async () => {
  const { decryptBiffRecords } = await import('./biff-encryption.js');
  const bytes = Uint8Array.of(0x2f, 0, 2, 0, 0, 0, 0x2f, 0, 2, 0, 0, 0), fs = createMemoryFileSystem();
  let passwords = 0, reads = 0;
  const engine = createEngine({ password: { async read() { passwords++; return 'password'; } }, workingFiles: { fs, directory: '/' }, codecs: [{
    id: 'fixture', description: 'fixture', extensions: [], async readSource(source, ctx) {
      const records = await createBiffRecordStore(source, ctx);
      await expect(decryptBiffRecords(records, 8, ctx)).rejects.toThrow('duplicate FILEPASS');
      expect(reads).toBe(2); expect(passwords).toBe(0); await records.close(); return { sheets: [] };
    }
  }] });
  await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, length) { reads++; expect(length).toBe(4); return bytes.subarray(position, position + length); } } }, { importType: 'fixture' }, { signal: new AbortController().signal });
  await engine.dispose(); expect(await fs.readdir('/')).toEqual([]);
});
it('erases transient decrypted bytes when backing replacement fails', async () => {
  const { createBiffWriter } = await import('./biff.js');
  const { readBiffRange } = await import('./biff-range.js');
  const { decryptBiffRecords } = await import('./biff-encryption.js');
  const context = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' },
    limits: { inputBytes: 100000, outputBytes: 100000, cells: 10, sheets: 5, operations: 100 },
    password: { async read() { return 'password'; } }, entropy: { async read({ length }: { length: number }) { return Uint8Array.from({ length }, (_, i) => i + 1); } } };
  const bytes = await createBiffWriter(8)({ sheets: [{ id: 's', name: 'Data', cells: [] }] }, ['encryption=rc4'], context);
  const fs = createMemoryFileSystem(), failure = new Error('backing failure'); let captured: Uint8Array | undefined;
  const engine = createEngine({ password: context.password, workingFiles: { fs, directory: '/' }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [],
    async readSource(source, ctx) {
      const input = await readBiffRange(source, ctx);
      try {
        if (!('get' in input.records)) throw new Error('record store required');
        await expect(decryptBiffRecords({ ...input.records, async set(_index, bytes) { captured = bytes; throw failure; } }, 8, ctx, input.streams)).rejects.toBe(failure);
        expect(captured?.every(byte => byte === 0)).toBe(true);
      } finally { await input.close(); }
      return { sheets: [] };
    }
  }] });
  await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, length) { return bytes.subarray(position, position + length); } } }, { importType: 'fixture' }, { signal: context.signal });
  await engine.dispose(); expect(await fs.readdir('/')).toEqual([]);
});

it('preserves parsing and backing cleanup failures together', async () => {
  const { readBiff } = await import('./biff.js');
  const sourceFailure = new Error('source failed'), cleanupFailure = new Error('cleanup failed');
  const bytes = Uint8Array.of(9, 2, 4, 0, 0, 3, 16, 0, 10, 0, 0, 0), backing = new Uint8Array(256); let end = 8;
  const context = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' },
    limits: { inputBytes: 1000, outputBytes: 1000, cells: 10, sheets: 5, operations: 100 },
    createWorkingStorage() { return {
      allocate(length: number) { const at = end; end += length; return at; },
      async read(position: number, length: number) { return backing.slice(position, position + length); },
      async write(position: number, bytes: Uint8Array) { backing.set(bytes, position); },
      async close() { throw cleanupFailure; }
    }; }
  };
  const result = readBiff({ size: bytes.length, async read(position, count) { if (position === 4) throw sourceFailure; return bytes.subarray(position, position + count); } }, context);
  await expect(result).rejects.toMatchObject({ errors: [sourceFailure, cleanupFailure] });
});

it('owns each sheet-selection store before acquisition', async () => {
  const { createBiffRecordSelections } = await import('./biff-record-storage.js');
  let registrations = 0, acquisitions = 0;
  const context = { signal: new AbortController().signal,
    own(cleanup: () => void | Promise<void>) { if (++registrations === 2) void cleanup(); },
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, limits: { inputBytes: 1000, outputBytes: 1000, cells: 10, sheets: 5, operations: 100 },
    createWorkingStorage(): never { acquisitions++; throw new Error('unexpected acquisition'); }
  };
  const create = createBiffRecordSelections({ length: 0, async get() { return undefined; } }, context);
  expect(() => create()).toThrow('closed'); expect(acquisitions).toBe(0);
});
