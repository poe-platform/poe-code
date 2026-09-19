import { test } from 'vitest';
import assert from 'node:assert/strict';
import { sqlOptions, SqlTuple } from './sql-options.js';

test('frozen parse_list concatenates adjacent quoted strings without evaluating expressions', () => {
  for (const [raw, expected] of [
    ["'hello' ' world'", 'hello world'],
    ["u'hello' r'\\n'", 'hello\\n'],
    ["r'a' u'b' 'c'", 'abc'],
    ["'a' + 'b'", "'a' + 'b'"],
  ]) assert.equal(sqlOptions([['value', raw]]).value, expected);
});

test('frozen adjacent strings concatenate in lists, tuple values and dictionary keys', () => {
  const values = sqlOptions([
    ['list', "['a' 'b', ('c' 'd',)]"],
    ['dictionary', "{'x' 'y': 'a' 'b'}"],
    ['comment', "('a' #comment\n'b')"],
  ]);
  const list = values.list as unknown[];
  assert.equal(list[0], 'ab');
  assert.ok(list[1] instanceof SqlTuple);
  assert.deepEqual(Array.from(list[1]), ['cd']);
  assert.deepEqual({ ...values.dictionary as object }, { xy: 'ab' });
  assert.equal(values.comment, 'ab');
});
