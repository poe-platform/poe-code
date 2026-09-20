import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createPlaywrightAdapter, type PlaywrightBrowser, type PlaywrightContext, type PlaywrightPage } from '../../src/playwright/adapter.js';
import { createPlaywrightController } from '../../src/playwright/controller.js';

const targetClosedMessage = 'Target page, context or browser has been closed';
type Evidence = 'context-close' | 'browser-disconnected' | 'browser-state' | 'none' | 'page-close';
type Timing = 'before-close' | 'during-close' | 'during-host-release' | 'after-host-release';
type Failure = { error: unknown };

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

function fixture() {
  const browserEvents = new EventEmitter();
  const contextEvents = new EventEmitter();
  const pageEvents = new EventEmitter();
  const closeStarted = deferred();
  const closeFinished = deferred();
  const hostStarted = deferred();
  const hostFinished = deferred();
  const calls: string[] = [];
  let connected = true;
  let afterHostRelease: (() => void) | undefined;
  void hostFinished.promise.then(() => {
    calls.push('resource.settled');
    afterHostRelease?.();
  }, () => {
    calls.push('resource.settled');
    afterHostRelease?.();
  });
  const page = Object.assign(pageEvents, {
    goto: async () => {},
    url: () => 'about:blank',
    locator: () => ({ click: async () => {}, fill: async () => {}, ariaSnapshot: async () => '' }),
    keyboard: { press: async () => {} },
    screenshot: async () => new Uint8Array(),
    close: async () => { pageEvents.emit('close'); },
  }) satisfies PlaywrightPage;
  const pages: PlaywrightPage[] = [];
  const context = Object.assign(contextEvents, {
    newPage: async () => { pages.push(page); return page; },
    pages: () => [...pages],
    close: () => {
      calls.push('context.close');
      closeStarted.resolve();
      return closeFinished.promise;
    },
  }) satisfies PlaywrightContext;
  const browser = Object.assign(browserEvents, {
    isConnected: () => connected,
    newContext: async () => context,
  }) satisfies PlaywrightBrowser;
  const adapter = createPlaywrightAdapter({ chromium: {
    acquireBrowser: async () => ({
      browser,
      release: () => {
        calls.push('resource.release');
        hostStarted.resolve();
        return hostFinished.promise;
      },
    }),
  } });
  function confirm(evidence: Evidence) {
    if (evidence === 'none') return;
    calls.push(evidence);
    if (evidence === 'context-close') contextEvents.emit('close');
    if (evidence === 'page-close') pageEvents.emit('close');
    if (evidence === 'browser-disconnected' || evidence === 'browser-state') connected = false;
    if (evidence === 'browser-disconnected') browserEvents.emit('disconnected');
  }
  return {
    adapter, browser, context, page, calls, closeStarted, closeFinished, hostStarted, hostFinished, confirm,
    confirmAfterHostRelease(evidence: Evidence) { afterHostRelease = () => confirm(evidence); },
  };
}

