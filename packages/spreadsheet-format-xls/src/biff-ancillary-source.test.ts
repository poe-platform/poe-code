import { createBiffWriter } from './biff.js';
import { expect, it } from 'vitest';
import type { CapabilityContext, RangeSource } from '@poe-code/spreadsheet-engine/contracts';
import type { UnsupportedRecord } from '@poe-code/spreadsheet-ast';
import { appendBiffAncillaryStreams } from './biff-encrypted-properties-write.js';
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { inputBytes: 2e6, outputBytes: 2e6, cells: 10, sheets: 2, operations: 100 } };
const record = (bytes: string): UnsupportedRecord => ({ source: 'biff', kind: 'encrypted-ancillary', disposition: 'retained', data: { stream: 'Opaque', bytes } });

it('retains original hex and decodes owned bounded ranges without a full payload allocation', async () => {
  const hex = 'Ab0080fF'.repeat(25000), item = record(hex), streams = new Map<string, Uint8Array | RangeSource>(), handled = new Set<UnsupportedRecord>();
  const cleanups: (() => void | Promise<void>)[] = [];
  appendBiffAncillaryStreams({ sheets: [], unsupportedRecords: [item] }, streams, handled,
    { ...context, own(fn) { cleanups.push(fn); } }, true);
  const source = streams.get('Opaque') as RangeSource;
  expect(source).not.toBeInstanceOf(Uint8Array); expect(source.size).toBe(100000); expect(handled.has(item)).toBe(true);
  const [a, b] = await Promise.all([source.read(1, 100000), source.read(13, 7)]);
  expect(a.length).toBe(16384); expect(b).toEqual(new Uint8Array([0, 128, 255, 171, 0, 128, 255]));
  expect(a.every((byte, i) => byte === [171, 0, 128, 255][(i + 1) % 4])).toBe(true);
  b.fill(0); expect(a[1]).toBe(128);
  expect(await source.read(99999, 100)).toEqual(new Uint8Array([255]));
  expect(await source.read(100000, 1)).toEqual(new Uint8Array());
  for (const cleanup of cleanups) await cleanup();
  await expect(source.read(0, 1)).rejects.toThrow('disposed'); expect(item.data).toEqual({ stream: 'Opaque', bytes: hex });
});
it.each(['invalid', 'odd', 'duplicate', 'output', 'text', 'work'])('rejects %s ancillary input while preparing ranges', mode => {
  const bytes = mode === 'invalid' ? '00'.repeat(20000) + '0g' : mode === 'odd' ? 'abc' : 'ab'.repeat(1000);
  const streams = new Map<string, Uint8Array | RangeSource>();
  if (mode === 'duplicate') streams.set('opaque', new Uint8Array());
  const limits = { ...context.limits, ...(mode === 'output' ? { outputBytes: 10 } : {}),
    ...(mode === 'text' ? { workbookTextBytes: 10 } : {}), ...(mode === 'work' ? { workbookWork: 10 } : {}) };
  expect(() => appendBiffAncillaryStreams({ sheets: [], unsupportedRecords: [record(bytes)] }, streams, new Set(), { ...context, limits }, true)).toThrow();
  expect(streams.has('Opaque')).toBe(false);
});
it('bounds range requests and preserves cancellation', async () => {
  const streams = new Map<string, Uint8Array | RangeSource>(), controller = new AbortController();
  appendBiffAncillaryStreams({ sheets: [], unsupportedRecords: [record('ff00')] }, streams, new Set(), { ...context, signal: controller.signal }, true);
  const source = streams.get('Opaque') as RangeSource;
  await expect(source.read(-1, 1)).rejects.toThrow('Invalid'); await expect(source.read(0, Infinity)).rejects.toThrow('Invalid');
  await expect(source.read(3, 1)).rejects.toThrow('Invalid');
  const reason = new Error('cancelled'); controller.abort(reason); await expect(source.read(0, 1)).rejects.toBe(reason);
});

it('charges repeated decoding work and honors per-read cancellation', async () => {
  const streams = new Map<string, Uint8Array | RangeSource>();
  appendBiffAncillaryStreams({ sheets: [], unsupportedRecords: [record('ab'.repeat(20))] }, streams, new Set(),
    { ...context, limits: { ...context.limits, workbookWork: 100 } }, true);
  const source = streams.get('Opaque') as RangeSource, controller = new AbortController(), reason = new Error('read cancelled'); controller.abort(reason);
  await expect(source.read(0, 20, { signal: controller.signal })).rejects.toBe(reason);
  await source.read(0, 20); await source.read(0, 20);
  await expect(source.read(0, 20)).rejects.toThrow('work limit');
});

it.each(['invalid', 'odd', 'collision'])('rejects %s staged ancillary data before acquiring storage or passwords', async mode => {
  let passwords = 0, storage = 0;
  const data = mode === 'invalid' ? 'ab'.repeat(20000) + '0x' : mode === 'odd' ? 'a' : 'ff';
  const item = record(data), records = mode === 'collision' ? [item, item] : [item];
  await expect(createBiffWriter(8)({ sheets: [{ id: 's', name: 'S', cells: [] }], unsupportedRecords: records },
    ['encryption=rc4-cryptoapi-128-properties'], { ...context,
      createWorkingStorage() { storage++; throw new Error('storage accessed'); },
      password: { async read() { passwords++; return 'secret'; } },
      entropy: { async read() { return new Uint8Array(32); } }
    })).rejects.toThrow(mode === 'collision' ? 'Ambiguous' : 'Invalid retained');
  expect(passwords).toBe(0); expect(storage).toBe(0);
});
