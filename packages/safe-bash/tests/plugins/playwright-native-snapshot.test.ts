import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSnapshotEngine } from '../../src/playwright/snapshot.js';
import type { PlaywrightPage, PlaywrightElementHandle } from '../../src/playwright/adapter.js';
import { captureNativePlaywrightSnapshot } from '../../src/playwright/native-snapshot.js';
import { captureNativePlaywrightJSON } from '../../src/playwright/native-json-snapshot.js';

for (const cached of [false, true]) test(`bulk ref reuse rejects an iframe document replacement with cached handle=${cached}`, async () => {
  const f = fixture();
  let scope = {}, current = 0;
  const handles = [0, 1].map(value => ({ value, async evaluate() { return true; }, async dispose() {} })) as unknown as PlaywrightElementHandle[];
  f.page.ariaSnapshotJSON = async () => {
    if (current++) scope = {}; // The child navigates during capture, after old liveness probes.
    return [{ role: 'button', ref: 'f1e1' }];
  };
  const options = { captureReferences: async () => {
    const index = current - 1;
    return { identities: [{ scope, value: 1 }], async connected() { return [true]; }, async resolve() { return handles[index]!; } };
  } };
  const first = await f.engine.captureJSON(f.page, undefined, options);
  const old = first[0]!.ref!;
  if (cached) assert.equal(await f.engine.resolve(old), handles[0]);
  const second = await f.engine.captureJSON(f.page, undefined, options);
  assert.notEqual(second[0]!.ref, old);
  await assert.rejects(f.engine.resolve(old), /not found in the current page snapshot/);
  assert.equal(await f.engine.resolve(second[0]!.ref!), handles[1]);
  await f.engine.invalidate();
});

test('eager ref reuse checks the old document after native capture', async () => {
  const f = fixture();
  let document = 0;
  const handles = [1, 2].map(value => ({ async evaluate() { return value === document; }, async dispose() {} })) as unknown as PlaywrightElementHandle[];
  f.page.ariaSnapshotJSON = async () => { document++; return [{ role: 'button', ref: 'f1e1' }]; };
  f.page.locator = () => ({ async elementHandles() { return [handles[document - 1]!]; } }) as ReturnType<PlaywrightPage['locator']>;
  const first = await f.engine.captureJSON(f.page);
  const second = await f.engine.captureJSON(f.page);
  assert.notEqual(first[0]!.ref, second[0]!.ref);
  assert.equal(await f.engine.resolve(second[0]!.ref!), handles[1]);
  await f.engine.invalidate();
});

for (const replace of [false, true]) test(`concurrent lazy ref resolution drains handles across publication, replace=${replace}`, async () => {
  const f = fixture();
  let complete!: (handle: PlaywrightElementHandle) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let calls = 0, disposed = 0;
  const scope = {};
  f.page.ariaSnapshotJSON = async () => [{ role: 'button', ref: 'e1' }];
  const options = { captureReferences: async () => ({ identities: [{ scope, value: 1 }], async connected() { return [true]; }, async resolve() { calls++; entered(); return new Promise<PlaywrightElementHandle>(resolve => { complete = resolve; }); } }) };
  const tree = await f.engine.captureJSON(f.page, undefined, options);
  const ref = tree[0]!.ref!;
  const first = f.engine.resolve(ref), second = f.engine.resolve(ref);
  const results = Promise.allSettled([first, second]);
  await started;
  if (replace) { f.page.ariaSnapshotJSON = async () => []; await f.engine.captureJSON(f.page, undefined, options); }
  const handle = { async evaluate() { return true; }, async dispose() { disposed++; } } as unknown as PlaywrightElementHandle;
  complete(handle);
  const outcomes = await results;
  assert.equal(calls, 1);
  assert.deepEqual(outcomes.map(outcome => outcome.status), replace ? ['rejected', 'rejected'] : ['fulfilled', 'fulfilled']);
  await f.engine.invalidate();
  assert.equal(disposed, 1);
});

test('a ref removed while native connectivity is pending cannot resolve', async () => {
  const f = fixture();
  let complete!: (value: boolean) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const handle = { async evaluate() { entered(); return new Promise<boolean>(resolve => { complete = resolve; }); }, async dispose() {} } as unknown as PlaywrightElementHandle;
  const scope = {};
  const options = { captureReferences: async () => ({ identities: [{ scope, value: 1 }], async connected() { return [true]; }, async resolve() { return handle; } }) };
  f.page.ariaSnapshotJSON = async () => [{ role: 'button', ref: 'e1' }];
  const tree = await f.engine.captureJSON(f.page, undefined, options);
  const resolution = f.engine.resolve(tree[0]!.ref!);
  const settled = Promise.allSettled([resolution]);
  await started;
  f.page.ariaSnapshotJSON = async () => [];
  await f.engine.captureJSON(f.page, undefined, options);
  complete(true);
  assert.equal((await settled)[0]!.status, 'rejected');
  await f.engine.invalidate();
});

