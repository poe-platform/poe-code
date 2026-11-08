import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createPlaywrightController } from '../../src/playwright/controller.js';
import type { PlaywrightContext, PlaywrightPage } from '../../src/playwright/adapter.js';
import { createSnapshotFrame } from '../helpers/playwright-snapshot.js';

function fixture(dialogCount = 1) {
  const context = new EventEmitter() as EventEmitter & PlaywrightContext;
  const page = new EventEmitter() as EventEmitter & PlaywrightPage;
  const snapshot = createSnapshotFrame([]);
  let finish: (() => void) | undefined;
  let reject: ((reason: Error) => void) | undefined;
  let pending = false, released = 0, disposedTargets = 0;
  Object.assign(page, {
    async goto() {}, url: () => 'https://example.test', frames: () => [snapshot.frame],
    async title() { if (pending) throw new Error('title blocked by dialog'); return 'Modal test'; },
    locator() { return { async ariaSnapshot() { return ''; }, async elementHandle() { return {
      async evaluate() {}, async fill() {}, async dispose() { disposedTargets++; },
      async click() {
        pending = true;
        try {
          for (let index = 0; index < dialogCount; index++) {
            const operation = new Promise<void>((resolve, fail) => { finish = resolve; reject = fail; });
            context.emit('dialog', { page: () => page, type: () => 'confirm', message: () => `Proceed? ${index + 1}`, defaultValue: () => '',
              async accept() { finish!(); }, async dismiss() { finish!(); },
            });
            await operation;
          }
        } finally { pending = false; }
      },
    }; } }; },
    keyboard: { async press() {} }, async screenshot() { return new Uint8Array(); }, async close() {},
  });
  Object.assign(context, { pages: () => [page], async newPage() { return page; }, async close() {} });
  const controller = createPlaywrightController({ adapter: { browsers: { chromium: { headed: false } }, async acquire() {
    return { context, onClosed: () => () => {}, async release() { released++; reject?.(new Error('browser closed')); } };
  } } });
  async function run(...args: string[]) {
    let output = '';
    await controller.run({ args, env: {}, signal: new AbortController().signal, async write(text) { output += text; }, async writeArtifact() {} });
    return output;
  }
  return { run, controller, timeout() { const error = new Error('click timed out waiting for dialog'); error.name = 'TimeoutError'; reject?.(error); },
    get pending() { return pending; }, get released() { return released; }, get disposedTargets() { return disposedTargets; } };
}

test('click yields its dialog across commands and retains the native action and target until accepted', async () => {
  const f = fixture();
  try {
    await f.run('open');
    let completed = false;
    const click = f.run('click', '#confirm').then(output => { completed = true; return output; });
    void click.catch(() => {});
    await setImmediate();
    assert.equal(completed, true, 'dialog-opening command must yield instead of waiting for its own followup');
    assert.match(await click, /Modal state[\s\S]*Proceed\?[\s\S]*dialog-accept or dialog-dismiss/);
    assert.equal(f.pending, true);
    assert.equal(f.disposedTargets, 0);
    await f.run('dialog-accept');
    assert.equal(f.pending, false);
    assert.equal(f.disposedTargets, 1);
    assert.equal(f.released, 0);
    assert.match(await f.run('snapshot'), /Page URL/);
  } finally { await f.controller.dispose(); }
});

test('close retires a suspended modal action without waiting for another command', async () => {
  const f = fixture();
  try {
    await f.run('open');
    const click = f.run('click', '#confirm');
    void click.catch(() => {});
    await setImmediate();
    await f.controller.dispose();
    await click.catch(() => {});
    assert.equal(f.released, 1);
    assert.equal(f.pending, false);
    assert.equal(f.disposedTargets, 1);
  } finally { await f.controller.dispose(); }
});

test('unrelated actions preserve an existing dialog and snapshot reports its modal state', async () => {
  const f = fixture();
  try {
    await f.run('open'); await f.run('click', '#confirm');
    await assert.rejects(f.run('click', '#other'), /does not handle the modal state/);
    assert.equal(f.released, 0);
    assert.equal(f.pending, true);
    assert.match(await f.run('snapshot'), /Modal state/);
    await f.run('dialog-dismiss');
    assert.equal(f.pending, false);
    await f.run('close');
    assert.equal(f.released, 1);
  } finally { await f.controller.dispose(); }
});

test('a followup dialog produced by the same native action remains available for the next command', async () => {
  const f = fixture(2);
  try {
    await f.run('open');
    assert.match(await f.run('click', '#confirm'), /Proceed\? 1/);
    const accepted = JSON.parse(await f.run('--json', 'dialog-accept'));
    assert.match(accepted['modal state'], /Proceed\? 2/);
    assert.equal(f.pending, true);
    assert.equal(f.disposedTargets, 0);
    await f.run('dialog-dismiss');
    assert.equal(f.pending, false);
    assert.equal(f.disposedTargets, 1);
  } finally { await f.controller.dispose(); }
});

test('an unanswered dialog survives its already-reported native action timeout', async () => {
  const f = fixture();
  try {
    await f.run('open'); await f.run('click', '#confirm');
    f.timeout();
    await setImmediate();
    assert.equal(f.released, 0);
    assert.equal(f.disposedTargets, 1);
    assert.match(await f.run('snapshot'), /Proceed/);
    await f.run('dialog-accept');
    assert.match(await f.run('snapshot'), /Page URL/);
  } finally { await f.controller.dispose(); }
});
