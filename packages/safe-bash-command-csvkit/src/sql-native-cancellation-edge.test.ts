import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { createSqlTransportProvider } from './sql-transport.js';

test('MSSQL throwing interruption does not escape the abort listener or skip resource release', async () => {
  const controller = new AbortController(), effects: string[] = [];
  const reason = new Error('caller abort'), interruption = new Error('request already completed');
  let listener: EventListener | undefined;
  let admitted!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { admitted = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const provider = createSqlTransportProvider({ profile: 'mssql-node-v1', authorize: async () => true,
    driver: { acquire: async () => ({}), release: async () => { effects.push('release'); },
      transaction: () => ({ begin: async () => {}, commit: async () => {}, rollback: async () => { effects.push('rollback'); } }),
      request: () => {
        const request = { arrayRowMode: false, input() { return request; },
          query: async () => { admitted(); await pending; return {}; },
          cancel: () => { effects.push('cancel'); throw interruption; } };
        return request;
      }
    }
  });
  const session = await provider.connect('mssql://allowed/db', {}, controller.signal);
  // Invoke the captured listener directly so an escaping exception is an ordinary
  // assertion failure, rather than Node's asynchronous uncaught-exception event.
  const capture = vi.spyOn(controller.signal, 'addEventListener').mockImplementation((type, callback) => {
    if (type === 'abort' && typeof callback === 'function') listener = callback;
  });
  const querying = session.query('select 1', [], {}, controller.signal);
  await started;
  controller.abort(reason);
  try {
    assert.ok(listener);
    assert.doesNotThrow(() => listener!.call(controller.signal, new Event('abort')));
  } finally {
    finish();
    const result = await querying;
    await result.close();
    capture.mockRestore();
    await session.rollback(); await session.close();
  }
  assert.deepEqual(effects, ['cancel', 'rollback', 'release']);
});