test('a refresh of the same witness shares its pending handle acquisition', async () => {
  const f = fixture();
  const scope = {};
  let calls = 0;
  const completions: ((handle: PlaywrightElementHandle) => void)[] = [];
  const handle = { async evaluate() { return true; }, async dispose() {} } as unknown as PlaywrightElementHandle;
  const options = { captureReferences: async () => ({ identities: [{ scope, value: 1 }], async connected() { return [true]; }, async resolve() { calls++; return new Promise<PlaywrightElementHandle>(resolve => completions.push(resolve)); } }) };
  f.page.ariaSnapshotJSON = async () => [{ role: 'button', ref: 'e1' }];
  const tree = await f.engine.captureJSON(f.page, undefined, options);
  const first = f.engine.resolve(tree[0]!.ref!);
  await f.engine.captureJSON(f.page, undefined, options);
  const second = f.engine.resolve(tree[0]!.ref!);
  for (const complete of completions) complete(handle);
  assert.deepEqual(await Promise.all([first, second]), [handle, handle]);
  assert.equal(calls, 1);
  await f.engine.invalidate();
});

for (const format of ['yaml', 'json'] as const) test(`${format} bulk witnesses defer native handles and preserve stale refs`, async () => {
  const f = fixture();
  let resolved = 0, connected = true, disposed = 0;
  const scope = {};
  const handle = { async evaluate(fn: (node: { isConnected: boolean }) => unknown) { return fn({ isConnected: connected }); }, async dispose() { disposed++; } } as unknown as PlaywrightElementHandle;
  const captureReferences = async (_page: PlaywrightPage, refs: readonly string[]) => {
    assert.deepEqual(refs, ['e1', 'e2', 'f1e3', 'f1e4']);
    return {
      identities: refs.map((_, index) => ({ scope, value: index })),
      async connected() { return refs.map(() => connected); },
      async resolve(index: number) { assert.equal(index, 1); resolved++; return connected ? handle : null; },
    };
  };
  const capture = () => format === 'yaml'
    ? f.engine.capture(f.page, undefined, { captureReferences })
    : f.engine.captureJSON(f.page, undefined, { captureReferences, captureJSON: async () => ['e1', 'e2', 'f1e3', 'f1e4'].map(ref => ({ role: 'button', ref })) });
  await capture();
  assert.deepEqual(f.selected, []);
  assert.equal(resolved, 0);
  await capture();
  await f.engine.resolve('e102');
  assert.equal(resolved, 1);
  await f.engine.resolve('e102');
  assert.equal(resolved, 1);
  connected = false;
  await assert.rejects(f.engine.resolve('e102'), /stale/);
  await f.engine.invalidate();
  assert.equal(disposed, 1);
});

for (const [width, maxRefs, scoped] of [[150001, Infinity, false], [5001, 1, false], [150001, 1, true]] as const) {
  test(`native JSON accepts ${width} children with one unique ref (maxRefs=${maxRefs}, scoped=${scoped})`, async () => {
    const children = Array.from({ length: width }, (_, index) => ({ role: 'text', text: `child ${index}`, ...(scoped ? { ref: 'e1' } : {}) }));
    const page = {
      async ariaSnapshotJSON() { return [{ role: 'main', ...(scoped ? {} : { ref: 'e1' }), children }]; },
      locator() { return { async elementHandle() { return { async evaluate() { return true; }, async dispose() {} }; } }; },
    } as unknown as PlaywrightPage;
    const result = await captureNativePlaywrightJSON(page, {
      maxBytes: Infinity, maxRefs, nextRef: () => 'e101',
      ...(scoped ? { root: {} as NonNullable<Parameters<typeof captureNativePlaywrightJSON>[1]['root']> } : {}),
    });
    assert.deepEqual(result.tree, scoped ? children.map(child => ({ ...child, ref: 'e101' })) : [{ role: 'main', ref: 'e101', children }]);
    assert.deepEqual([...result.refs], [['e101', 'e1']]);
  });
}

