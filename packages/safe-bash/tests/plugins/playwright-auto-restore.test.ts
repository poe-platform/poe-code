import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createPlaywrightController } from '../../src/playwright/controller.js';
import type { PlaywrightSessionPersistence } from '../../src/playwright/controller.js';
import type { PlaywrightContext, PlaywrightLease, PlaywrightPage } from '../../src/playwright/adapter.js';
import { createSnapshotFrame } from '../helpers/playwright-snapshot.js';

function fixture() {
  const acquisitions: string[] = [];
  const releases: string[] = [];
  const hooks: { goto?: () => Promise<void>; release?: () => void | Promise<void> } = {};
  let restoredPageStateLost = false;
  let disconnect: () => void = () => { throw new Error('no browser'); };
  const saved = new Map<string, { expiresAt?: number; idleTimeoutMs?: number }>();
  let selection: { name: string; selection: string } | undefined;
  function browser(name: string) {
    const events = new EventEmitter();
    disconnect = () => { events.emit('close'); };
    const node = { isConnected: true, tagName: 'BUTTON', textContent: 'Continue', getAttribute: () => null };
    const frame = createSnapshotFrame([{ node,
      native: { async click() { assert.fail('old references must never click'); }, async fill() {}, async dispose() {}, async evaluate(callback, argument) { return callback(node, argument!); } },
    }]);
    const page = Object.assign(new EventEmitter(), {
      async goto() { await hooks.goto?.(); }, url: () => `https://example.test/${name}`,
      frames: () => [frame.frame], async title() { return name; },
      locator() { throw new Error('unexpected locator'); },
      keyboard: { async press() { assert.fail('unexpected key press'); } },
      async screenshot() { return new Uint8Array(); }, async close() {},
    }) satisfies PlaywrightPage;
    const context = Object.assign(new EventEmitter(), {
      pages: () => [page], async newPage() { return page; }, async close() {},
    }) satisfies PlaywrightContext;
    const lease: PlaywrightLease = { context,
      onClosed(listener) { events.on('close', listener); return () => { events.off('close', listener); }; },
      async release() { releases.push(name); await hooks.release?.(); },
    };
    acquisitions.push(name);
    return { lease, selectedPage: page };
  }
  const persistence: PlaywrightSessionPersistence = {
    resumeAfterIdle: true,
    selection: {
      async read() { return selection; }, async write(value) { selection = value; },
    },
    async list() { return [...saved].map(([name, timing]) => ({ name, ...timing })); },
    async restore({ name }) { const timing = saved.get(name); return timing && { ...browser(name), ...timing, ...(restoredPageStateLost ? { livePageStateLost: true as const } : {}) }; },
    async checkpoint(session) { saved.set(session.name, { ...(session.expiresAt === undefined ? {} : { expiresAt: session.expiresAt }), ...(session.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: session.idleTimeoutMs }) }); },
    async close(name) { if (name === undefined) saved.clear(); else saved.delete(name); },
    async delete(name) { saved.delete(name); },
  };
  const create = () => {
    const controller = createPlaywrightController({ namedSessionAttachment: true, persistence,
      adapter: { browsers: { chromium: { headed: false } }, async acquire(request) { return browser(request.session).lease; } },
    });
    const output: string[] = [];
    const run = async (args: string[], signal = new AbortController().signal) => {
      let text = '';
      await controller.run({ args, env: {}, signal,
        async write(value) { text += value; output.push(value); }, async writeArtifact() {},
      });
      return text;
    };
    return { controller, run, output };
  };
  return { create, saved, acquisitions, releases, hooks, disconnect: () => disconnect(), losePageState() { restoredPageStateLost = true; } };
}

