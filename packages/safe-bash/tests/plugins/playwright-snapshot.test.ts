import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSnapshotEngine } from '../../src/playwright/snapshot.js';
import type { PlaywrightPage } from '../../src/playwright/adapter.js';

function fixture() {
  const actions: string[] = [];
  const nodes = [0, 1, 2].map(index => ({
    connected: true,
    async evaluate(fn: (node: unknown) => unknown) { return fn({ isConnected: this.connected, tagName: 'BUTTON', textContent: 'Same', getAttribute: () => null }); },
    async click() { actions.push(`click:${index}`); }, async fill(value: string) { actions.push(`fill:${index}:${value}`); }, async dispose() { actions.push(`dispose:${index}`); },
  }));
  const page = { frames: () => [ { locator: () => ({ elementHandles: async () => nodes.slice(0, 2) }) }, { locator: () => ({ elementHandles: async () => nodes.slice(2) }) } ] } as unknown as PlaywrightPage;
  return { page, nodes, actions };
}

test('shared snapshot binds identical elements and frames to distinct handles, without ARIA refs', async () => {
  const f = fixture();
  const engine = createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 10 });
  const text = await engine.capture(f.page);
  assert.equal(text, '- button "Same" [ref=e1]\n- button "Same" [ref=e2]\n- button "Same" [ref=e3]\n');
  await (await engine.resolve('e2')).click();
  await (await engine.resolve('e3')).fill('quoted value');
  assert.deepEqual(f.actions, ['click:1', 'fill:2:quoted value']);
  f.nodes[1]!.connected = false;
  await assert.rejects(engine.resolve('e2'), /stale/);
  await engine.invalidate();
  await assert.rejects(engine.resolve('e1'), /stale/);
});

test('snapshot limits fail closed, retire all acquired handles, and never reuse old refs', async () => {
  const f = fixture();
  const engine = createSnapshotEngine({ maxSnapshotBytes: 1, maxSnapshotRefs: 10 });
  await assert.rejects(engine.capture(f.page), /limit/);
  assert.equal(f.actions.filter(a => a.startsWith('dispose:')).length, 2);
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
  const original = f.nodes[0]!.evaluate.bind(f.nodes[0]);
  f.nodes[0]!.evaluate = async fn => { await engine.invalidate(); return original(fn); };
  await assert.rejects(engine.capture(f.page), /stale/);
  await assert.rejects(engine.resolve('e1'), /stale/);
  assert.equal(f.actions.filter(a => a.startsWith('dispose:')).length, 3);
});

test('invalidation drains asynchronous disposal and preserves disposal failures for owner cleanup', async () => {
  const f = fixture();
  const engine = createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 10 });
  await engine.capture(f.page);
  const error = new Error('dispose failed');
  f.nodes[0]!.dispose = async () => { throw error; };
  await assert.rejects(engine.invalidate(), /disposal failed/);
  await assert.rejects(engine.invalidate(), /disposal failed/);
  await assert.rejects(engine.resolve('e1'), /stale/);
});

test('failed snapshot capture preserves both its limit error and handle cleanup errors', async () => {
  const f = fixture();
  const cleanup = new Error('handle cleanup failed');
  f.nodes[0]!.dispose = async () => { throw cleanup; };
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
