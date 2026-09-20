import { setImmediate } from 'node:timers/promises';
import { expect, test, vi } from 'vitest';
import { coldRestore, type Fixture } from './browser-storage-admission.test.worker-cases';

vi.mock('./persistent-playwright.fixture', () => ({ PROFILE_LIMITS: { maxBytes: 2 * 1024 * 1024, maxTabs: 8 } }));

test('cold-owner restore preserves the operation and both cleanup failures after draining every owner', async () => {
  const operationFailure = new Error('restore assertion failed');
  const firstCleanupFailure = new Error('first checkpoint context closed');
  const secondCleanupFailure = new Error('second owner deletion failed');
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const retired: string[] = [];
  let settled = false;
  const outcome = coldRestore(owner => ({
    async run() { throw operationFailure; },
    client: { async dispose() {
      retired.push(owner);
      if (owner === 'cold-owner') throw firstCleanupFailure;
      entered.resolve();
      await finish.promise;
      throw secondCleanupFailure;
    } },
  }) as unknown as Fixture, { origin: '', initial: '', history: '', imported: '' }, 'restore')
    .then(() => undefined, error => error)
    .then(error => { settled = true; return error; });
  await entered.promise;
  await setImmediate();
  const prematureSettlement = settled;
  finish.resolve();
  const error = await outcome;
  expect(prematureSettlement).toBe(false);
  expect(retired).toEqual(['cold-owner', 'cold-other-owner']);
  const leaves = (value: unknown): unknown[] => value instanceof AggregateError ? value.errors.flatMap(leaves) : [value];
  expect(leaves(error)).toEqual([operationFailure, firstCleanupFailure, secondCleanupFailure]);
});
