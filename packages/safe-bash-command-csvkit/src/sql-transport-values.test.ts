import { test } from 'vitest';
import assert from 'node:assert/strict';
import { sqlTransportProfiles } from './sql-transports.js';

for (const name of ['postgresql-positional-v1', 'postgresql-pg-cursor-v1']) test(`${name}: PostgreSQL interval binds exact signed microseconds`, () => {
  const profile = sqlTransportProfiles.find(item => item.name === name)!;
  assert.equal(profile.bindValue({ kind: 'timedelta', microseconds: -1n }), '-1 microseconds');
  assert.equal(profile.bindValue({ kind: 'timedelta', microseconds: 864000000001n }), '864000000001 microseconds');
  const decimal = { kind: 'decimal' as const, value: '12345678901234567890.123456' };
  assert.deepEqual(profile.bindValue(decimal), name === 'postgresql-positional-v1' ? decimal.value : decimal);
  assert.equal(profile.bindValue(true), true);
});
for (const name of ['mysql-positional-v1', 'mysql-mysql2-v1', 'mariadb-positional-v1', 'mariadb-node-v1', 'mssql-named-v1', 'mssql-node-v1']) test(`${name}: emulated Interval binds epoch date with six microseconds`, () => {
  const profile = sqlTransportProfiles.find(item => item.name === name)!;
  assert.equal(profile.bindValue({ kind: 'timedelta', microseconds: -1n }), '1969-12-31 23:59:59.999999');
  assert.equal(profile.bindValue({ kind: 'timedelta', microseconds: 864000000001n }), '1970-01-11 00:00:00.000001');
  assert.equal(profile.bindValue(true), 1);
});
test('Oracle native date/datetime/interval binds preserve semantic types for the explicit exact driver codec', () => {
  const profile = sqlTransportProfiles.find(item => item.name === 'oracle-oracledb-v1')!;
  for (const value of [{ kind: 'date', value: '2026-09-18' }, { kind: 'datetime', value: '2026-09-18T00:00:00.000001+00:00' }, { kind: 'timedelta', microseconds: 1n }] as const) assert.deepEqual(profile.bindValue(value), value);
});

for (const name of ['postgresql-pg-cursor-v1', 'mysql-mysql2-v1', 'mariadb-node-v1', 'mssql-node-v1']) test(`${name}: native temporal bindings preserve timezone and sub-millisecond semantics for explicit codecs`, () => {
  const profile = sqlTransportProfiles.find(item => item.name === name)!;
  const value = { kind: 'datetime' as const, value: '2026-09-18T00:00:00.000001+05:00' };
  assert.deepEqual(profile.bindValue(value), value);
});

test('MSSQL native DATE bind follows the frozen pyodbc midnight datetime processor', () => {
  const profile = sqlTransportProfiles.find(item => item.name === 'mssql-node-v1')!;
  assert.deepEqual(profile.bindValue({ kind: 'date', value: '2026-09-18' }), { kind: 'datetime', value: '2026-09-18T00:00:00' });
});

for (const name of ['postgresql-pg-cursor-v1', 'mysql-mysql2-v1', 'mariadb-node-v1', 'mssql-node-v1', 'oracle-oracledb-v1']) test(`${name}: native codecs distinguish decimal and integral float records from text`, () => {
  const profile = sqlTransportProfiles.find(item => item.name === name)!;
  for (const value of [{ kind: 'decimal', value: '1.230000' }, { kind: 'float', value: '1.0' }] as const) {
    assert.deepEqual(profile.bindValue(value), value);
    assert.equal(profile.bindValue(value.value), value.value);
  }
});
