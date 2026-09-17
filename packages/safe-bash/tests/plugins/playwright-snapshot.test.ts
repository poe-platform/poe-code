import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSnapshotEngine } from '../../src/playwright/snapshot.js';
import type { PlaywrightPage, SnapshotNode } from '../../src/playwright/adapter.js';
import { createSnapshotFrame } from '../helpers/playwright-snapshot.js';

function contentFixture(nodes: Record<string, unknown>[], content = 'Ready\nHere is the information the agent needs to read.') {
  const disposed: number[] = [];
  const elements = nodes.map((properties, index) => {
    const node = { tagName: 'BUTTON', textContent: '', isConnected: true, getAttribute: () => null, ...properties };
    const native = {
      async evaluate<T>(callback: (element: SnapshotNode) => T) { return callback(node); },
      async click() {}, async fill() {},
      async dispose() { disposed.push(index); },
    };
    return { node, native };
  });
  const snapshot = createSnapshotFrame(elements, content);
  const page = { frames: () => [snapshot.frame] } as unknown as PlaywrightPage;
  return { page, snapshot, disposed };
}

test('snapshot includes readable headings and noninteractive page text without allocating refs', async () => {
  const { page } = contentFixture([]);
  const engine = createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 1 });
  const text = await engine.capture(page);
  assert.ok(text.includes('- text "Ready"'));
  assert.ok(text.includes('Here is the information the agent needs to read.'));
  await assert.rejects(engine.resolve('e1'), /stale/);
});

test('snapshot names native wrapping/for labels and aria-labelledby before fallbacks', async () => {
  const nodes = [
    { labels: [{ textContent: 'Name' }] },
    { labels: [{ textContent: 'Email' }, { textContent: 'address' }] },
    { attributes: { 'aria-labelledby': 'first\tlast', 'aria-label': 'Wrong', placeholder: 'Wrong' }, ownerDocument: { getElementById: (id: string) => ({ textContent: id === 'first' ? 'Account' : 'name' }) } },
  ].map(({ attributes = {}, ...properties }) => ({
    tagName: 'INPUT', textContent: '', getAttribute: (name: string) => (attributes as Record<string, string>)[name] ?? null, ...properties,
  }));
  const { page } = contentFixture(nodes, '');
  const text = await createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 3 }).capture(page);
  assert.equal(text, '- textbox "Name" [ref=e1]\n- textbox "Email address" [ref=e2]\n- textbox "Account name" [ref=e3]\n');
});

test('snapshot reports native input roles, checked states and current values, but not passwords', async () => {
  const nodes = [
    { type: 'checkbox', checked: true },
    { type: 'checkbox', checked: false, indeterminate: true },
    { type: 'radio', checked: false },
    { type: 'text', value: 'Ada "Lovelace"' },
    { type: 'password', value: 'secret' },
    { type: 'number', value: '42' },
    { type: 'search', value: 'query' },
  ].map(({ type, ...properties }) => ({ tagName: 'INPUT', textContent: '', getAttribute: (name: string) => name === 'type' ? type : null, ...properties }));
  const { page } = contentFixture(nodes, '');
  const text = await createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 10 }).capture(page);
  assert.ok(text.includes('- checkbox "" [ref=e1] [checked=true]'));
  assert.ok(text.includes('- checkbox "" [ref=e2] [checked=mixed]'));
  assert.ok(text.includes('- radio "" [ref=e3] [checked=false]'));
  assert.ok(text.includes('- textbox "" [ref=e4] [value="Ada \\"Lovelace\\""]'));
  assert.ok(!text.includes('secret'));
  assert.ok(text.includes('- spinbutton "" [ref=e6] [value="42"]'));
  assert.ok(text.includes('- searchbox "" [ref=e7] [value="query"]'));
});

