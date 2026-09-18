import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capturePlaywrightRoutes, playwrightRouteAbilities, type PlaywrightRouteHandler } from '../../src/playwright/route-capabilities.js';
import type { PlaywrightAbilityRequest } from '../../src/playwright/abilities.js';
import type { PlaywrightContext } from '../../src/playwright/adapter.js';

function fixture() {
  const handlers: { pattern: string; handler: PlaywrightRouteHandler }[] = [];
  const cleanups: (() => Promise<void>)[] = [];
  let fail = false;
  const context = {
    async route(pattern: string, handler: PlaywrightRouteHandler) { if (fail) throw new Error('registration failed'); handlers.push({ pattern, handler }); },
    async unroute(pattern: string, handler: PlaywrightRouteHandler) { if (fail) throw new Error('removal failed'); const index = handlers.findIndex(item => item.pattern === pattern && item.handler === handler); if (index >= 0) handlers.splice(index, 1); },
  } as unknown as PlaywrightContext;
  const request = (command: PlaywrightAbilityRequest['command'], args: string[] = [], options: PlaywrightAbilityRequest['options'] = {}): PlaywrightAbilityRequest => ({
    command, args, options, session: 's', signal: new AbortController().signal,
    limits: { maxCommandBytes: 1024, maxArtifactBytes: 1024 },
    browserSession: { context, page: undefined, registerCleanup(cleanup) { cleanups.push(cleanup); }, resolveTarget: async () => { throw new Error('unused'); }, selectPage: async () => {} },
    write: async () => {}, readFile: async () => new Uint8Array(), writeArtifact: async () => {}, registerCleanup() {},
  });
  const run = (command: PlaywrightAbilityRequest['command'], args?: string[], options?: PlaywrightAbilityRequest['options']) => playwrightRouteAbilities[command]!.execute(request(command, args, options));
  return { context, handlers, cleanups, run, setFail(value: boolean) { fail = value; } };
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
