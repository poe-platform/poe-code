import assert from 'node:assert/strict';
import test from 'node:test';
import { evalSyncCsvstack, evalSyncCsvjoin } from '../../src/commands/csvkit/index.js';
import { evalSyncCsvgrep } from '../../src/commands/csvgrep/index.js';

test('sync csvgrep trims file patterns with Python whitespace semantics', () => {
  const encode = (value: string) => new TextEncoder().encode(value);
  const input = encode('name\nalpha\nbeta\ngamma\n');
  assert.equal(evalSyncCsvgrep(input, ['-c', 'name', '-f', '/patterns'], path =>
    path === '/patterns' ? encode('alpha \t\u00a0\r\nbeta\u001c') : undefined,
  ), 'name\nalpha\nbeta\n');
});

test('sync csvstack honors explicit input delimiters and tab precedence', () => {
  const input = new TextEncoder().encode('a\tb\nx\ty\n');
  assert.equal(evalSyncCsvstack(input, ['-t', '-d', ';']), 'a,b\nx,y\n');
  assert.equal(evalSyncCsvstack(new TextEncoder().encode('a;b\nx;y\n'), ['-d', ';']), 'a,b\nx,y\n');
});

test('sync csvjoin keeps the absent delimiter optional', () => {
  const files = new Map([['left', 'id,left\nitem,a\n'], ['right', 'id,right\nitem,b\n']]);
  assert.equal(evalSyncCsvjoin(undefined, ['left', 'right'], path => {
    const text = files.get(path);
    return text === undefined ? undefined : new TextEncoder().encode(text);
  }), 'id,left,id2,right\nitem,a,item,b\n');
});
