import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { PlaywrightAdapter, PlaywrightPage } from './playwright/adapter.js';
import { createPlaywrightController } from './playwright/controller.js';
import { restoreBrowserProfile, type BrowserProfile } from './playwright/profile.js';
import type { PlaywrightOperationOutcome } from './playwright/recovery.js';

function fixture(failure: 'navigation' | 'startup' | 'allocation') {
  let effects = 0;
  let startups = 0;
  let allocationsFail = failure === 'allocation';
  let checkpointFails = false;
  let receipt: PlaywrightOperationOutcome = { operationId: 'previous', status: 'completed' };
  let requiresRecovery = false;
  let profile: BrowserProfile = {
    state: { cookies: [], origins: [] },
    tabs: ['https://example.test/effect', 'https://example.test/fail'], selected: 0,
    configuration: { initPages: [{ filename: 'startup.js', source: 'sideEffect()' }] },
  };
  const adapter: PlaywrightAdapter = {
    browsers: { chromium: { headed: false } },
    async acquire() {
      if (allocationsFail) throw new Error('injected allocation failure');
      const pages: PlaywrightPage[] = [];
      const context = Object.assign(new EventEmitter(), {
        pages: () => [...pages],
        async newPage() {
          let url = 'about:blank';
          const page: PlaywrightPage = Object.assign(new EventEmitter(), {
            url: () => url,
            async goto(next: string) {
              if (next.endsWith('/fail')) throw new Error('injected navigation failure');
              if (next.endsWith('/effect')) effects++;
              url = next;
            },
            frames: () => [], async title() { return 'synthetic'; },
            async close() {}, async screenshot() { return new Uint8Array(); },
            locator() { throw new Error('unexpected locator'); }, keyboard: { async press() {} },
          });
          pages.push(page);
          return page;
        },
        async close() {},
      });
      return { context, onClosed: () => () => {}, async release() {},
        async executeCode() {
          startups++;
          if (failure === 'startup') throw new Error('injected startup failure');
          return { value: undefined };
        },
      };
    },
  };
  const create = () => createPlaywrightController({ adapter, namedSessionAttachment: true, persistence: {
    resumeAfterIdle: true,
    async list() { return [{ name: 'owned' }]; },
    async restore({ name, signal }) {
      return restoreBrowserProfile({ adapter, profile, name, signal, tabRestoration: 'navigate', recovery: requiresRecovery });
    },
    async checkpoint(session) {
      if (checkpointFails) throw new Error('injected checkpoint failure');
      profile = { state: profile.state, tabs: session.context.pages().map(page => page.url()), selected: 0,
        ...(session.configuration === undefined ? {} : { configuration: session.configuration }),
      };
    },
    async delete() {},
    async inspectRecovery() { return { hasStorage: true, operation: receipt, requiresRecovery }; },
    async recordOperation({ operation }) {
      receipt = operation;
      if (operation.status !== 'running') requiresRecovery = operation.status === 'unknown';
    },
  } });
  return {
    create,
    get state() { return { effects, startups, receipt: receipt.status, requiresRecovery, tabs: profile.tabs }; },
    allowAllocation() { allocationsFail = false; },
    failCheckpoint() { checkpointFails = true; },
  };
}

test('failed checkpoint of a recovered attachment retains uncertainty', async () => {
  const host = fixture('navigation');
  const controller = host.create();
  try {
    await assert.rejects(run(controller, ['attach', 'owned']), /injected navigation failure/);
    host.failCheckpoint();
    await assert.rejects(run(controller, ['attach', 'owned']), /injected checkpoint failure/);
    assert.equal(host.state.receipt, 'unknown');
    assert.equal(host.state.requiresRecovery, true);
    assert.equal(host.state.effects, 1);
  } finally { await controller.dispose(); }
});

async function run(controller: ReturnType<typeof createPlaywrightController>, args: string[]) {
  await controller.run({ args, env: {}, signal: new AbortController().signal, async write() {}, async writeArtifact() {} });
}

for (const command of [['-s=owned', 'snapshot'], ['attach', 'owned']]) {
  for (const failure of ['navigation', 'startup'] as const) {
    for (const restart of [false, true]) {
      test(`${command.join(' ')} preserves failed ${failure} effects across recovery (restart=${restart})`, async () => {
        const host = fixture(failure);
        let controller = host.create();
        try {
          await assert.rejects(run(controller, command), new RegExp(`injected ${failure} failure`));
          const failed = host.state;
          assert.equal(failed.receipt, 'unknown');
          assert.equal(failed.requiresRecovery, true);
          assert.equal(failed.effects, failure === 'navigation' ? 1 : 0);
          assert.equal(failed.startups, 1);
          if (restart) { await controller.dispose(); controller = host.create(); }
          await run(controller, command);
          assert.equal(controller.inspectSessions()[0]?.selectedPage?.url(), 'about:blank');
          assert.equal(controller.inspectSessions()[0]?.context.pages().length, 1);
          assert.equal(host.state.effects, failed.effects);
          assert.equal(host.state.startups, failed.startups);
          // A completed attach must not leave the old effectful URLs for a later owner.
          assert.deepEqual(host.state.tabs, ['about:blank']);
          await controller.dispose();
          controller = host.create();
          await run(controller, ['-s=owned', 'snapshot']);
          assert.equal(host.state.effects, failed.effects);
          assert.equal(host.state.startups, failed.startups);
        } finally { await controller.dispose(); }
      });
    }
  }
  test(`${command.join(' ')} keeps allocation failure harmless`, async () => {
    const host = fixture('allocation');
    const controller = host.create();
    try {
      await assert.rejects(run(controller, command), /injected allocation failure/);
      assert.equal(host.state.receipt, 'completed');
      assert.equal(host.state.requiresRecovery, false);
      assert.equal(host.state.effects, 0);
      assert.equal(host.state.startups, 0);
      assert.deepEqual(host.state.tabs, ['https://example.test/effect', 'https://example.test/fail']);
      host.allowAllocation();
      await assert.rejects(run(controller, command), /injected navigation failure/);
      assert.equal(host.state.effects, 1);
    } finally { await controller.dispose(); }
  });
}
