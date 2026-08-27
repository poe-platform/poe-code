import assert from 'node:assert/strict';
import { Client, Capacity } from 'regex-validation-prototype';
export async function run() {
  const client = new Client([{ source: '(a)', flags: 'g' }], new Capacity());
  try {
    const result = await client.batch([{ text: 'a', all: true }]);
    assert.deepEqual(result.hits, [[{ pattern: 0, start: 0, end: 1, captures: ['a', 'a'] }]]);
    await client.dispose();
    assert.equal(client.metrics.created, 1);
    assert.equal(client.metrics.terminated, 1);
    assert.equal(client.metrics.listenersAfter, 0);
    return { pass: true, node: process.version, imported: import.meta.resolve('regex-validation-prototype'), result, metrics: client.metrics, runtimeDependencies: 0 };
  } finally { await client.dispose(); }
}