async function retire(options: {
  boundary: 'lease' | 'controller';
  evidence: Evidence;
  timing: Timing;
  closeFailure?: Failure;
  hostFailure?: Failure;
  expectedErrors: unknown[];
}) {
  const state = fixture();
  const controller = createPlaywrightController({ adapter: state.adapter });
  let release: () => Promise<void>;
  let notifications = 0;
  let reentrant: Promise<void> | undefined;
  const signal = new AbortController().signal;
  if (options.boundary === 'lease') {
    const lease = await state.adapter.acquire({ acquisitionId: 'close-race', session: 'victim', browser: 'chromium', headless: true, signal });
    release = lease.release;
    lease.onClosed(() => { notifications++; reentrant = lease.release(); });
  } else {
    await controller.run({ args: ['open'], env: {}, signal, write: async () => {} });
    release = controller.dispose;
  }
  if (options.timing === 'before-close') state.confirm(options.evidence);
  const completion = release();
  const outcome = Promise.allSettled([completion]);
  let settled = false;
  void outcome.then(() => { settled = true; });
  assert.equal(release(), completion);
  await state.closeStarted.promise;
  assert.equal(settled, false);
  assert.equal(state.calls.includes('resource.release'), false);
  if (options.timing === 'during-close') state.confirm(options.evidence);
  if (options.closeFailure) state.closeFinished.reject(options.closeFailure.error);
  else state.closeFinished.resolve();
  await state.hostStarted.promise;
  assert.equal(settled, false);
  if (options.timing === 'during-host-release') state.confirm(options.evidence);
  if (options.timing === 'after-host-release') state.confirmAfterHostRelease(options.evidence);
  if (options.hostFailure) state.hostFinished.reject(options.hostFailure.error);
  else state.hostFinished.resolve();
  const [result] = await outcome;
  assert.ok(result);
  assert.equal(release(), completion);
  assert.equal(state.calls.filter(call => call === 'context.close').length, 1);
  assert.equal(state.calls.filter(call => call === 'resource.release').length, 1);
  assert.ok(state.calls.indexOf('context.close') < state.calls.indexOf('resource.release'));
  assert.ok(state.calls.includes('resource.settled'));
  if (options.evidence !== 'none' && options.timing === 'after-host-release') {
    assert.ok(state.calls.indexOf('resource.settled') < state.calls.indexOf(options.evidence));
  }
  assert.equal(state.context.listenerCount('close'), 0);
  assert.equal(state.context.listenerCount('page'), 0);
  assert.equal(state.browser.listenerCount('disconnected'), 0);
  assert.equal(state.page.listenerCount('close'), 0);
  if (options.boundary === 'lease') {
    assert.equal(notifications, 1);
    assert.equal(reentrant, completion);
  }
  state.confirm('context-close');
  state.confirm('browser-disconnected');
  assert.equal(release(), completion);
  const [repeated] = await Promise.allSettled([release()]);
  assert.equal(repeated?.status, result.status);
  if (result.status === 'rejected' && repeated?.status === 'rejected') assert.equal(repeated.reason, result.reason);
  if (options.boundary === 'lease') assert.equal(notifications, 1);
  if (options.expectedErrors.length === 0) {
    assert.equal(result.status, 'fulfilled', 'confirmed target closure must not reject completed retirement');
    return;
  }
  assert.equal(result.status, 'rejected');
  if (result.status !== 'rejected') return;
  let reason: unknown = result.reason;
  if (options.boundary === 'controller') {
    assert.ok(reason instanceof AggregateError);
    assert.equal(reason.message, 'Playwright disposal failed');
    assert.equal(reason.errors.length, 1);
    reason = reason.errors[0];
  }
  if (options.expectedErrors.length === 1) {
    assert.equal(reason, options.expectedErrors[0]);
  } else {
    assert.ok(reason instanceof AggregateError);
    assert.equal(reason.message, 'Playwright lease release failed');
    assert.equal(reason.errors.length, options.expectedErrors.length);
    for (const [index, expected] of options.expectedErrors.entries()) assert.equal(reason.errors[index], expected);
  }
}

for (const boundary of ['lease', 'controller'] as const) {
  for (const evidence of ['context-close', 'browser-disconnected', 'browser-state'] as const) {
    for (const timing of ['before-close', 'during-close', 'during-host-release', 'after-host-release'] as const) {
      for (const hostFails of [false, true]) {
        test(`${boundary}: confirmed ${evidence} ${timing} discards only target-closed; host ${hostFails ? 'fails' : 'succeeds'}`, { timeout: 1000 }, async () => {
          const closeError = new Error(`browserContext.close: ${targetClosedMessage}`);
          const hostError = new Error('host release failed');
          await retire({ boundary, evidence, timing, closeFailure: { error: closeError },
            ...(hostFails ? { hostFailure: { error: hostError } } : {}),
            expectedErrors: hostFails ? [hostError] : [],
          });
        });
      }
    }
  }
}

for (const named of [false, true]) {
  for (const evidence of ['context-close', 'none', 'page-close'] as const) {
    test(`lease: ${named ? 'named TargetClosedError' : 'plain target-closed Error'} requires context/browser evidence, not ${evidence}`, { timeout: 1000 }, async () => {
      const closeError = new Error(targetClosedMessage);
      if (named) closeError.name = 'TargetClosedError';
      await retire({ boundary: 'lease', evidence, timing: 'during-close', closeFailure: { error: closeError },
        expectedErrors: evidence === 'context-close' ? [] : [closeError],
      });
    });
  }
}

