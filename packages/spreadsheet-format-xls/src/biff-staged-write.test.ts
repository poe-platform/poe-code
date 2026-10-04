import { expect, it, vi } from 'vitest';
import type { CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
import { createBiffWriter, createBiffStreamWriter } from './biff.js';
import { BiffOutput } from './biff-write-binary.js';

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { inputBytes: 2e6, outputBytes: 2e6, cells: 5000, sheets: 10, operations: 100 } };
it.each([7, 8, 'dsf'] as const)('stages BIFF %s records without finishing a resident record array', async profile => {
  const book = { sheets: [{ id: 's', name: 'Data', cells: Array.from({ length: 2000 }, (_, row) => ({ row, column: 0,
    value: { kind: 'string' as const, value: `item ${row}` } })) }] };
  const expected = await createBiffWriter(profile)(book, [], context);
  const cleanup: (() => void | Promise<void>)[] = []; let writes = 0, acquired = 0, closed = 0, pending = 0;
  const ctx: CapabilityContext = { ...context, own(fn) { cleanup.push(fn); }, createWorkingStorage() {
    acquired++; const storage = new Uint8Array(2e6), borrowed = new Uint8Array(16384); let end = 8;
    return { allocate(length) { const at = end; end += length; return at; },
      async write(at, bytes) { expect(bytes.length).toBeLessThanOrEqual(16384); expect(++pending).toBe(1); await Promise.resolve(); storage.set(bytes, at); writes++; pending--; },
      async read(at, length) { expect(length).toBeLessThanOrEqual(16384); borrowed.set(storage.subarray(at, at + length)); return borrowed.subarray(0, length); },
      async close() { expect(pending).toBe(0); closed++; } };
  } };
  const finish = vi.spyOn(BiffOutput.prototype, 'finish').mockImplementation(() => { throw new Error('resident BIFF finish'); });
  try {
    let at = 0;
    for await (const bytes of createBiffStreamWriter(profile)(book, [], ctx)) {
      expect(bytes.every((value, i) => value === expected[at + i])).toBe(true); at += bytes.length;
    }
    expect(at).toBe(expected.length); expect(writes).toBeGreaterThan(1); expect(acquired).toBeGreaterThan(0);
    expect(closed).toBe(acquired);
  } finally { finish.mockRestore(); for (const close of cleanup.reverse()) await close(); }
  expect(closed).toBe(acquired);
});

it.each([7, 8, 'dsf'] as const)('publishes BIFF %s through injected safe-fs with bounded transfers', async profile => {
  const { createMemoryFileSystem } = await import('@poe-code/safe-fs/core');
  const { createEngine } = await import('@poe-code/spreadsheet-engine');
  const { xlsFormat } = await import('./index.js');
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs); let written = 0, pending = 0;
  vi.spyOn(fs, 'readFile').mockRejectedValue(new Error('whole-file read'));
  vi.spyOn(fs, 'writeFile').mockRejectedValue(new Error('whole-file write'));
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle);
    vi.spyOn(handle, 'write').mockImplementation(async (bytes, ...args) => {
      pending += bytes.length; expect(pending).toBeLessThanOrEqual(16384); written += bytes.length;
      try { await Promise.resolve(); return await write(bytes, ...args); } finally { pending -= bytes.length; }
    }); return handle;
  });
  const buffered = vi.fn(() => { throw new Error('buffered writer'); });
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, formats: [{ ...xlsFormat,
    services: xlsFormat.services.map(codec => codec.direction === 'write' ? { ...codec, write: buffered } : codec) }] });
  const raw = { sheets: [{ id: 's', name: 'Data', cells: Array.from({ length: 2000 }, (_, row) => ({ row, column: 0, value: { kind: 'number' as const, value: row } })) }] };
  const expected = await createBiffWriter(profile)(raw, [], context);
  try {
    const book = await engine.adoptWorkbook(raw, { signal: context.signal }); let at = 0;
    await engine.writeWorkbook(book, { kind: 'stream', sink: { async write(bytes) {
      expect(bytes.length).toBeLessThanOrEqual(16384); expect(bytes.every((byte, i) => byte === expected[at + i])).toBe(true);
      at += bytes.length; await Promise.resolve();
    } } }, { exportType: `Gnumeric_Excel:excel_${profile === 'dsf' ? profile : `biff${profile}`}` }, { signal: context.signal });
    expect(at).toBe(expected.length); expect(written).toBeGreaterThan(16384); expect(buffered).not.toHaveBeenCalled();
    expect(await fs.readdir('/')).toEqual([]);
  } finally { await engine.dispose(); }
});

it.each(['write', 'read', 'sink', 'cancel'])('cleans injected BIFF output storage after %s failure', async mode => {
  const { createMemoryFileSystem } = await import('@poe-code/safe-fs/core');
  const { createEngine } = await import('@poe-code/spreadsheet-engine');
  const { xlsFormat } = await import('./index.js');
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs), controller = new AbortController(), reason = new Error(mode);
  let closed = 0;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle);
    vi.spyOn(handle, 'close').mockImplementation(async (...args) => { closed++; await close(...args); });
    if (mode === 'write') vi.spyOn(handle, 'write').mockRejectedValue(reason);
    if (mode === 'read') vi.spyOn(handle, 'read').mockRejectedValue(reason);
    return handle;
  });
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, formats: [xlsFormat] });
  const raw = { sheets: [{ id: 's', name: 'Data', cells: Array.from({ length: 2000 }, (_, row) => ({ row, column: 0, value: { kind: 'number' as const, value: row } })) }] };
  try {
    const book = await engine.adoptWorkbook(raw, { signal: controller.signal });
    await expect(engine.writeWorkbook(book, { kind: 'stream', sink: { async write() {
      if (mode === 'sink') throw reason;
      if (mode === 'cancel') controller.abort(reason);
    } } }, { exportType: 'Gnumeric_Excel:excel_biff8' }, { signal: controller.signal })).rejects.toBe(reason);
    expect(closed).toBeGreaterThan(0); expect(await fs.readdir('/')).toEqual([]);
  } finally { await engine.dispose(); }
});
