import assert from 'node:assert/strict';
export const binding = { entryCap: 16384, retainedByteCap: 1048576, charge: '6 * extracted selected key bytes + 2', characterParameter: 174762, quantization: 'two descriptors: 6 * combined key length + 4; below/at/above differ by 6 bytes', inputRecordStorage: 'existing owned records independently bounded; do not duplicate their charge as newly retained strings' };
const base64 = text => Buffer.from(text).toString('base64');
const make = (id, records, ordered, account) => ({ id, script: 'sort -s -t: -k2,2n', input: base64(records.join('\n') + '\n'), expected: { status: 0, stdout: base64(ordered.join('\n') + '\n'), stderr: '', files: {} }, account });
export function caps() {
  const rows = [];
  for (const [position, delta] of [['below', -1], ['at', 0], ['above', 1]]) {
    const count = binding.entryCap + delta;
    const records = Array.from({ length: count }, (_, index) => `label:${count - index}`);
    rows.push(make(`entry-${position}`, records, [...records].reverse(), { kind: 'entry', count }));
  }
  for (const [position, delta] of [['below', -1], ['at', 0], ['above', 1]]) {
    const total = binding.characterParameter + delta;
    const records = ['z:1' + 'x'.repeat(Math.floor(total / 2) - 1), 'a:1' + 'x'.repeat(Math.ceil(total / 2) - 1)];
    rows.push(make(`retained-${position}`, records, records, { kind: 'retained', aggregateCharge: 6 * total + 4 }));
  }
  const huge = 'x'.repeat(Math.ceil(binding.retainedByteCap / 6) + 31);
  for (const [id, middle] of [['oversized-extracted-small-prefix', 'a:1' + huge], ['oversized-record-small-key', 'a:1:' + huge]]) {
    const records = ['z:2', middle, 'b:0'];
    rows.push(make(id, records, [records[2], records[1], records[0]], { kind: id.includes('extracted') ? 'huge-key' : 'huge-record' }));
  }
  const ties = Array.from({ length: binding.entryCap + 3 }, (_, index) => `label-${index}:${index % 2 ? '1.000' : '0001'}`);
  rows.push(make('fallback-mid-sort-stable-ties', ties, ties, { kind: 'saturation' }));
  const empties = Array.from({ length: binding.entryCap + 1 }, (_, index) => `label-${index}`);
  rows.push(make('empty-keys-entry-cap', empties, empties, { kind: 'empty' }));
  for (const row of rows) assert.ok(Buffer.from(row.input, 'base64').length < 12 * 1024 * 1024);
  return rows;
}