const genuineFailures: { name: string; create: () => unknown }[] = [
  { name: 'genuine close failure', create: () => new Error('context close failed') },
  { name: 'matching substring', create: () => new Error(`cleanup failed while logging: ${targetClosedMessage}`) },
  { name: 'matching prefix plus unrelated suffix', create: () => new Error(`browserContext.close: ${targetClosedMessage}; storage flush failed`) },
  { name: 'timeout with matching text', create: () => Object.assign(new Error(targetClosedMessage), { name: 'TimeoutError' }) },
  { name: 'target-closed name with unrelated text', create: () => Object.assign(new Error('storage flush failed'), { name: 'TargetClosedError' }) },
  { name: 'aggregate with matching text', create: () => new AggregateError([new Error('storage flush failed')], targetClosedMessage) },
  { name: 'thrown matching string', create: () => targetClosedMessage },
  { name: 'plain object with matching fields', create: () => ({ name: 'TargetClosedError', message: targetClosedMessage }) },
  { name: 'undefined failure', create: () => undefined },
  { name: 'null failure', create: () => null },
  { name: 'false failure', create: () => false },
  { name: 'zero failure', create: () => 0 },
];

for (const failure of genuineFailures) {
  for (const evidence of ['none', 'context-close'] as const) {
    for (const hostFails of [false, true]) {
      test(`lease: preserves ${failure.name} identity with ${evidence}, host ${hostFails ? 'fails' : 'succeeds'}`, { timeout: 1000 }, async () => {
        const closeError = failure.create();
        const hostError = new Error('host release failed');
        await retire({ boundary: 'lease', evidence, timing: 'before-close', closeFailure: { error: closeError },
          ...(hostFails ? { hostFailure: { error: hostError } } : {}),
          expectedErrors: hostFails ? [closeError, hostError] : [closeError],
        });
      });
    }
  }
}

for (const boundary of ['lease', 'controller'] as const) {
  test(`${boundary}: host target-closed error survives suppression of the distinct context error`, { timeout: 1000 }, async () => {
    const closeError = new Error(`browserContext.close: ${targetClosedMessage}`);
    const hostError = new Error(`browserContext.close: ${targetClosedMessage}`);
    await retire({ boundary, evidence: 'context-close', timing: 'during-host-release', closeFailure: { error: closeError },
      hostFailure: { error: hostError }, expectedErrors: [hostError],
    });
  });
  test(`${boundary}: local retirement without closure evidence preserves both target-closed and host error identities`, { timeout: 1000 }, async () => {
    const closeError = new Error(`browserContext.close: ${targetClosedMessage}`);
    const hostError = new Error('borrowed resource return failed');
    await retire({ boundary, evidence: 'none', timing: 'after-host-release', closeFailure: { error: closeError },
      hostFailure: { error: hostError }, expectedErrors: [closeError, hostError],
    });
  });
  test(`${boundary}: confirmed disconnect preserves genuine context and host failures`, { timeout: 1000 }, async () => {
    const closeError = new Error('context flush failed');
    const hostError = new Error('host release failed');
    await retire({ boundary, evidence: 'browser-disconnected', timing: 'during-close', closeFailure: { error: closeError },
      hostFailure: { error: hostError }, expectedErrors: [closeError, hostError],
    });
  });
  for (const hostError of [new Error(`browserContext.close: ${targetClosedMessage}`), undefined, false]) {
    test(`${boundary}: successful context close preserves host rejection ${String(hostError)}`, { timeout: 1000 }, async () => {
      await retire({ boundary, evidence: 'context-close', timing: 'during-close',
        hostFailure: { error: hostError }, expectedErrors: [hostError],
      });
    });
  }
  test(`${boundary}: successful borrowed-resource return needs no remote-close event`, { timeout: 1000 }, async () => {
    await retire({ boundary, evidence: 'none', timing: 'after-host-release', expectedErrors: [] });
  });
}
