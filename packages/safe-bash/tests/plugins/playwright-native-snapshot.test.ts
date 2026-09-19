import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSnapshotEngine } from '../../src/playwright/snapshot.js';
import type { PlaywrightPage } from '../../src/playwright/adapter.js';
import { captureNativePlaywrightSnapshot } from '../../src/playwright/native-snapshot.js';

function fixture(shape: 'public' | 'cloudflare' = 'cloudflare') {
  let snapshot: unknown = { full: '- main [ref=e1]:\n  - button "Save [ref=e99]" [ref=e2]\n  - iframe [ref=f1e3]:\n    - link "Next" [ref=f1e4]' };
  const selected: string[] = [];
  let disposed = 0;
  const page = {
    ...(shape === 'public' ? { async ariaSnapshot() { return (snapshot as { full: string }).full; } } : { async _snapshotForAI() { return snapshot; } }),
    locator(selector: string) { selected.push(selector); return { async elementHandle() { return {
      async evaluate(callback: (node: { isConnected: boolean }) => unknown) { return callback({ isConnected: true }); },
      async dispose() { disposed++; },
    }; } }; },
  } as unknown as PlaywrightPage;
  let sequence = 0;
  const engine = createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 8 }, () => `e${100 + ++sequence}`);
  return { page, engine, selected, setSnapshot(value: unknown) { snapshot = value; }, get disposed() { return disposed; } };
}

for (const shape of ['public', 'cloudflare'] as const) test(`${shape} native hierarchy retains only issued references and does not rewrite quoted page text`, async () => {
  const f = fixture(shape);
  const text = await f.engine.capture(f.page);
  assert.equal(text, '- main [ref=e101]:\n  - button "Save [ref=e99]" [ref=e102]\n  - iframe [ref=e103]:\n    - link "Next" [ref=e104]');
  await assert.rejects(f.engine.resolve('e2'), /stale/);
  await f.engine.resolve('e102');
  assert.deepEqual(f.selected, ['aria-ref=e2']);
  await f.engine.invalidate();
  assert.equal(f.disposed, 1);
  await assert.rejects(f.engine.resolve('e102'), /stale/);
});

test('the pinned Cloudflare native snapshot contract rejects incompatible protocol result shapes', async () => {
const f = fixture();
  for (const invalid of [null, '- button "Unexpected plain string"', { incremental: '- button "Missing full"' }, { full: 42 }]) {
    f.setSnapshot(invalid);
    await assert.rejects(f.engine.capture(f.page), /native snapshot/);
  }
});

test('native JSON snapshots retain complete names, state and hierarchy with scoped actionable refs', async () => {
  const f = fixture();
  const name = 'long name '.repeat(100);
  f.page.ariaSnapshotJSON = async () => [{ role: 'main', ref: 'e1', children: [{ role: 'button', name, disabled: true, ref: 'e2', box: { x: 1, y: 2, width: 30, height: 40 } }] }];
  let sequence = 100;
  const engine = createSnapshotEngine({ maxSnapshotBytes: 4096, maxSnapshotRefs: 8 }, () => `e${++sequence}`);
  const tree = await engine.captureJSON(f.page);
  assert.deepEqual(tree, [{ role: 'main', ref: 'e101', children: [{ role: 'button', name, disabled: true, ref: 'e102', box: { x: 1, y: 2, width: 30, height: 40 } }] }]);
  await engine.resolve('e102');
  assert.deepEqual(f.selected, ['aria-ref=e2']);
  await engine.invalidate();
  await assert.rejects(engine.resolve('e102'), /stale/);
});

test('native JSON fallback uses the provider tree with depth and bounded atomic ref publication', async () => {
  const f = fixture();
  let calls = 0;
  const captureJSON = async () => { calls++; return [{ role: 'main', ref: 'e1', children: [{ role: 'region', ref: 'e2', children: [{ role: 'button', ref: 'e3' }] }] }]; };
  assert.deepEqual(await f.engine.captureJSON(f.page, undefined, { captureJSON, depth: 1 }), [{ role: 'main', ref: 'e101', children: [{ role: 'region', ref: 'e102' }] }]);
  assert.equal(calls, 1);
  await assert.rejects(f.engine.captureJSON(f.page, undefined, { captureJSON: async () => [{ role: 'button', name: 'x'.repeat(1024), ref: 'e4' }] }), /byte limit/);
  await assert.rejects(f.engine.resolve('e102'), /stale/);
});

for (const format of ['yaml', 'json'] as const) test(`${format} retries one navigation-invalidated capture without publishing its stale refs`, async () => {
  const f = fixture();
  const timeouts: number[] = [];
  let captures = 0;
  const nativeCapture = async (options: { timeout?: number }) => {
    timeouts.push(options.timeout!);
    if (++captures === 1) await f.engine.invalidate();
    return captures === 1 ? 'Old' : 'Current';
  };
  f.page.ariaSnapshot = async options => `- button "${await nativeCapture(options ?? {})}" [ref=e1]`;
  f.page.ariaSnapshotJSON = async options => [{ role: 'button', name: await nativeCapture(options ?? {}), ref: 'e1' }];
  const result = format === 'yaml' ? await f.engine.capture(f.page, undefined, { timeout: 1500 }) : await f.engine.captureJSON(f.page, undefined, { timeout: 1500 });
  assert.match(JSON.stringify(result), /Current/);
  assert.equal(captures, 2);
  assert.ok(timeouts[1]! > 0 && timeouts[1]! <= timeouts[0]!);
  await assert.rejects(f.engine.resolve('e101'), /stale/);
  await f.engine.resolve('e102');
  assert.deepEqual(f.selected, ['aria-ref=e1']);
});

