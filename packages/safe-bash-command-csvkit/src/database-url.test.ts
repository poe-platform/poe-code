import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseDatabaseUrl, resolveDatabaseProvider } from './database-url.js';
import { diagnosticReport, PythonException } from './diagnostics/index.js';
import { CsvkitBlocked } from './errors.js';
import reference from '../../../docs/csvkit/sql-url-reference.json' with { type: 'json' };

for (const item of reference.cases) test(`SQLAlchemy frozen URL: ${JSON.stringify(item.raw)}`, () => {
  if ('error' in item) {
    assert.throws(() => parseDatabaseUrl(item.raw), error => error instanceof PythonException && error.exceptionClass === item.error && error.detail === item.detail);
  } else {
    const { raw, dialect, driver, ...actual } = parseDatabaseUrl(item.raw);
    assert.equal(raw, item.raw);
    assert.equal(dialect, item.url.drivername.split('+')[0]);
    assert.equal(driver, item.url.drivername.includes('+') ? item.url.drivername.split('+')[1] : null);
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), item.url);
    assert.ok(Object.isFrozen(actual.query));
  }
});

for (const item of reference.cli) test(`frozen unavailable driver diagnostic: ${item.raw}`, () => {
  try { resolveDatabaseProvider(item.raw, []); assert.fail('must refuse unavailable driver'); }
  catch (error) {
    assert.ok(error instanceof PythonException);
    assert.deepEqual(diagnosticReport(error, false, 'utf-8'), { status: item.status, stderr: item.stderr });
  }
});

test('an explicitly injected custom provider resolves without inventing or loading a host driver', () => {
  const provider = { schemes: ['custom+owned'], profile: 'trusted-test', connect: async () => { assert.fail('resolution must not connect'); } };
  assert.equal(resolveDatabaseProvider('custom+owned://host/db', [provider]).provider, provider);
});

test('unqualified Unicode driver names and excessive port diagnostics are explicit blockers', () => {
  assert.throws(() => parseDatabaseUrl('díalect://host/db'), CsvkitBlocked);
  assert.throws(() => parseDatabaseUrl('postgresql://host:' + '1'.repeat(4301) + '/db'), CsvkitBlocked);
});
