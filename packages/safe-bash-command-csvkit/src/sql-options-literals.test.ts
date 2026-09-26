import { test } from 'vitest';
import assert from 'node:assert/strict';
import { sqlOptions, SqlTuple } from './sql-options.js';
import { CsvkitBlocked } from './errors.js';
import { PythonException } from './diagnostics/index.js';
import reference from '../../../docs/csvkit/sql-container-options-reference.json' with { type: 'json' };

for (const item of reference.cases) {
  if (item.kind === 'raw') test(`frozen parse_list ValueError: ${item.raw}`, () => assert.equal(sqlOptions([['option', item.raw]]).option, item.value));
  if (item.kind === 'SyntaxError') test(`frozen SyntaxError diagnostic: ${item.raw}`, () => assert.throws(() => sqlOptions([['option', item.raw]]), failure => failure instanceof PythonException && failure.detail === item.value));
  if (item.kind === 'TypeError') test(`frozen ${item.kind} diagnostic: ${item.raw}`, () => assert.throws(() => sqlOptions([['option', item.raw]]), failure => failure instanceof PythonException && failure.exceptionClass === item.kind && failure.detail === item.value));
}


test('Python tuples preserve their container identity, grouping and nesting', () => {
  const values = sqlOptions([['empty', '()'], ['single', '(1,)'], ['group', '(1)'], ['tuple', "(True, [None], {'a': (2, 3)},)"]]);
  assert.ok(values.empty instanceof SqlTuple);
  assert.deepEqual(Array.from(values.single as SqlTuple), [1]);
  assert.equal(values.group, 1);
  assert.ok((values.tuple as SqlTuple)[2] && ((values.tuple as SqlTuple)[2] as Record<string, unknown>).a instanceof SqlTuple);
});
test('Python sets and non-string dictionary keys remain typed values', () => {
  const values = sqlOptions([['set', '{1, 2, 1, True}'], ['empty', 'set()'], ['dict', "{1: 'first', True: 'last', None: 3}"]]);
  assert.deepEqual(values.set, new Set([1, 2]));
  assert.deepEqual(values.empty, new Set());
  assert.deepEqual(values.dict, new Map<unknown, unknown>([[1, 'last'], [null, 3]]));
});
test('literal_eval ValueError retains original input without executing expressions', () => {
  for (const raw of ['foo/bar', 'call()', '[unbound]', '{name: 1}', '1 + 2', 'False or True']) {
    assert.equal(sqlOptions([['value', raw]]).value, raw);
  }
});
test('unhashable container diagnostics remain Python TypeErrors', () => {
  for (const raw of ['{[]: 1}', '{[1]}']) assert.throws(() => sqlOptions([['value', raw]]), failure => failure instanceof PythonException && failure.exceptionClass === 'TypeError');
});

test('Python integer set keys preserve precision beyond the JS safe integer range', () => {
  const actual = sqlOptions([['set', '{9007199254740992, 9007199254740993}']]).set;
  assert.deepEqual(actual, new Set([9007199254740992n, 9007199254740993n]));
});

test('SQL literal parsing consumes an injected work budget before quadratic set/dictionary comparisons', () => {
  for (const raw of ['{' + Array.from({ length: 80 }, (_, index) => index).join(',') + '}', '{' + Array.from({ length: 80 }, (_, index) => `${index}: None`).join(',') + '}']) {
    let work = 0;
    const failure = new Error('owned work limit');
    assert.throws(() => sqlOptions([['value', raw]], () => { if (++work > 200) throw failure; }), error => error === failure);
    assert.equal(work, 201);
  }
});
test('direct SQL literal exports bound comparison work without a caller callback', () => {
  const raw = '{' + Array.from({ length: 500 }, (_, index) => index).join(',') + '}';
  assert.throws(() => sqlOptions([['value', raw]]), error => error instanceof CsvkitBlocked && error.message.includes('work budget exceeded'));
});
