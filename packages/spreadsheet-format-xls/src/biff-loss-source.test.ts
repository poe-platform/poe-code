import { expect, it, vi } from 'vitest';
import { BiffOutput } from './biff-write-binary.js';
import { BiffMetadataWriter } from './biff-write-metadata.js';

const context = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { inputBytes: 2e6, outputBytes: 2e6, cells: 5000, sheets: 10, operations: 100 } };
it('scans headers without retaining unrequested cell payload signatures', async () => {
  const out = new BiffOutput(context, 8224);
  for (let i = 0; i < 1000; i++) { const bytes = new Uint8Array(100); new DataView(bytes.buffer).setUint32(0, i, true); out.record(0x203, bytes); }
  const bytes = out.finish(), borrowed = new Uint8Array(2); let readBytes = 0;
  const add = Set.prototype.add;
  const spy = vi.spyOn(Set.prototype, 'add').mockImplementation(function(this: Set<unknown>, value: unknown) {
    if (typeof value === 'string' && value.length === 200) throw new Error('resident cell signature');
    return add.call(this, value);
  });
  try {
    await new BiffMetadataWriter({ sheets: [] }, context, 65536).loss({ size: bytes.length, async read(at, count) {
      const part = bytes.subarray(at, at + Math.min(count, borrowed.length)); readBytes += part.length; borrowed.set(part); return borrowed.subarray(0, part.length);
    } });
  } finally { spy.mockRestore(); }
  expect(readBytes).toBe(4000);
});
it('preserves raw metadata, print-option and margin matching through borrowed ranges', async () => {
  const out = new BiffOutput(context, 8224); out.record(0x2a, new Uint8Array([1, 0])); out.record(0x12, new Uint8Array([7, 0]));
  const margin = new Uint8Array(8); new DataView(margin.buffer).setFloat64(0, 1.5, true); out.record(0x26, margin);
  const bytes = out.finish(), warnings: string[] = [];
  const sheet = { id: 's', name: 'Data', cells: [], unsupportedRecords: [
    { source: 'biff' as const, kind: 'record', disposition: 'retained' as const, data: { opcode: 0x12, bytes: '0700' } },
    { source: 'xlsx' as const, kind: 'printOptions', disposition: 'retained' as const, data: { name: 'printOptions', attributes: { headings: '1' }, text: '', children: [], namespace: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main' } },
    { source: 'xlsx' as const, kind: 'pageMargins', disposition: 'retained' as const, data: { name: 'pageMargins', attributes: { left: '1.5' }, text: '', children: [], namespace: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main' } },
    { source: 'biff' as const, kind: 'mismatch', disposition: 'retained' as const, data: { opcode: 0x12, bytes: '0800' } }
  ] };
  const writer = new BiffMetadataWriter({ sheets: [sheet] }, { ...context, async diagnostic(value) { warnings.push(value.message); } }, 65536);
  const borrowed = new Uint8Array(3);
  await writer.loss({ size: bytes.length, async read(at, count) { const part = bytes.subarray(at, at + Math.min(3, count)); borrowed.set(part); return borrowed.subarray(0, part.length); } }, sheet);
  expect(warnings).toEqual(['Unsupported Excel BIFF export metadata: mismatch']);
});
