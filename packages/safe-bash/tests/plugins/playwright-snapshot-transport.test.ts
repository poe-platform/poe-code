import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSnapshotEngine } from '../../src/playwright/snapshot.js';
import type { PlaywrightPage, SnapshotNode } from '../../src/playwright/adapter.js';
import type { FrameSnapshotCapsule, FrameSnapshotInput } from '../../src/playwright/frame-snapshot.js';

function fixture(text = '- button "Save" [ref=e1]\n') {
  const events: string[] = [];
  const inputs: FrameSnapshotInput[] = [];
  const node: SnapshotNode = { tagName: 'BUTTON', textContent: 'Save', isConnected: true, getAttribute: () => null };
  const native = {
    async evaluate<Result>(callback: (value: SnapshotNode) => Result) { events.push('native-evaluate'); return callback(node); },
    async click() { events.push('click'); }, async fill() { events.push('fill'); }, async dispose() { events.push('native-dispose'); },
  };
  const capsule: FrameSnapshotCapsule = { nodes: [node], count: 1, status: 'ok', render: () => ({ status: 'ok', text }) };
  const handle = {
    async evaluate<Result, Arg>(callback: (value: FrameSnapshotCapsule, arg: Arg) => Result, arg: Arg) { return callback(capsule, arg); },
    async evaluateHandle(callback: (value: FrameSnapshotCapsule, slot: number) => SnapshotNode | undefined, slot: number) {
      assert.equal(callback(capsule, slot), node);
      events.push('unwrap');
      return { asElement: () => native, dispose: native.dispose };
    },
    async dispose() { events.push('capsule-dispose'); },
  };
  const frame = {
    locator() { throw new Error('Unbounded locator acquisition is forbidden'); },
    async evaluateHandle(_callback: unknown, input: FrameSnapshotInput) { inputs.push(input); return handle; },
  };
  const page = { frames: () => [frame] } as unknown as PlaywrightPage;
  return { events, inputs, node, native, capsule, handle, frame, page };
}

test('snapshot keeps nodes in a non-node capsule and unwraps only the selected action ref', async () => {
  const current = fixture();
  const engine = createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 3 });
  assert.equal(await engine.capture(current.page), '- button "Save" [ref=e1]\n');
  assert.deepEqual(current.inputs, [{ maxSnapshotBytes: 1024, maxSnapshotRefs: 3 }]);
  assert.deepEqual(current.events, []);
  await (await engine.resolve('e1')).click();
  await engine.resolve('e1');
  assert.equal(current.events.filter(event => event === 'unwrap').length, 1);
  await engine.invalidate();
  assert.equal(current.events.filter(event => event === 'capsule-dispose').length, 1);
  assert.equal(current.events.filter(event => event === 'native-dispose').length, 1);
});

test('snapshot admits each frame against the remaining aggregate bytes and refs', async () => {
  const first = fixture('first\n'); const second = fixture('second\n');
  const page = { frames: () => [first.frame, second.frame] } as unknown as PlaywrightPage;
  const engine = createSnapshotEngine({ maxSnapshotBytes: 20, maxSnapshotRefs: 2 });
  assert.equal(await engine.capture(page), 'first\nsecond\n');
  assert.deepEqual(second.inputs, [{ maxSnapshotBytes: 14, maxSnapshotRefs: 1 }]);
  await engine.invalidate();
  assert.deepEqual(first.events, ['capsule-dispose']);
  assert.deepEqual(second.events, ['capsule-dispose']);
});

test('bounded browser rejection disposes capsules without exporting nodes or partial text', async () => {
  const current = fixture();
  current.capsule.render = () => ({ status: 'byte-limit', text: '' });
  const engine = createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 3 });
  await assert.rejects(engine.capture(current.page), /Snapshot byte limit exceeded/);
  assert.deepEqual(current.events, ['capsule-dispose']);
  await assert.rejects(engine.resolve('e1'), /stale/);
});

test('host validates capsule counts and rendered UTF-8 budget independently', async () => {
  for (const text of ['x'.repeat(33), '😀'.repeat(9)]) {
    const current = fixture(text);
    const engine = createSnapshotEngine({ maxSnapshotBytes: 32, maxSnapshotRefs: 1 });
    await assert.rejects(engine.capture(current.page), /byte limit/);
    assert.deepEqual(current.events, ['capsule-dispose']);
  }
  const current = fixture();
  Object.assign(current.capsule, { count: 2 });
  await assert.rejects(createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 1 }).capture(current.page), /ref limit/);
  assert.deepEqual(current.events, ['capsule-dispose']);
});

test('late native handles are disposed if navigation invalidates their capsule during acquisition', async () => {
  const current = fixture();
  const engine = createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 1 });
  await engine.capture(current.page);
  const unwrap = current.handle.evaluateHandle;
  current.handle.evaluateHandle = async (...args) => {
    const result = await unwrap(...args);
    await engine.invalidate();
    return result;
  };
  await assert.rejects(engine.resolve('e1'), /stale/);
  assert.deepEqual(current.events, ['unwrap', 'capsule-dispose', 'native-dispose']);
});

test('text-only capsules stay owned until invalidation even when no refs are issued', async () => {
  const current = fixture('text\n');
  Object.assign(current.capsule, { count: 0, nodes: [] });
  const engine = createSnapshotEngine({ maxSnapshotBytes: 1024, maxSnapshotRefs: 1 });
  assert.equal(await engine.capture(current.page), 'text\n');
  await engine.invalidate();
  assert.deepEqual(current.events, ['capsule-dispose']);
});