test('native JSON ignores legacy byte limits, retains ref limits and validates the last child of a wide tree', async () => {
  const children = Array.from({ length: 5001 }, () => ({ role: 'text' }));
  let tree: unknown = [{ role: 'main', ref: 'e1', children }];
  const page = { async ariaSnapshotJSON() { return tree; } } as unknown as PlaywrightPage;
  const options = { maxBytes: Infinity, maxRefs: 1, nextRef: () => 'e101' };
  assert.equal((await captureNativePlaywrightJSON(page, { ...options, maxBytes: 32 })).tree[0]!.children!.length, 5001);
  tree = [{ role: 'main', ref: 'e1', children: [...children, { role: 'button', ref: 'e2' }] }];
  await assert.rejects(captureNativePlaywrightJSON(page, options), /ref limit/);
  tree = [{ role: 'main', ref: 'e1', children: [...children, { role: 42 }] }];
  await assert.rejects(captureNativePlaywrightJSON(page, options), /Invalid native JSON snapshot node/);
});

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
  await assert.rejects(f.engine.resolve('e2'), /not found|stale/);
  await f.engine.resolve('e102');
  assert.deepEqual(f.selected, ['aria-ref=e1', 'aria-ref=e2', 'aria-ref=f1e3', 'aria-ref=f1e4']);
  await f.engine.invalidate();
  assert.equal(f.disposed, 4);
  await assert.rejects(f.engine.resolve('e102'), /not found|stale/);
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
  assert.deepEqual(f.selected, ['aria-ref=e1', 'aria-ref=e2']);
  await engine.invalidate();
  await assert.rejects(engine.resolve('e102'), /not found|stale/);
});

test('native JSON fallback uses the provider tree with depth and bounded atomic ref publication', async () => {
  const f = fixture();
  let calls = 0;
  const captureJSON = async () => { calls++; return [{ role: 'main', ref: 'e1', children: [{ role: 'region', ref: 'e2', children: [{ role: 'button', ref: 'e3' }] }] }]; };
  assert.deepEqual(await f.engine.captureJSON(f.page, undefined, { captureJSON, depth: 1 }), [{ role: 'main', ref: 'e101', children: [{ role: 'region', ref: 'e102' }] }]);
  assert.equal(calls, 1);
  assert.deepEqual(await f.engine.captureJSON(f.page, undefined, { captureJSON: async () => [{ role: 'button', name: 'x'.repeat(1024), ref: 'e4' }] }), [{ role: 'button', name: 'x'.repeat(1024), ref: 'e103' }]);
  await assert.rejects(f.engine.resolve('e102'), /not found|stale/);
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
  await assert.rejects(f.engine.resolve('e101'), /not found|stale/);
  await f.engine.resolve('e102');
  assert.deepEqual(f.selected, ['aria-ref=e1']);
});

test('continuously navigating snapshots stop after one retry and publish no refs', async () => {
  const f = fixture();
  let captures = 0;
  f.page.ariaSnapshot = async () => { captures++; await f.engine.invalidate(); return '- button [ref=e1]'; };
  await assert.rejects(f.engine.capture(f.page), /Snapshot stale during capture/);
  assert.equal(captures, 2);
  await assert.rejects(f.engine.resolve('e101'), /not found|stale/);
  await assert.rejects(f.engine.resolve('e102'), /not found|stale/);
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
  await assert.rejects(f.engine.resolve('e99'), /not found|stale/);
  await f.engine.resolve('e101');
  assert.deepEqual(f.selected, ['aria-ref=e2', 'aria-ref=e3']);
});

