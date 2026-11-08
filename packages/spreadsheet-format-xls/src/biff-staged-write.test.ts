import { expect, it, vi } from 'vitest';
import type { CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
import { createBiffWriter, createBiffStreamWriter } from './biff.js';
import { BiffOutput } from './biff-write-binary.js';

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { inputBytes: 2e6, outputBytes: 2e6, cells: 5000, sheets: 10, operations: 100 } };
it.each([[7, false], [8, false], ['dsf', false], [7, true], [8, true], ['dsf', true], [8, 'rc4'], [8, 'rc4-cryptoapi-40-properties'], [8, 'rc4-cryptoapi-128']] as const)('stages BIFF %s encryption=%s without finishing a resident record array', async (profile, xor) => {
  const book = { sheets: [{ id: 's', name: 'Data', cells: Array.from({ length: 2000 }, (_, row) => ({ row, column: 0,
    value: { kind: 'string' as const, value: `item ${row}` } })) }] };
  const options = xor ? [`encryption=${xor === true ? 'xor' : xor}`] : [];
  const encryptionContext = { ...context, password: { async read() { return xor === true ? new Uint8Array([112, 97, 115, 115]) : 'password'; } },
    entropy: { async read({ length }: { length: number }) { return Uint8Array.from({ length }, (_, i) => i + 1); } } };
  const expected = await createBiffWriter(profile)(book, options, encryptionContext);
  const cleanup: (() => void | Promise<void>)[] = []; let writes = 0, acquired = 0, closed = 0, pending = 0;
  const ctx: CapabilityContext = { ...encryptionContext, own(fn) { cleanup.push(fn); }, createWorkingStorage() {
    acquired++; const storage = new Uint8Array(2e6), borrowed = new Uint8Array(16384); let end = 8;
    return { allocate(length) { const at = end; end += length; return at; },
      async write(at, bytes) { expect(bytes.length).toBeLessThanOrEqual(16384); expect(++pending).toBe(1); await Promise.resolve(); storage.set(bytes, at); writes++; pending--; },
      async read(at, length) { expect(length).toBeLessThanOrEqual(16384); borrowed.set(storage.subarray(at, at + length)); return borrowed.subarray(0, length); },
      async close() { expect(pending).toBe(0); closed++; } };
  } };
  const finish = vi.spyOn(BiffOutput.prototype, 'finish').mockImplementation(() => { throw new Error('resident BIFF finish'); });
  try {
    let at = 0;
    for await (const bytes of createBiffStreamWriter(profile)(book, options, ctx)) {
      expect(bytes.every((value, i) => value === expected[at + i])).toBe(true); at += bytes.length;
    }
    expect(at).toBe(expected.length); expect(writes).toBeGreaterThan(1); expect(acquired).toBeGreaterThan(0);
    expect(closed).toBe(acquired);
  } finally { finish.mockRestore(); for (const close of cleanup.reverse()) await close(); }
  expect(closed).toBe(acquired);
});

it.each([[7, false], [8, false], ['dsf', false], [7, true], [8, true], ['dsf', true], [8, 'rc4'], [8, 'rc4-cryptoapi-40-properties'], [8, 'rc4-cryptoapi-128']] as const)('publishes BIFF %s encryption=%s through injected safe-fs with bounded transfers', async (profile, xor) => {
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
  const password = { async read() { return xor === true ? new Uint8Array([112, 97, 115, 115]) : 'password'; } };
  const entropy = { async read({ length }: { length: number }) { return Uint8Array.from({ length }, (_, i) => i + 1); } };
  const options = xor ? [`encryption=${xor === true ? 'xor' : xor}`] : [];
  const engine = createEngine({ password, entropy, workingFiles: { fs, directory: '/', cacheBytes: 16384 }, formats: [{ ...xlsFormat,
    services: xlsFormat.services.map(codec => codec.direction === 'write' ? { ...codec, write: buffered } : codec) }] });
  const raw = { sheets: [{ id: 's', name: 'Data', cells: Array.from({ length: 2000 }, (_, row) => ({ row, column: 0, value: { kind: 'number' as const, value: row } })) }] };
  const expected = await createBiffWriter(profile)(raw, options, { ...context, password, entropy });
  try {
    const book = await engine.adoptWorkbook(raw, { signal: context.signal }); let at = 0;
    await engine.writeWorkbook(book, { kind: 'stream', sink: { async write(bytes) {
      expect(bytes.length).toBeLessThanOrEqual(16384); expect(bytes.every((byte, i) => byte === expected[at + i])).toBe(true);
      at += bytes.length; await Promise.resolve();
    } } }, { exportOptions: options, exportType: `Gnumeric_Excel:excel_${profile === 'dsf' ? profile : `biff${profile}`}` }, { signal: context.signal });
    expect(at).toBe(expected.length); expect(written).toBeGreaterThan(16384); expect(buffered).not.toHaveBeenCalled();
    expect(await fs.readdir('/')).toEqual([]);
  } finally { await engine.dispose(); }
});

it.each(['write', 'read', 'sink', 'cancel', 'password', 'entropy'].flatMap(mode => [[mode, false], [mode, true]] as const))('cleans injected BIFF output storage after %s failure with properties=%s', async (mode, properties) => {
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
  const credentialFailure = mode === 'password' || mode === 'entropy';
  const engine = createEngine({
    password: { async read() { if (mode === 'password') throw reason; return 'password'; } },
    entropy: { async read({ length }) { if (mode === 'entropy') throw reason; return Uint8Array.from({ length }, (_, i) => i + 1); } },
    workingFiles: { fs, directory: '/', cacheBytes: 16384 }, formats: [xlsFormat] });
  const raw = { sheets: [{ id: 's', name: 'Data', cells: Array.from({ length: 2000 }, (_, row) => ({ row, column: 0, value: { kind: 'number' as const, value: row } })) }] };
  try {
    const book = await engine.adoptWorkbook(raw, { signal: controller.signal });
    const operation = engine.writeWorkbook(book, { kind: 'stream', sink: { async write() {
      if (mode === 'sink') throw reason;
      if (mode === 'cancel') controller.abort(reason);
    } } }, { exportType: 'Gnumeric_Excel:excel_biff8', exportOptions: properties ? ['encryption=rc4-cryptoapi-128-properties'] : credentialFailure ? ['encryption=rc4'] : [] }, { signal: controller.signal });
    if (credentialFailure) await expect(operation).rejects.toThrow('acquisition failed');
    else await expect(operation).rejects.toBe(reason);
    expect(closed).toBeGreaterThan(0); expect(await fs.readdir('/')).toEqual([]);
  } finally { await engine.dispose(); }
});
