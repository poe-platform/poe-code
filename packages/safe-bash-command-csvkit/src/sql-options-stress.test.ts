import { test } from 'vitest';
import assert from 'node:assert/strict';
import { sqlOptions } from './sql-options.js';
import { PythonException } from './diagnostics/index.js';
import reference from '../../../docs/csvkit/sql-scalar-stress-reference.json' with { type: 'json' };

for (const item of reference.cases) test(`independent SQL scalar ${item.kind === 'SyntaxError' ? 'native diagnostic' : 'native differential'}: ${JSON.stringify(item.raw)}`, () => {
  if (item.kind === 'SyntaxError') {
    assert.throws(() => sqlOptions([['option', item.raw]]), failure => failure instanceof PythonException && failure.exceptionClass === 'SyntaxError' && failure.detail === item.diagnostic);
    return;
  }
  const value = sqlOptions([['option', item.raw]]).option;
  if (item.kind === 'int') {
    assert.ok(typeof value === 'number' || typeof value === 'bigint');
    assert.equal(BigInt(value), BigInt(item.value!));
  } else assert.equal(value, item.negativeZero ? -0 : item.value);
});