test('native snapshots ignore legacy byte budgets and enforce reference budgets', async () => {
  const f = fixture();
  f.setSnapshot({ full: 'x'.repeat(1025) });
  assert.equal(await f.engine.capture(f.page), 'x'.repeat(1025));
  f.setSnapshot({ full: Array.from({ length: 9 }, (_, i) => `- button [ref=e${i}]`).join('\n') });
  await assert.rejects(f.engine.capture(f.page), /ref limit/);
  await assert.rejects(f.engine.resolve('e101'), /not found|stale/);
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

test('legacy native capture uses the capture timeout and checks absence without waiting', async () => {
  const f = fixture();
  let timeout: number | undefined;
  let count = 1;
  f.page.locator = (() => ({
    async count() { return count; },
    async elementHandle(options: { timeout?: number }) { timeout = options.timeout; return null; },
  })) as unknown as PlaywrightPage['locator'];
  await f.engine.capture(f.page, undefined, { timeout: 250 });
  await assert.rejects(f.engine.resolve('e102', 250), /not found|stale/);
  assert.equal(timeout, 250);
  count = 0; timeout = undefined;
  await f.engine.capture(f.page, undefined, { timeout: 250 });
  await assert.rejects(f.engine.resolve('e102', 250), /not found|stale/);
  assert.equal(timeout, undefined);
});

test('ambiguous native references retire every acquired handle without selecting a node', async () => {
  const f = fixture();
  let disposed = 0;
  f.page.locator = (() => ({ async elementHandles() { return [1, 2].map(() => ({ async dispose() { disposed++; } })); } })) as unknown as PlaywrightPage['locator'];
  await f.engine.capture(f.page);
  await assert.rejects(f.engine.resolve('e102'), /not found|stale/);
  assert.equal(disposed, 8);
});

test('native refs survive repeated text and JSON snapshots until navigation invalidates them', async () => {
  const f = fixture();
  const first = await f.engine.capture(f.page);
  await f.engine.resolve('e102');
  assert.equal(await f.engine.capture(f.page), first);
  await f.engine.resolve('e102');
  f.page.ariaSnapshotJSON = async () => [{ role: 'button', ref: 'e2', name: 'Save' }];
  assert.deepEqual(await f.engine.captureJSON(f.page), [{ role: 'button', ref: 'e102', name: 'Save' }]);
  await f.engine.resolve('e102');
  await f.engine.invalidate();
  await assert.rejects(f.engine.resolve('e102'), /not found|stale/);
  assert.equal(f.disposed, 4);
});

for (const format of ['yaml', 'json'] as const) test(`${format} does not rebind unvisited refs when a child document recycles native IDs`, async () => {
  const f = fixture();
  const parent = { isConnected: true };
  const oldChild = { isConnected: true };
  let child = oldChild;
  f.setSnapshot({ full: '- textbox "Parent" [ref=e1]\n- textbox "Child" [ref=f1e1]' });
  f.page.ariaSnapshotJSON = async () => [{ role: 'textbox', name: 'Parent', ref: 'e1' }, { role: 'textbox', name: 'Child', ref: 'f1e1' }];
  f.page.locator = ((selector: string) => ({ async elementHandles() {
    const node = selector === 'aria-ref=e1' ? parent : child;
    return [{ async evaluate(callback: (node: typeof parent) => unknown) {
      if (node === oldChild && child !== oldChild) throw new Error('Execution context destroyed');
      return callback(node);
    }, async dispose() {} }];
  } })) as unknown as PlaywrightPage['locator'];
  const capture = () => format === 'yaml' ? f.engine.capture(f.page) : f.engine.captureJSON(f.page);
  await capture();
  child = { isConnected: true };
  await capture();
  await f.engine.resolve('e101');
  await assert.rejects(f.engine.resolve('e102'), /not found|stale/);
  await f.engine.resolve('e103');
  await f.engine.invalidate();
});

for (const format of ['yaml', 'json'] as const) for (const cached of [false, true]) test(`${format} child navigation during capture preserves parent refs and replaces ${cached ? 'cached' : 'unvisited'} child refs`, async () => {
  const f = fixture();
  const parent = { isConnected: true };
  const old = { isConnected: true };
  let child = old;
  let navigate = false;
  const full = '- textbox "Parent" [ref=e1]\n- textbox "Child" [ref=f1e1]';
  f.page._snapshotForAI = async () => { if (navigate) child = { isConnected: true }; return { full }; };
  f.page.ariaSnapshotJSON = async () => { if (navigate) child = { isConnected: true }; return [{ role: 'textbox', ref: 'e1' }, { role: 'textbox', ref: 'f1e1' }]; };
  f.page.locator = ((selector: string) => ({ async elementHandles() {
    const node = selector === 'aria-ref=e1' ? parent : child;
    return [{ async evaluate(callback: (node: typeof parent) => unknown) {
      if (node === old && child !== old) throw new Error('Execution context destroyed');
      return callback(node);
    }, async dispose() {} }];
  } })) as unknown as PlaywrightPage['locator'];
  const capture = () => format === 'yaml' ? f.engine.capture(f.page) : f.engine.captureJSON(f.page);
  await capture();
  if (cached) await f.engine.resolve('e102');
  navigate = true;
  const result = await capture();
  assert.ok(JSON.stringify(result).includes('e103'));
  await assert.rejects(f.engine.resolve('e102'), /not found|stale/);
  await f.engine.resolve('e101');
  await f.engine.resolve('e103');
  await f.engine.invalidate();
});

test('an unvisited native ref cannot first bind to a replacement after capture', async () => {
  const f = fixture();
  f.setSnapshot({ full: '- textbox "Child" [ref=f1e1]' });
  const old = { isConnected: true };
  let node = old;
  f.page.locator = (() => ({ async elementHandles() {
    const captured = node;
    return [{ async evaluate(callback: (node: typeof old) => unknown) { return callback(captured); }, async dispose() {} }];
  } })) as unknown as PlaywrightPage['locator'];
  await f.engine.capture(f.page);
  old.isConnected = false;
  node = { isConnected: true };
  await assert.rejects(f.engine.resolve('e101'), /not found|stale/);
  await f.engine.invalidate();
});

test('missing targets remain stale until a fresh snapshot issues a new ref', async () => {
  const f = fixture();
  f.setSnapshot({ full: '- button "Save" [ref=e1]' });
  let present = false;
  let lookups = 0;
  const handle = { async evaluate() { return true; }, async dispose() {} };
  f.page.locator = (() => ({ async elementHandles() { lookups++; return present ? [handle] : []; } })) as unknown as PlaywrightPage['locator'];
  await f.engine.capture(f.page);
  present = true;
  await assert.rejects(f.engine.resolve('e101'), /not found|stale/);
  assert.equal(lookups, 1);
  await f.engine.capture(f.page);
  await assert.rejects(f.engine.resolve('e101'), /not found|stale/);
  assert.equal(await f.engine.resolve('e102'), handle);
  await f.engine.invalidate();
});

test('navigation during native binding drains acquired handles before retrying', async () => {
  const f = fixture();
  f.setSnapshot({ full: '- button "Save" [ref=e1]' });
  let acquisitions = 0, disposals = 0;
  f.page.locator = (() => ({ async elementHandles() {
    if (++acquisitions === 1) await f.engine.invalidate();
    return [{ async evaluate() { return true; }, async dispose() { disposals++; } }];
  } })) as unknown as PlaywrightPage['locator'];
  await f.engine.capture(f.page);
  assert.equal(acquisitions, 2);
  assert.equal(disposals, 1);
  await assert.rejects(f.engine.resolve('e101'), /not found|stale/);
  await f.engine.resolve('e102');
  await f.engine.invalidate();
  assert.equal(disposals, 2);
});


for (const mode of ['timeout', 'abort'] as const) test(`lazy native acquisition obeys ${mode} and disposes its late handle`, async () => {
  const f = fixture();
  const abort = new AbortController();
  let finish!: (handle: PlaywrightElementHandle) => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  let disposed!: () => void;
  const retired = new Promise<void>(resolve => { disposed = resolve; });
  const handle = { async evaluate() { return true; }, async dispose() { disposed(); } } as unknown as PlaywrightElementHandle;
  f.page.ariaSnapshotJSON = async () => [{ role: 'button', ref: 'e1' }];
  const tree = await f.engine.captureJSON(f.page, undefined, { captureReferences: async () => ({
    identities: [{ scope: {}, value: 1 }], async connected() { return [true]; },
    async resolve() { started(); return new Promise<PlaywrightElementHandle>(resolve => { finish = resolve; }); },
  }) });
  const result = f.engine.resolve(tree[0]!.ref!, mode === 'timeout' ? 5 : 0, abort.signal).then(() => 'fulfilled', () => 'rejected');
  await entered;
  if (mode === 'abort') abort.abort(new Error('cancel lazy acquisition'));
  const outcome = await Promise.race([result, new Promise<string>(resolve => setTimeout(() => resolve('pending'), 40))]);
  finish(handle);
  await result;
  await f.engine.invalidate();
  await retired;
  assert.equal(outcome, 'rejected');
});

for (const format of ['yaml', 'json'] as const) test(`${format} fallback witness connectivity obeys the capture deadline`, async () => {
  const f = fixture();
  let finish!: (connected: boolean[]) => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  f.page.ariaSnapshotJSON = async () => [{ role: 'button', ref: 'e1' }];
  await f.engine.captureJSON(f.page, undefined, { captureReferences: async () => ({
    identities: [{ scope: {}, value: 1 }],
    async connected() { started(); return new Promise<boolean[]>(resolve => { finish = resolve; }); },
    async resolve() { return null; },
  }) });
  const operation = format === 'yaml' ? f.engine.capture(f.page, undefined, { timeout: 5 }) : f.engine.captureJSON(f.page, undefined, { timeout: 5 });
  const result = operation.then(() => 'fulfilled', () => 'rejected');
  await entered;
  const outcome = await Promise.race([result, new Promise<string>(resolve => setTimeout(() => resolve('pending'), 40))]);
  finish([true]);
  await result;
  await f.engine.invalidate();
  assert.equal(outcome, 'rejected');
});