test('continuously navigating snapshots stop after one retry and publish no refs', async () => {
  const f = fixture();
  let captures = 0;
  f.page.ariaSnapshot = async () => { captures++; await f.engine.invalidate(); return '- button [ref=e1]'; };
  await assert.rejects(f.engine.capture(f.page), /Snapshot stale during capture/);
  assert.equal(captures, 2);
  await assert.rejects(f.engine.resolve('e101'), /stale/);
  await assert.rejects(f.engine.resolve('e102'), /stale/);
});

for (const boundary of ['root', 'deadline', 'native-error', 'abort'] as const) test(`snapshot retry preserves the ${boundary} boundary`, async t => {
  const f = fixture();
  const abort = new AbortController();
  let now = 1000, captures = 0;
  t.mock.method(Date, 'now', () => now);
  const root = await f.page.locator('button').elementHandle!();
  assert.ok(root);
  f.page.ariaSnapshot = async () => {
    captures++;
    if (boundary === 'native-error') throw new Error('Snapshot stale during capture');
    if (boundary === 'deadline') now += 20;
    if (boundary === 'abort') abort.abort(new Error('capture cancelled'));
    await f.engine.invalidate();
    return '';
  };
  await assert.rejects(f.engine.capture(f.page, abort.signal, { timeout: 10, ...(boundary === 'root' ? { root } : {}) }), /Snapshot stale during capture|capture cancelled/);
  assert.equal(captures, 1);
});

test('unquoted YAML text values never become native references or affect following node headers', async () => {
  const f = fixture();
  f.setSnapshot({ full: '- text: Page says "use [ref=e99]\n- button "Real" [ref=e2]\n- paragraph [ref=e3]: use [ref=e100]' });
  assert.equal(await f.engine.capture(f.page), '- text: Page says "use [ref=e99]\n- button "Real" [ref=e101]\n- paragraph [ref=e102]: use [ref=e100]');
  await assert.rejects(f.engine.resolve('e99'), /stale/);
  await f.engine.resolve('e101');
  assert.deepEqual(f.selected, ['aria-ref=e2']);
});

test('native snapshot byte and reference budgets fail before publishing any references', async () => {
  const f = fixture();
  f.setSnapshot({ full: 'x'.repeat(1025) });
  await assert.rejects(f.engine.capture(f.page), /byte limit/);
  f.setSnapshot({ full: Array.from({ length: 9 }, (_, i) => `- button [ref=e${i}]`).join('\n') });
  await assert.rejects(f.engine.capture(f.page), /ref limit/);
  await assert.rejects(f.engine.resolve('e101'), /stale/);
});

test('Cloudflare snapshots honor depth and read real native element bounding boxes', async () => {
  const measured: string[] = [];
  const disposed: string[] = [];
  const page = {
    async _snapshotForAI() { return { full: '- main [ref=e1]:\n  - region "Actions" [ref=e2]:\n    - button "Save" [ref=e3]' }; },
    locator(selector: string) { return { async elementHandle() { return {
      async boundingBox() { measured.push(selector); return { x: 1.2, y: 2.8, width: 20.5, height: 9.1 }; },
      async dispose() { disposed.push(selector); },
    }; } }; },
  } as unknown as PlaywrightPage;
  let seq = 100;
  const result = await captureNativePlaywrightSnapshot(page, { maxBytes: 1024, maxRefs: 8, nextRef: () => `e${++seq}`, depth: 1, boxes: true });
  assert.equal(result.text, '- main [ref=e101] [box=1,3,21,9]:\n  - region "Actions" [ref=e102] [box=1,3,21,9]');
  assert.deepEqual(measured, ['aria-ref=e1', 'aria-ref=e2']);
  assert.deepEqual(disposed, measured);
});

for (const present of [true, false]) test(`native ref lookup does not wait for a missing node (present=${present})`, async () => {
  const f = fixture();
  let disposed = 0;
  let waiting = 0;
  const handle = { async evaluate() { return true; }, async dispose() { disposed++; } };
  f.page.locator = (() => ({
    async elementHandles() { return present ? [handle] : []; },
    async elementHandle() { waiting++; throw new Error('Waiting lookup must not run'); },
  })) as unknown as PlaywrightPage['locator'];
  await f.engine.capture(f.page);
  if (present) assert.equal(await f.engine.resolve('e102'), handle);
  else await assert.rejects(f.engine.resolve('e102'), /Snapshot ref stale/);
  assert.equal(waiting, 0);
  await f.engine.invalidate();
  assert.equal(disposed, present ? 1 : 0);
});

test('legacy native resolution uses the action timeout and checks absence without waiting', async () => {
  const f = fixture();
  let timeout: number | undefined;
  let count = 1;
  f.page.locator = (() => ({
    async count() { return count; },
    async elementHandle(options: { timeout?: number }) { timeout = options.timeout; return null; },
  })) as unknown as PlaywrightPage['locator'];
  await f.engine.capture(f.page);
  await assert.rejects(f.engine.resolve('e102', 250), /stale/);
  assert.equal(timeout, 250);
  count = 0; timeout = undefined;
  await assert.rejects(f.engine.resolve('e102', 250), /stale/);
  assert.equal(timeout, undefined);
});

test('ambiguous native references retire every acquired handle without selecting a node', async () => {
  const f = fixture();
  let disposed = 0;
  f.page.locator = (() => ({ async elementHandles() { return [1, 2].map(() => ({ async dispose() { disposed++; } })); } })) as unknown as PlaywrightPage['locator'];
  await f.engine.capture(f.page);
  await assert.rejects(f.engine.resolve('e102'), /stale/);
  assert.equal(disposed, 2);
});
