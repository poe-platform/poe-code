import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createPlaywrightController, type PlaywrightAdapter, type PlaywrightPage } from '../../src/playwright/index.js';

function fixture() {
  const contexts: { pages: PlaywrightPage[]; events: EventEmitter; popup(notify?: boolean): PlaywrightPage; releases: number }[] = [];
  const adapter: PlaywrightAdapter = {
    browsers: { chromium: { headed: false } },
    async acquire() {
      const context = {
        pages: [] as PlaywrightPage[], events: new EventEmitter(), releases: 0,
        popup(notify = true) {
          const page = { goto: async () => {}, url: () => 'about:blank', on() {}, off() {},
            async close() { context.pages.splice(context.pages.indexOf(page), 1); },
          } as unknown as PlaywrightPage;
          context.pages.push(page);
          if (notify) context.events.emit('page', page);
          return page;
        },
      };
      contexts.push(context);
      return {
        context: { newPage: async () => context.popup(), pages: () => [...context.pages], close: async () => {},
          on: context.events.on.bind(context.events), off: context.events.off.bind(context.events) },
        onClosed: () => () => {},
        async release() { context.releases++; context.pages.length = 0; },
      };
    },
  };
  const controller = createPlaywrightController({ adapter, limits: { maxTabs: 2, maxSessions: 2 } });
  const run = async (args: string[]) => {
    let output = '';
    await controller.run({ args, env: {}, signal: new AbortController().signal, write: async text => { output += text; } });
    return output;
  };
  return { controller, contexts, run };
}

test('page-created tabs respect exact capacity and permit replacement after a tab closes', async () => {
  const current = fixture();
  try {
    await current.run(['open']);
    const context = current.contexts[0]!;
    const popup = context.popup();
    assert.equal(await current.run(['tab-list']), '### Result\n- 0: (current) [](about:blank)\n- 1: [](about:blank)\n');
    assert.equal(context.releases, 0);
    await popup.close();
    context.popup();
    assert.equal(await current.run(['tab-list']), '### Result\n- 0: (current) [](about:blank)\n- 1: [](about:blank)\n');
    assert.equal(context.releases, 0);
  } finally { await current.controller.dispose(); }
});

test('delayed popup overflow retires only its session between commands and permits alias reuse', async () => {
  const current = fixture();
  try {
    await current.run(['-s=victim', 'open']);
    await current.run(['-s=spare', 'open']);
    const victim = current.contexts[0]!;
    victim.popup();
    victim.popup();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(victim.releases, 1);
    assert.equal(victim.pages.length, 0);
    assert.equal(victim.events.listenerCount('page'), 0);
    assert.equal(current.contexts[1]!.releases, 0);
    assert.equal(await current.run(['-s=spare', 'tab-list']), '### Result\n- 0: (current) [](about:blank)\n');
    await assert.rejects(current.run(['-s=victim', 'tab-list']), /closed|tab limit/i);
    await current.run(['-s=victim', 'open']);
    victim.events.emit('page');
    assert.equal(current.contexts[2]!.releases, 0);
    assert.equal(await current.run(['-s=victim', 'tab-list']), '### Result\n- 0: (current) [](about:blank)\n');
  } finally { await current.controller.dispose(); }
});

test('command preflight also rejects excess pages when a host omits the notification', async () => {
  const current = fixture();
  try {
    await current.run(['open']);
    current.contexts[0]!.popup(false);
    current.contexts[0]!.popup(false);
    await assert.rejects(current.run(['tab-list']), /tab limit/i);
    assert.equal(current.contexts[0]!.releases, 1);
  } finally { await current.controller.dispose(); }
});