test('readable content shares the byte limit and retires previously issued refs', async () => {
  const node = { tagName: 'BUTTON', textContent: 'Save', getAttribute: () => null };
  const fixture = contentFixture([node], '');
  const engine = createSnapshotEngine({ maxSnapshotBytes: 64, maxSnapshotRefs: 1 });
  await engine.capture(fixture.page);
  await assert.rejects(engine.capture(contentFixture([], '😀'.repeat(20)).page), /byte limit/);
  assert.deepEqual(fixture.disposed, []);
  assert.deepEqual(fixture.snapshot.acquiredElements, []);
  assert.deepEqual(fixture.snapshot.disposedCapsules, fixture.snapshot.capsules);
  assert.equal(fixture.snapshot.disposedCapsules.length, 1);
  await assert.rejects(engine.resolve('e1'), /stale/);
});

function fixture() {
  const actions: string[] = [];
  const nodes = [0, 1, 2].map(index => {
    const node = { connected: true, get isConnected() { return this.connected; }, tagName: 'BUTTON', textContent: 'Same', getAttribute: () => null };
    return {
      node,
      async evaluate<T>(callback: (node: SnapshotNode) => T) { return callback(node); },
      async click() { actions.push(`click:${index}`); }, async fill(value: string) { actions.push(`fill:${index}:${value}`); }, async dispose() { actions.push(`dispose:${index}`); },
    };
  });
  const snapshots = [nodes.slice(0, 2), nodes.slice(2)].map(handles => createSnapshotFrame(handles.map(native => ({ node: native.node, native }))));
  const page = { frames: () => snapshots.map(snapshot => snapshot.frame) } as unknown as PlaywrightPage;
  return { page, nodes, actions, snapshots };
}

test('invalidation rejects refs immediately but defers disposal through action settlement', async () => {
  const current = fixture();
  const engine = createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 10 });
  await engine.capture(current.page);
  await engine.withReferences(async () => {
    const handle = await engine.resolve('e1');
    await engine.invalidate();
    await engine.invalidate();
    await assert.rejects(engine.resolve('e1'), /stale/);
    assert.deepEqual(current.actions, []);
    assert.ok(current.snapshots.every(snapshot => snapshot.disposedCapsules.length === 0));
    await handle.click();
  });
  assert.deepEqual(current.actions, ['click:0', 'dispose:0']);
  assert.ok(current.snapshots.every(snapshot => snapshot.disposedCapsules.length === 1));
  await engine.invalidate();
  assert.equal(current.actions.length, 2);
});

test('failed actions drain deferred handles and preserve action and disposal errors', async () => {
  const current = fixture();
  const actionError = new Error('action failed');
  const cleanupError = new Error('disposal failed');
  current.nodes[0]!.dispose = async () => { throw cleanupError; };
  const engine = createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 10 });
  await engine.capture(current.page);
  await assert.rejects(engine.withReferences(async () => {
    await engine.resolve('e1');
    await engine.invalidate();
    throw actionError;
  }), error => error instanceof AggregateError && error.errors[0] === actionError
    && error.errors[1] instanceof AggregateError && error.errors[1].errors.includes(cleanupError));
  assert.deepEqual(current.actions, []);
  assert.ok(current.snapshots.every(snapshot => snapshot.disposedCapsules.length === 1));
});

test('shared snapshot binds identical elements and frames to distinct handles, without ARIA refs', async () => {
  const f = fixture();
  const engine = createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 10 });
  const text = await engine.capture(f.page);
  assert.equal(text, '- button "Same" [ref=e1]\n- button "Same" [ref=e2]\n- button "Same" [ref=e3]\n');
  assert.ok(f.snapshots.every(snapshot => snapshot.acquiredElements.length === 0));
  await (await engine.resolve('e2')).click();
  await (await engine.resolve('e3')).fill('quoted value');
  assert.deepEqual(f.actions, ['click:1', 'fill:2:quoted value']);
  f.nodes[1]!.node.connected = false;
  await assert.rejects(engine.resolve('e2'), /stale/);
  await engine.invalidate();
  await assert.rejects(engine.resolve('e1'), /stale/);
});

