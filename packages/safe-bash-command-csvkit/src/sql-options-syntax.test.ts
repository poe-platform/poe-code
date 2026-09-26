import { test } from 'vitest';
import assert from 'node:assert/strict';
import { sqlOptions } from './sql-options.js';
import { diagnosticReport, PythonException } from './diagnostics/index.js';
import reference from '../../../docs/csvkit/sql-syntax-options-reference.json' with { type: 'json' };

for (const [index, item] of reference.cases.entries()) {
  if (item.status !== 1) continue;
  test(`frozen CLI SQL syntax exception ${index}: ${item.command} ${item.argv[2]}`, () => {
    assert.equal(item.stdout, '');
    assert.throws(() => sqlOptions([['echo', item.raw]]), failure => {
      assert.ok(failure instanceof PythonException);
      assert.equal(failure.exceptionClass, item.kind);
      assert.equal(failure.detail, item.detail);
      assert.deepEqual(diagnosticReport(failure, false, 'utf-8'), { status: item.status, stderr: item.stderr });
      return true;
    });
  });
}
