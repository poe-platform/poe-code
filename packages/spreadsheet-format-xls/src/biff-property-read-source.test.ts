import { expect, it } from 'vitest';
import type { CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
import { writeBiffProperties } from './biff-properties-write.js';
import { readBiffProperties } from './biff-properties.js';
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { inputBytes: 2e6, outputBytes: 2e6, workbookWork: 30e6, cells: 10, sheets: 2, operations: 100 } };
it('reads large properties across borrowed short UTF-8 windows without a payload-wide read', async () => {
  const book = { sheets: [], properties: { 'dc:title': '漢😀'.repeat(20000), Custom: 'é'.repeat(10000), Signed: -0, True: true } };
  const { streams } = await writeBiffProperties(book, context), borrowed = new Uint8Array(257); let reads = 0;
  const sources = new Map([...streams].map(([name, bytes]) => [name, { size: bytes.length, async read(at: number, count: number) {
    expect(count).toBeLessThanOrEqual(16384); reads++;
    const value = bytes.subarray(at, at + Math.min(count, 257)); borrowed.set(value); return borrowed.subarray(0, value.length);
  } }] as const));
  expect(await readBiffProperties(sources, context, text => text, () => {}, undefined)).toEqual(book.properties);
  expect(reads).toBeGreaterThan(500);
});
it.each(['read', 'empty', 'abort'])('preserves %s input failure while decoding properties', async mode => {
  const { streams } = await writeBiffProperties({ sheets: [], properties: { 'dc:title': 'hello'.repeat(5000) } }, context);
  const controller = new AbortController(), failure = new Error(mode); let reads = 0;
  const sources = new Map([...streams].map(([name, bytes]) => [name, { size: bytes.length, async read(at: number, count: number) {
    if (++reads > 6) { if (mode === 'read') throw failure; if (mode === 'empty') return new Uint8Array(); controller.abort(failure); }
    return bytes.subarray(at, at + count);
  } }] as const));
  const result = readBiffProperties(sources, { ...context, signal: controller.signal }, text => text, () => {}, undefined);
  if (mode === 'empty') await expect(result).rejects.toThrow('truncated'); else await expect(result).rejects.toBe(failure);
});

it('keeps CFB property streams as ranges when caller storage is supplied', async () => {
  const { createBiffWriter } = await import('./biff.js'), { readBiffRange } = await import('./biff-range.js');
  const { createEngine } = await import('@poe-code/spreadsheet-engine');
  const { createMemoryFileSystem } = await import('@poe-code/safe-fs/core');
  const book = { sheets: [{ id: 's', name: 'S', cells: [] }], properties: { 'dc:title': '漢😀'.repeat(20000) } };
  const bytes = await createBiffWriter(8)(book, [], context), fs = createMemoryFileSystem();
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [],
    async readSource(input, ctx) {
      const loaded = await readBiffRange(input, ctx);
      try {
        expect(loaded.propertySources?.get('\u0005SummaryInformation')).toBeDefined();
        expect(loaded.streams?.get('\u0005SummaryInformation')?.length).toBe(0);
        const properties = await readBiffProperties(loaded.propertySources!, ctx, text => text, () => {}, undefined);
        return { ...book, properties };
      } finally { await loaded.close(); }
    }
  }] });
  try {
    const result = await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(at, count) { return bytes.subarray(at, at + count); } } },
      { importType: 'fixture' }, { signal: context.signal });
    expect(result.properties).toEqual(book.properties);
  } finally { await engine.dispose(); }
  expect(await fs.readdir('/')).toEqual([]);
});

function nativeProperty(codepage: number, payload: Uint8Array, wide = false): Uint8Array {
  const width = wide ? 2 : 1, bytes = new Uint8Array(88 + payload.length + width), view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfffe, true); view.setUint32(24, 1, true); view.setUint32(44, 48, true);
  bytes.set(Buffer.from('e0859ff2f94f6810ab9108002b27b3d9', 'hex'), 28);
  view.setUint32(48, bytes.length - 48, true); view.setUint32(52, 2, true);
  view.setUint32(56, 1, true); view.setUint32(60, 24, true); view.setUint32(64, 2, true); view.setUint32(68, 32, true);
  view.setUint32(72, 2, true); view.setUint16(76, codepage, true);
  view.setUint32(80, wide ? 31 : 30, true); view.setUint32(84, payload.length / width + 1, true); bytes.set(payload, 88); return bytes;
}
it.each(['utf8', 'utf16', 'dbcs'])('preserves %s characters across decoder windows', async encoding => {
  const wide = encoding === 'utf16', prefix = 'a'.repeat(wide ? 8191 : 16383), value = prefix + (encoding === 'dbcs' ? 'あ' : '😀') + 'end';
  const payload = encoding === 'dbcs' ? new Uint8Array([...new TextEncoder().encode(prefix), 0x82, 0xa0, 101, 110, 100]) :
    wide ? new Uint8Array(Buffer.from(value, 'utf16le')) : new TextEncoder().encode(value);
  const bytes = nativeProperty(encoding === 'dbcs' ? 932 : wide ? 1200 : 65001, payload, wide);
  const source = { size: bytes.length, async read(at: number, count: number) { expect(count).toBeLessThanOrEqual(16384); return bytes.subarray(at, at + Math.min(count, 257)); } };
  expect(await readBiffProperties(new Map([['\u0005SummaryInformation', source]]), context, text => text, () => {}, undefined)).toEqual({ 'dc:title': value });
});
it('skips opaque values unless retention is requested, then encodes hex in bounded windows', async () => {
  const bytes = nativeProperty(65001, new Uint8Array(100000).fill(65)); new DataView(bytes.buffer).setUint32(80, 0x1001, true);
  let readBytes = 0;
  const source = { size: bytes.length, async read(at: number, count: number) { expect(count).toBeLessThanOrEqual(16384); readBytes += count; return bytes.subarray(at, at + count); } };
  const streams = new Map([['\u0005SummaryInformation', source]]);
  expect(await readBiffProperties(streams, context, text => text, () => {}, undefined)).toEqual({}); expect(readBytes).toBeLessThan(256);
  const retained: import('@poe-code/spreadsheet-ast').UnsupportedRecord[] = [];
  await readBiffProperties(streams, context, text => text, () => {}, retained);
  expect(retained[0]?.data).toEqual({ stream: '\u0005SummaryInformation', bytes: Buffer.from(bytes).toString('hex'), modeled: [] });
});
it('captures input capabilities and serializes borrowed reads with disposal checks', async () => {
  const { propertyRange } = await import('./biff-property-range.js');
  const cleanups: (() => void | Promise<void>)[] = [], borrowed = new Uint8Array(4);
  const source = { size: 20, async read(at: number, count: number) { for (let i = 0; i < Math.min(count, 4); i++) borrowed[i] = at + i; return borrowed.subarray(0, Math.min(count, 4)); } };
  const range = propertyRange(source, { ...context, own(fn) { cleanups.push(fn); } });
  source.size = 0; source.read = async () => { throw new Error('replaced'); };
  const [a, b] = await Promise.all([range.read(0, 10), range.read(10, 10)]);
  expect(a).toEqual(Uint8Array.from({ length: 10 }, (_, i) => i)); expect(b).toEqual(Uint8Array.from({ length: 10 }, (_, i) => i + 10));
  for (const close of cleanups) await close(); await expect(range.read(0, 1)).rejects.toThrow('closed');
});
