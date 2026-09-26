import { test } from 'vitest';
import assert from 'node:assert/strict';
import { sqlOptions } from './sql-options.js';
import { CsvkitBlocked } from './errors.js';
import { PythonException } from './diagnostics/index.js';
import reference from '../../../docs/csvkit/sql-scalar-options-reference.json' with { type: 'json' };

for (const item of reference.cases) {
  const blocker = item.raw.includes('\\N{');
  test(`${blocker ? 'explicit SQL qualification blocker' : 'frozen SQL scalar literal'}: ${item.raw}`, () => {
    if (item.kind === 'SyntaxError') {
      assert.throws(() => sqlOptions([['option', item.raw]]), failure => failure instanceof PythonException && failure.exceptionClass === 'SyntaxError' && failure.detail === item.detail);
      return;
    }
    if (blocker) {
      assert.throws(() => sqlOptions([['option', item.raw]]), CsvkitBlocked);
      return;
    }
    const actual = sqlOptions([['option', item.raw]]).option;
    const expected = item.kind === 'int' ? BigInt(item.value as string) : item.negativeZero ? -0 : item.value;
    if (item.kind === 'int') {
      assert.ok(typeof actual === 'number' || typeof actual === 'bigint');
      assert.equal(BigInt(actual), expected);
    } else if (item.kind === 'list') assert.deepEqual(actual, expected);
    else assert.equal(actual, expected);
  });
}

test('SQL options preserve duplicate-key precedence and own prototype-looking keys', () => {
  const options = sqlOptions([['echo', 'False'], ['echo', 'True'], ['__proto__', '"owned"']]);
  assert.equal(options.echo, true);
  assert.equal(options.__proto__, 'owned');
  assert.equal(Object.getPrototypeOf(options), null);
  assert.ok(Object.isFrozen(options));
});
