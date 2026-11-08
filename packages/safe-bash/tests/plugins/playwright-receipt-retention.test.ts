import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaywrightController } from '../../src/playwright/index.js';
import type { PlaywrightOperationOutcome } from '../../src/playwright/recovery.js';

test('receipt eviction and expiry with authoritative persistence', async () => {
  let now = 0;
  let acquisitions = 0;
  const receipts = new Map<string, { operation: PlaywrightOperationOutcome; expiresAt: number }>();
  const controller = createPlaywrightController({
    adapter: { browsers: { chromium: { headed: false } }, async acquire() { acquisitions++; throw new Error('unexpected browser acquisition'); } },
    persistence: {
      async restore() { return undefined; }, async checkpoint() {}, async delete() {},
      async inspectRecovery({ name }: { name: string }) {
        const receipt = receipts.get(name);
        return { hasStorage: false, ...(receipt && receipt.expiresAt > now ? { operation: receipt.operation } : {}) };
      },
      async recordOperation({ name, operation }) {
        if (operation.status === 'running') {
          receipts.delete(name);
          receipts.set(name, { operation, expiresAt: now + 24 * 60 * 60 * 1000 });
          if (receipts.size > 16) receipts.delete(receipts.keys().next().value!);
        } else {
          const receipt = receipts.get(name);
          if (receipt?.operation.operationId === operation.operationId) receipt.operation = operation;
        }
      },
    },
  });
  const run = async (name: string, operationId: string) => {
    await assert.rejects(controller.run({ args: [`-s=${name}`, 'snapshot'], operationId, env: {}, signal: new AbortController().signal, async write() {} }));
  };
  try {
    for (let index = 0; index < 17; index++) await run(`missing${index}`, `receipt${index}`);
    assert.equal((await controller.inspectRecovery({ name: 'missing0' })).operation, undefined);
    assert.equal((await controller.inspectRecovery({ name: 'missing16' })).operation?.operationId, 'receipt16');
    for (let index = 0; index < 100; index++) await run('missing16', `repeat${index}`);
    assert.equal((await controller.inspectRecovery({ name: 'missing16' })).operation?.operationId, 'repeat99');
    assert.equal((await controller.inspectRecovery({ name: 'missing1' })).operation?.operationId, 'receipt1');
    receipts.delete('missing16');
    assert.equal((await controller.inspectRecovery({ name: 'missing16' })).operation, undefined);
    now += 24 * 60 * 60 * 1000 + 1;
    assert.equal((await controller.inspectRecovery({ name: 'missing1' })).operation, undefined);
    assert.equal((await controller.inspectRecovery({ name: 'missing16' })).operation, undefined);
    assert.equal(acquisitions, 0);
  } finally { await controller.dispose(); }
});
