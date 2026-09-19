import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createSqlTransportProvider } from './sql-transport.js';
import { nativeCell, nativeParameters } from './sql-native.js';

const signal = new AbortController().signal;

test('failed MSSQL transaction construction retains release failure as cooperative cleanup', async () => {
  const construction = new Error('transaction construction failed');
  const release = new Error('native release failed');
  const effects: string[] = [];
  const provider = createSqlTransportProvider({ profile: 'mssql-node-v1', authorize: async () => true,
    driver: {
      acquire: async () => { effects.push('acquire'); return {}; },
      transaction: () => { effects.push('transaction'); throw construction; },
      request: () => { assert.fail('failed transaction cannot create request'); },
      release: async () => { effects.push('release'); throw release; }
    }
  });
  await assert.rejects(provider.connect('mssql://allowed/db', {}, signal), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [construction, release]);
    return true;
  });
  assert.deepEqual(effects, ['acquire', 'transaction', 'release']);
});

test('native exact scalar bindings and unsupported result objects refuse missing codecs', () => {
  const driver = { acquire: async () => ({}), release: async () => {} };
  assert.throws(() => nativeParameters(driver, [{ kind: 'decimal', value: '1.23' }]), /exact scalar binding codec/);
  assert.throws(() => nativeCell(driver, new Date(0), 0), /result scalar codec/);
  const input = new Uint8Array([65]);
  const output = nativeCell(driver, input, 0);
  input[0] = 66;
  assert.deepEqual(output, new Uint8Array([65]));
});
