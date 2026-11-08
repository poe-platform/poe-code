import { expect, it } from 'vitest';
import type { CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
import { encryptedBiffPropertyStream } from './biff-encrypted-properties.js';
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { inputBytes: 2e6, outputBytes: 2e6, workbookWork: 30e6, cells: 10, sheets: 2, operations: 100 } };
function placeholder() {
  const bytes = new Uint8Array(1000000), view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfffe, true); view.setUint32(24, 1, true); view.setUint32(44, 48, true);
  bytes.set(Buffer.from('02d5cdd59c2e1b10939708002b2cf9ae', 'hex'), 28);
  view.setUint32(48, bytes.length - 48, true); view.setUint32(52, 1, true);
  view.setUint32(56, 1, true); view.setUint32(60, 16, true); view.setUint32(64, 2, true);
  return bytes;
}
it('checks large plaintext placeholders with bounded borrowed reads instead of copying their padding', async () => {
  const bytes = placeholder(), encrypted = new Uint8Array(8), borrowed = new Uint8Array(7); let readBytes = 0;
  const source = { size: bytes.length, async read(at: number, count: number) {
    expect(count).toBeLessThanOrEqual(16384); const part = bytes.subarray(at, at + Math.min(count, 7));
    borrowed.set(part); readBytes += part.length; return borrowed.subarray(0, part.length);
  } };
  const result = await encryptedBiffPropertyStream(new Map([['encryption', encrypted], ['\u0005DocumentSummaryInformation', new Uint8Array()]]),
    context, () => {}, new Map([['\u0005DocumentSummaryInformation', source]]));
  expect(result).toBe(encrypted); expect(readBytes).toBeGreaterThan(0); expect(readBytes).toBeLessThan(100);
});
it.each(['collision', 'read', 'empty', 'abort'])('rejects ranged preflight %s before proceeding', async mode => {
  const bytes = placeholder(), controller = new AbortController(), failure = new Error(mode);
  if (mode === 'collision') new DataView(bytes.buffer).setUint32(56, 2, true);
  const source = { size: bytes.length, async read(at: number, count: number) {
    if (mode === 'read') throw failure;
    if (mode === 'empty') return new Uint8Array();
    if (mode === 'abort') controller.abort(failure);
    return bytes.subarray(at, at + count);
  } };
  const result = encryptedBiffPropertyStream(new Map([['ENCRYPTION', new Uint8Array(8)], ['\u0005DocumentSummaryInformation', new Uint8Array()]]),
    { ...context, signal: controller.signal }, () => {}, new Map([['\u0005DocumentSummaryInformation', source]]));
  if (mode === 'read' || mode === 'abort') await expect(result).rejects.toBe(failure);
  else await expect(result).rejects.toThrow(mode === 'empty' ? 'truncated' : 'ambiguous');
});
it.each([false, true])('validates caller-backed plaintext collision=%s before password acquisition', async collision => {
  const { createBiffWriter, readBiff } = await import('./biff.js');
  const { readCfb } = await import('./biff-binary.js'), { writeCfb } = await import('./biff-write-binary.js');
  const { createEngine } = await import('@poe-code/spreadsheet-engine');
  const { createMemoryFileSystem } = await import('@poe-code/safe-fs/core');
  const secret = { ...context, password: { async read() { return 'secret'; } },
    entropy: { async read() { return Uint8Array.from({ length: 32 }, (_, i) => i); } } };
  const book = { sheets: [{ id: 's', name: 'S', cells: [] }], properties: { 'dc:title': 'Encrypted title' } };
  const streams = new Map(readCfb(await createBiffWriter(8)(book, ['encryption=rc4-cryptoapi-128-properties'], secret), context));
  const plain = placeholder(); if (collision) new DataView(plain.buffer).setUint32(56, 2, true);
  streams.set('\u0005DocumentSummaryInformation', plain);
  const bytes = writeCfb(streams, context), fs = createMemoryFileSystem(); let passwords = 0;
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [],
    readSource(input, ctx) { return readBiff(input, { ...ctx, password: { async read() { passwords++; return 'secret'; } } }); }
  }] });
  try {
    const result = engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(at, count) { return bytes.subarray(at, at + count); } } },
      { importType: 'fixture' }, { signal: context.signal });
    if (collision) { await expect(result).rejects.toThrow('ambiguous plaintext'); expect(passwords).toBe(0); }
    else { expect((await result).properties).toEqual(book.properties); expect(passwords).toBe(1); }
  } finally { await engine.dispose(); }
  expect(await fs.readdir('/')).toEqual([]);
});
