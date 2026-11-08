import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaywrightController, type PlaywrightAdapter, type PlaywrightLease, type PlaywrightPage } from '../src/index.js';

test('capacity preflight remains valid when a closed session is reopened concurrently with a new session', async () => {
  const acquired: string[] = [];
  const page = { goto: async () => {} } as unknown as PlaywrightPage;
  const adapter: PlaywrightAdapter = {
    browsers: { chromium: { headed: false } },
    async acquire(options) {
      acquired.push(options.session);
      return {
        context: { newPage: async () => page, pages: () => [page], close: async () => {}, on() {}, off() {} },
        onClosed: () => () => {},
        release: async () => {},
      } satisfies PlaywrightLease;
    },
  };
  const controller = createPlaywrightController({ adapter, limits: { maxSessions: 1 } });
  const run = (args: string[]) => controller.run({ args, env: {}, signal: new AbortController().signal, write: async () => {} });
  await run(['--session=a', 'open']);
  await run(['--session=a', 'close']);
  const results = await Promise.allSettled([run(['--session=a', 'open']), run(['--session=b', 'open'])]);
  await controller.dispose();
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(acquired.length, 2);
});
