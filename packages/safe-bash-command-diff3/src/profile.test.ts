import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareDiff3, diff3DefaultLimits, Diff3Error } from './index.js';

test('large interleaved changes merge beyond the former alignment cutoff', () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  const pairs = Array.from({ length: 4200 }, (_, i) => [`a${i}\n`, `b${i}\n`]);
  const base = encode(pairs.map(([a, b]) => a! + b!).join(''));
  const mine = encode(pairs.map(([a, b]) => b! + a!).join(''));
  const invocation = { files: ['mine', 'base', 'yours'], merge: true };
  const result = compareDiff3([mine, base, base], invocation);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout, mine);
  assert.equal(result.stderr.length, 0);
  assert.throws(() => compareDiff3([mine, base, base], invocation, { ...diff3DefaultLimits, work: 1000000 }),
    error => error instanceof Diff3Error && error.code === 'LIMIT');
});
