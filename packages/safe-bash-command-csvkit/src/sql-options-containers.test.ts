import { test } from 'vitest';
import assert from 'node:assert/strict';
import { sqlOptions } from './sql-options.js';

test('SQL engine options parse nested Python list and string-key dictionary literals', () => {
  const actual = sqlOptions([['connect_args', "{'timeout': 3, 'uri': True, 'nested': [None, 'owned', 0x10,],}"], ['list', '[1, 2, False]']]);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), { connect_args: { timeout: 3, uri: true, nested: [null, 'owned', 16] }, list: [1, 2, false] });
});
test('SQL containers preserve duplicate dictionary precedence and prototype-looking keys', () => {
  const actual = sqlOptions([['args', "{'__proto__': {'value': True}, 'a': 1, 'a': 2}"]]).args as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(actual), null); assert.equal(actual.a, 2);
  assert.deepEqual({ ...actual.__proto__ as object }, { value: true });
});
