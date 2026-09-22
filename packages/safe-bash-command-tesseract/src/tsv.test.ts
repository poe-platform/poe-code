import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTesseractBudget, renderTesseractTsv, type TesseractTsvRow } from './index.js';

const signal = new AbortController().signal;
const rows: TesseractTsvRow[] = [
  { level: 1, page: 1, block: 0, paragraph: 0, line: 0, word: 0, left: 0, top: 0, width: 220, height: 100, confidence: -1, text: '' },
  ...([2, 3, 4, 5] as const).map(level => ({ level, page: 1, block: 1, paragraph: level >= 3 ? 1 : 0, line: level >= 4 ? 1 : 0, word: level === 5 ? 1 : 0, left: 15, top: 20, width: 174, height: 42, confidence: level === 5 ? 94.235031 : -1, text: level === 5 ? 'HELLO' : '' }))
];
function budget() { return createTesseractBudget({ inputBytes: 10000, retainedBytes: 10000, outputBytes: 10000, work: 10000 }, signal); }

test('native bitmap TSV coordinates, hierarchy and six-decimal confidence', () => {
  const b = budget();
  const result = renderTesseractTsv(rows, b, signal);
  assert.equal(new TextDecoder().decode(result.bytes),
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n' +
    '1\t1\t0\t0\t0\t0\t0\t0\t220\t100\t-1\t\n' +
    '2\t1\t1\t0\t0\t0\t15\t20\t174\t42\t-1\t\n' +
    '3\t1\t1\t1\t0\t0\t15\t20\t174\t42\t-1\t\n' +
    '4\t1\t1\t1\t1\t0\t15\t20\t174\t42\t-1\t\n' +
    '5\t1\t1\t1\t1\t1\t15\t20\t174\t42\t94.235031\tHELLO\n');
  assert.equal(b.used('retainedBytes'), result.bytes.length);
  result.dispose(); result.dispose();
  assert.equal(b.used('retainedBytes'), 0);
  assert.equal(b.used('outputBytes'), 0);
  assert.ok(b.used('work') > 0); b.close();
});

test('blank pages keep page numbering and one header; UTF8 preserves astral and BOM text', () => {
  const b = budget();
  const copy = rows.map(row => ({ ...row }));
  copy[4]!.text = '\ufeffA😀';
  const result = renderTesseractTsv([...copy, { ...rows[0]!, page: 2 }], b, signal);
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(result.bytes);
  assert.ok(text.includes('\ufeffA😀\n1\t2\t')); result.dispose(); b.close();
});

test('invalid hierarchy, page bounds, scores and row injection fail before allocation', () => {
  for (const patch of [{ word: 2 }, { left: 219 }, { confidence: NaN }, { confidence: 101 }, { text: 'a\tb' }, { text: 'a\nb' }, { text: '\ud800' }]) {
    const b = budget();
    assert.throws(() => renderTesseractTsv([...rows.slice(0, 4), { ...rows[4]!, ...patch }], b, signal));
    assert.equal(b.used('retainedBytes'), 0); assert.equal(b.used('outputBytes'), 0); b.close();
  }
  const b = budget();
  assert.throws(() => renderTesseractTsv([rows[0]!, rows[4]!], b, signal)); b.close();
});

test('output exhaustion rolls back reservations; cancellation and closed invocations deny output', () => {
  const b = createTesseractBudget({ inputBytes: 10000, work: 10000, retainedBytes: 10000, outputBytes: 1 }, signal);
  assert.throws(() => renderTesseractTsv(rows, b, signal), /outputBytes/);
  assert.equal(b.used('retainedBytes'), 0); b.close();
  assert.throws(() => renderTesseractTsv(rows, b, signal), /closed/);
  const controller = new AbortController(); controller.abort();
  const fresh = budget(); assert.throws(() => renderTesseractTsv(rows, fresh, controller.signal), /cancelled/); fresh.close();
});

test('independent UTF8 encoder oracle across code-point boundaries (seed 0x715)', () => {
  let state = 0x715;
  const points = [0x20, 0x7e, 0x80, 0x7ff, 0x800, 0xd7ff, 0xe000, 0xffff, 0x10000, 0x10ffff];
  for (let i = 0; i < 32; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    points.push(0x10000 + state % 0x100000);
  }
  const text = String.fromCodePoint(...points);
  const b = budget();
  const result = renderTesseractTsv([...rows.slice(0, 4), { ...rows[4]!, text }], b, signal);
  const expected = new TextEncoder().encode('5\t1\t1\t1\t1\t1\t15\t20\t174\t42\t94.235031\t' + text + '\n');
  assert.deepEqual(result.bytes.subarray(result.bytes.length - expected.length), expected);
  result.dispose(); b.close();
});

test('every budget gate denies output and rolls back live memory', () => {
  for (const resource of ['inputBytes', 'work', 'retainedBytes', 'outputBytes'] as const) {
    const b = createTesseractBudget({ inputBytes: 10000, work: 10000, retainedBytes: 10000, outputBytes: 10000, [resource]: 0 }, signal);
    assert.throws(() => renderTesseractTsv(rows, b, signal));
    assert.equal(b.used('retainedBytes'), 0); assert.equal(b.used('outputBytes'), 0); b.close();
  }
});

test('cancellation during output and disposal after close release invocation ownership', () => {
  let checks = 0;
  const cancelling = { get aborted() { return ++checks > 10; } } as AbortSignal;
  const b = budget();
  assert.throws(() => renderTesseractTsv(rows, b, cancelling), /cancelled/);
  assert.equal(b.used('retainedBytes'), 0); assert.equal(b.used('outputBytes'), 0); b.close();
  const fresh = budget(); const result = renderTesseractTsv(rows, fresh, signal);
  fresh.close(); result.dispose(); result.dispose();
});

test('malformed runtime row carriers return structured errors and release scratch', async () => {
  const { TesseractError } = await import('./index.js');
  for (const carrier of [null, undefined, 1, {}, { ...rows[0]!, level: 6 }]) {
    const b = budget();
    assert.throws(() => renderTesseractTsv([carrier] as unknown as TesseractTsvRow[], b, signal),
      error => error instanceof TesseractError && error.code === 'invalid-argument');
    assert.equal(b.used('retainedBytes'), 0); b.close();
  }
});