test('ordinary commands wake an idle session while explicit close remains closed', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const host = fixture();
  host.saved.set('research', { expiresAt: 1100, idleTimeoutMs: 100 });
  const cli = host.create();
  try {
    await cli.run(['-s=research', 'snapshot']);
    t.mock.timers.setTime(1200);
    await cli.run(['-s=research', 'snapshot']);
    assert.deepEqual(host.acquisitions, ['research', 'research']);
    assert.deepEqual(host.releases, ['research']);
    await cli.run(['-s=research', 'close']);
    await assert.rejects(cli.run(['-s=research', 'snapshot']), /closed/);
    assert.equal(host.acquisitions.length, 2);
  } finally { await cli.controller.dispose(); }
});

test('expired saved profiles remain discoverable and resume on a cold controller', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 2000 });
  const host = fixture();
  host.saved.set('research', { expiresAt: 1100, idleTimeoutMs: 100 });
  const cli = host.create();
  try {
    assert.match(await cli.run(['list']), /research/);
    await cli.run(['-s=research', 'snapshot']);
    assert.equal(cli.controller.inspectSessions()[0]?.expiresAt, 2100);
    assert.deepEqual(host.acquisitions, ['research']);
  } finally { await cli.controller.dispose(); }
});

test('attached session survives controller replacement and detach persists', async () => {
  const host = fixture();
  host.saved.set('research', {});
  const first = host.create();
  await first.run(['attach', 'research']);
  await first.controller.dispose();
  const second = host.create();
  try {
    assert.match(await second.run(['snapshot']), /research/);
    assert.deepEqual(host.acquisitions, ['research', 'research']);
    await second.run(['detach']);
  } finally { await second.controller.dispose(); }
  const third = host.create();
  try { await assert.rejects(third.run(['snapshot']), /closed/); }
  finally { await third.controller.dispose(); }
});


test('an interrupted first navigation keeps the session usable by the next ordinary command', async () => {
  const host = fixture();
  const signal = new AbortController();
  host.hooks.goto = () => new Promise<void>(resolve => {
    host.hooks.release = resolve;
    signal.abort(new Error('command deadline'));
  });
  const cli = host.create();
  try {
    await assert.rejects(cli.run(['-s=research', 'open', 'https://example.test'], signal.signal), /command deadline/);
    delete host.hooks.goto;
    assert.match(await cli.run(['-s=research', 'snapshot']), /research/);
    assert.deepEqual(host.acquisitions, ['research', 'research']);
  } finally { await cli.controller.dispose(); }
});

test('snapshot inspects a restored blank page without requiring an explicit reopen', async () => {
  const host = fixture();
  host.saved.set('research', {});
  host.losePageState();
  const cli = host.create();
  try {
    assert.match(await cli.run(['-s=research', 'snapshot']), /interrupted action was not replayed/);
    await assert.rejects(cli.run(['-s=research', 'press', 'Enter']), /Previous page is unavailable/);
    assert.equal(host.acquisitions.length, 1);
  } finally { await cli.controller.dispose(); }
});

test('restored sessions return a fresh snapshot when an old element reference cannot be used', async () => {
  const host = fixture();
  host.saved.set('research', {});
  host.losePageState();
  const cli = host.create();
  try {
    await cli.run(['-s=research', 'goto', 'https://example.test/research']);
    cli.output.length = 0;
    await assert.rejects(cli.run(['-s=research', 'click', 'e123']), /Ref e123 not found/);
    assert.match(cli.output.join(''), /### Snapshot/);
  } finally { await cli.controller.dispose(); }
});


test('concurrent commands share restoration after a disconnected lease finishes retiring', async () => {
  const host = fixture();
  host.saved.set('research', {});
  const cli = host.create();
  let release!: () => void;
  const retired = new Promise<void>(resolve => { release = resolve; });
  try {
    await cli.run(['-s=research', 'snapshot']);
    host.hooks.release = () => retired;
    host.disconnect();
    const commands = Promise.all([cli.run(['-s=research', 'snapshot']), cli.run(['-s=research', 'snapshot'])]);
    void commands.catch(() => {});
    await nextTurn();
    release();
    await commands;
    assert.deepEqual(host.acquisitions, ['research', 'research']);
  } finally { release(); await cli.controller.dispose(); }
});
