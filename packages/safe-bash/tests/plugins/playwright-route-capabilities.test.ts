import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capturePlaywrightRoutes, playwrightRouteAbilities, type PlaywrightRouteHandler } from '../../src/playwright/route-capabilities.js';
import type { PlaywrightAbilityRequest } from '../../src/playwright/abilities.js';
import type { PlaywrightContext } from '../../src/playwright/adapter.js';

function fixture() {
  const handlers: { pattern: string; handler: PlaywrightRouteHandler }[] = [];
  const cleanups: (() => Promise<void>)[] = [];
  let fail = false;
  let registration: Promise<void> | undefined;
  const context = {
    async route(pattern: string, handler: PlaywrightRouteHandler) { if (fail) throw new Error('registration failed'); await registration; handlers.push({ pattern, handler }); },
    async unroute(pattern: string, handler: PlaywrightRouteHandler) { if (fail) throw new Error('removal failed'); const index = handlers.findIndex(item => item.pattern === pattern && item.handler === handler); if (index >= 0) handlers.splice(index, 1); },
  } as unknown as PlaywrightContext;
  const request = (command: PlaywrightAbilityRequest['command'], args: string[] = [], options: PlaywrightAbilityRequest['options'] = {}, signal = new AbortController().signal): PlaywrightAbilityRequest => ({
    command, args, options, session: 's', signal,
    limits: { maxCommandBytes: 1024, maxArtifactBytes: 1024 },
    browserSession: { context, page: undefined, registerCleanup(cleanup) { cleanups.push(cleanup); }, resolveTarget: async () => { throw new Error('unused'); }, selectPage: async () => {} },
    write: async () => {}, readFile: async () => new Uint8Array(), writeArtifact: async () => {}, registerCleanup() {},
  });
  const run = (command: PlaywrightAbilityRequest['command'], args?: string[], options?: PlaywrightAbilityRequest['options'], signal?: AbortSignal) => playwrightRouteAbilities[command]!.execute(request(command, args, options, signal));
  return { context, handlers, cleanups, run, setFail(value: boolean) { fail = value; }, holdRegistration(value: Promise<void>) { registration = value; } };
}

test('routes use native fulfillment and request-header replacement with standard output', async () => {
  const f = fixture();
  await f.run('route', ['**/api'], { status: '201', body: '{"ok":true}', 'content-type': 'application/json' });
  const effects: unknown[] = [];
  const route = { request: () => ({ headers: () => ({ authorization: 'secret', kept: 'yes' }) }), fulfill: async (options: unknown) => { effects.push(options); }, continue: async (options: unknown) => { effects.push(options); } };
  await f.handlers[0]!.handler(route);
  assert.deepEqual(effects[0], { status: 201, body: '{"ok":true}', contentType: 'application/json' });
  await f.run('route', ['**/*'], { header: ['X-Added: value'], 'remove-header': 'authorization' });
  await f.handlers[1]!.handler(route);
  assert.deepEqual(effects[1], { headers: { kept: 'yes', 'x-added': 'value' } });
  assert.match(JSON.stringify(await f.run('route-list')), /1\. \*\*\/api \(status=201/);
  assert.match(JSON.stringify(await f.run('unroute', ['**/api'])), /Removed 1 route/);
  assert.equal(f.handlers.length, 1);
  for (const close of f.cleanups) await close();
  assert.equal(f.handlers.length, 0);
});

test('failed route mutations preserve the committed registry and reject invalid configuration', async () => {
  const f = fixture();
  f.setFail(true);
  await assert.rejects(f.run('route', ['**/*']), /registration failed/);
  assert.match(JSON.stringify(await f.run('route-list')), /No active routes/);
  f.setFail(false);
  await f.run('route', ['**/*']);
  f.setFail(true);
  await assert.rejects(f.run('unroute'), /removal failed/);
  assert.match(JSON.stringify(await f.run('route-list')), /\*\*\/\*/);
  f.setFail(false);
  await assert.rejects(f.run('route', ['**/*'], { status: 'bogus' }), /status/);
  await assert.rejects(f.run('route', ['**/*'], { header: 'missing colon' }), /header/);
  await assert.rejects(f.run('route', ['**/*'], { body: 'a'.repeat(1025) }), /byte limit/);
  await f.run('unroute');
  assert.equal(f.handlers.length, 0);
});

test('state replacement can reapply captured routes after the old context is retired', async () => {
  const old = fixture(), fresh = fixture();
  await old.run('route', ['**/api'], { body: 'retained' });
  const restore = capturePlaywrightRoutes(old.context)!;
  for (const close of old.cleanups) await close();
  await restore(fresh.context, cleanup => fresh.cleanups.push(cleanup));
  assert.equal(fresh.handlers.length, 1);
  assert.match(JSON.stringify(await fresh.run('route-list')), /body=retained/);
  await fresh.run('unroute');
  assert.equal(fresh.handlers.length, 0);
});

test('canceled route registration rolls back only its own handler and preserves the abort reason', async () => {
  for (const reason of [new Error('cancel registration'), 0]) {
    const setup = fixture();
    await setup.run('route', ['**/api'], { body: 'keep' });
    const original = setup.handlers[0];
    let resume!: () => void;
    setup.holdRegistration(new Promise<void>(resolve => { resume = resolve; }));
    const controller = new AbortController();
    const pending = setup.run('route', ['**/api'], { body: 'discard' }, controller.signal);
    controller.abort(reason);
    const rejected = assert.rejects(pending, error => error === reason);
    resume();
    try {
      await rejected;
      assert.deepEqual(setup.handlers, [original]);
      assert.doesNotMatch(JSON.stringify(await setup.run('route-list')), /discard/);
    } finally { for (const close of setup.cleanups) await close(); }
  }
});

test('route registration completing after session cleanup cannot resurrect a handler', async () => {
  const setup = fixture();
  let resume!: () => void;
  setup.holdRegistration(new Promise<void>(resolve => { resume = resolve; }));
  const pending = setup.run('route', ['**/api'], { body: 'discard' });
  for (const close of setup.cleanups) await close();
  const rejected = assert.rejects(pending, /closed/);
  resume();
  await rejected;
  assert.equal(setup.handlers.length, 0);
});

test('restored route registration also rolls back when replacement cleanup wins the race', async () => {
  const old = fixture(), fresh = fixture();
  await old.run('route', ['**/api'], { body: 'retained' });
  const restore = capturePlaywrightRoutes(old.context)!;
  let resume!: () => void;
  fresh.holdRegistration(new Promise<void>(resolve => { resume = resolve; }));
  const pending = restore(fresh.context, cleanup => fresh.cleanups.push(cleanup));
  for (const close of fresh.cleanups) await close();
  const rejected = assert.rejects(pending, /closed/);
  resume();
  try { await rejected; assert.equal(fresh.handlers.length, 0); }
  finally { for (const close of old.cleanups) await close(); }
});