test('snapshot limits fail closed, retire all acquired handles, and never reuse old refs', async () => {
  const f = fixture();
  const engine = createSnapshotEngine({ maxSnapshotBytes: 1, maxSnapshotRefs: 10 });
  await assert.rejects(engine.capture(f.page), /limit/);
  assert.deepEqual(f.actions, []);
  assert.equal(f.snapshots[0]!.disposedCapsules.length, 1);
  assert.ok(f.snapshots.every(snapshot => snapshot.acquiredElements.length === 0));
  await assert.rejects(engine.resolve('e1'), /stale/);
  const refs = createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 1 });
  await assert.rejects(refs.capture(f.page), /limit/);
  await assert.rejects(refs.resolve('e1'), /stale/);
});

test('plain ARIA snapshots cannot establish actionable refs', async () => {
  const engine = createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 10 });
  const page = { locator: () => ({ ariaSnapshot: async () => '- button "Same" [ref=e15]' }) } as unknown as PlaywrightPage;
  await assert.rejects(engine.capture(page), /unsupported/i);
  await assert.rejects(engine.resolve('e15'), /stale/);
});

test('invalid limits and overlapping navigation during capture fail closed', async () => {
  for (const limits of [{ maxSnapshotBytes: 0, maxSnapshotRefs: 1 }, { maxSnapshotBytes: 1, maxSnapshotRefs: Infinity }]) assert.throws(() => createSnapshotEngine(limits), /limit/i);
  const f = fixture();
  const engine = createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 10 });
  const frame = f.snapshots[0]!.frame;
  const original = frame.evaluateHandle.bind(frame);
  frame.evaluateHandle = async (callback, input) => {
    const capsule = await original(callback, input);
    await engine.invalidate();
    return capsule;
  };
  await assert.rejects(engine.capture(f.page), /stale/);
  await assert.rejects(engine.resolve('e1'), /stale/);
  assert.deepEqual(f.actions, []);
  assert.equal(f.snapshots[0]!.disposedCapsules.length, 1);
  for (const snapshot of f.snapshots) assert.deepEqual(snapshot.disposedCapsules, snapshot.capsules);
});

test('invalidation drains asynchronous disposal and preserves disposal failures for owner cleanup', async () => {
  const f = fixture();
  const engine = createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 10 });
  await engine.capture(f.page);
  await engine.resolve('e1');
  const error = new Error('dispose failed');
  f.nodes[0]!.dispose = async () => { throw error; };
  await assert.rejects(engine.invalidate(), /disposal failed/);
  await assert.rejects(engine.invalidate(), /disposal failed/);
  await assert.rejects(engine.resolve('e1'), /stale/);
});

test('failed snapshot capture preserves both its limit error and capsule cleanup errors', async () => {
  const f = fixture();
  const cleanup = new Error('handle cleanup failed');
  const frame = f.snapshots[0]!.frame;
  const original = frame.evaluateHandle.bind(frame);
  frame.evaluateHandle = async (callback, input) => {
    const capsule = await original(callback, input);
    capsule.dispose = async () => { throw cleanup; };
    return capsule;
  };
  const engine = createSnapshotEngine({ maxSnapshotBytes: 1, maxSnapshotRefs: 10 });
  await assert.rejects(engine.capture(f.page), error => error instanceof AggregateError && error.errors.some((cause: unknown) => cause === cleanup) && error.errors.some((cause: unknown) => cause instanceof Error && cause.message.includes('limit')));
});

test('snapshot limits are retained independently of later caller mutation', async () => {
  const f = fixture(); const limits = { maxSnapshotBytes: 1, maxSnapshotRefs: 10 };
  const engine = createSnapshotEngine(limits);
  limits.maxSnapshotBytes = Infinity;
  await assert.rejects(engine.capture(f.page), /limit/);
});

test('cancelled snapshots stop admission before public handle acquisition', async () => {
  const f = fixture(); const engine = createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 10 });
  const abort = new AbortController(); abort.abort(new Error('snapshot cancelled'));
  await assert.rejects(engine.capture(f.page, abort.signal), /snapshot cancelled/);
  assert.deepEqual(f.actions, []);
});
