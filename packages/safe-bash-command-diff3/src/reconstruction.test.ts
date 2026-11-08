import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeDiff3, type Diff3Edit, type Diff3Line } from './index.js';

const limits = { inputBytes: 100000, retainedBytes: 200000, tokens: 10000, graphCells: 100000, work: 2000000 };

test('both edit streams reconstruct deterministic byte triples including missing LF', () => {
  let seed = 0xd1ff3003;
  const choice = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 16; };
  const alphabet = [[97], [98], [99], [46], [], [255], [254]];
  const operand = () => {
    const bytes: number[] = [];
    const count = choice() % 10;
    for (let line = 0; line < count; line++) bytes.push(...alphabet[choice() % alphabet.length]!, 10);
    if (choice() % 2 && bytes.length) bytes.pop();
    return Uint8Array.from(bytes);
  };
  const concatenate = (lines: readonly Diff3Line[]) => lines.flatMap(line => Array.from(line.bytes));
  const reconstruct = (base: readonly Diff3Line[], variant: readonly Diff3Line[], edits: readonly Diff3Edit[]) => {
    const bytes: number[] = [];
    let cursor = 0, variantCursor = 0;
    for (const edit of edits) {
      assert.ok(edit.base.start >= cursor && edit.base.end >= edit.base.start && edit.base.end <= base.length);
      assert.ok(edit.variant.start >= variantCursor && edit.variant.end >= edit.variant.start && edit.variant.end <= variant.length);
      assert.deepEqual(concatenate(base.slice(cursor, edit.base.start)), concatenate(variant.slice(variantCursor, edit.variant.start)));
      bytes.push(...concatenate(base.slice(cursor, edit.base.start)), ...concatenate(variant.slice(edit.variant.start, edit.variant.end)));
      cursor = edit.base.end; variantCursor = edit.variant.end;
    }
    assert.deepEqual(concatenate(base.slice(cursor)), concatenate(variant.slice(variantCursor)));
    return Uint8Array.from([...bytes, ...concatenate(base.slice(cursor))]);
  };
  for (let sample = 0; sample < 64; sample++) {
    const left = operand(), base = operand(), right = operand();
    const result = analyzeDiff3({ base, left, right }, limits);
    for (const file of ['base', 'left', 'right'] as const) {
      const original = { base, left, right }[file];
      assert.deepEqual(Uint8Array.from(concatenate(result.files[file])), original, `sample ${sample}: ${file}`);
      for (const line of result.files[file]) {
        assert.ok(line.bytes.length > 0);
        assert.equal(line.terminated, line.bytes[line.bytes.length - 1] === 10);
      }
    }
    assert.deepEqual(reconstruct(result.files.base, result.files.left, result.leftEdits), left, `sample ${sample}: left`);
    assert.deepEqual(reconstruct(result.files.base, result.files.right, result.rightEdits), right, `sample ${sample}: right`);
    const snapshot = concatenate(result.files.base);
    base.fill(0); left.fill(0); right.fill(0);
    assert.deepEqual(concatenate(result.files.base), snapshot);
  }
});
