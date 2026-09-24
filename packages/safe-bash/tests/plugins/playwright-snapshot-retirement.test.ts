import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureNativePlaywrightJSON } from '../../src/playwright/native-json-snapshot.js';
import { createPlaywrightController } from '../../src/playwright/controller.js';
import type { PlaywrightPage } from '../../src/playwright/adapter.js';

function fixture(limits = {}) {
  let releases = 0;
  let captureFailure: Error | undefined;
  let disposalFailure = false;
  let source = '- button "Save" [ref=e1]';
  const page = {
    async goto() {}, url: () => 'about:blank', on() {}, off() {},
    async ariaSnapshot() { if (captureFailure) throw captureFailure; return source; },
    async ariaSnapshotJSON() { if (captureFailure) throw captureFailure; return [{ role: 'button', name: 'Save', ref: 'e1' }]; },
    locator() { return { async elementHandle() { return {
      async evaluate() { return true; }, async dispose() { if (disposalFailure) throw new Error('disposal failed'); },
    }; } }; },
  } as unknown as PlaywrightPage;
  const controller = createPlaywrightController({ limits, adapter: {
    browsers: { chromium: { headed: false } }, async acquire() { return {
      context: { async newPage() { return page; }, pages: () => [page], async close() {}, on() {}, off() {} },
      onClosed: () => () => {}, async release() { releases++; },
    }; },
  } });
  const run = (args: string[], overrides = {}) => controller.run({ args, env: {}, signal: new AbortController().signal,
    async write() {}, async writeArtifact() {}, ...overrides });
  return { controller, run, page, get releases() { return releases; }, failCapture() { captureFailure = new Error('provider capture failed'); },
    failDisposal() { disposalFailure = true; source = '- button "Next" [ref=e2]'; }, setSource(text: string) { source = text; } };
}

for (const args of [['snapshot'], ['snapshot', '--filename=page.yml'], ['snapshot', '--json'], ['find']]) {
  test(`failed capture retires session: ${args.join(' ')}`, async () => {
    const f = fixture();
    try {
      await f.run(['open']); f.failCapture();
      await assert.rejects(f.run(args), /provider capture failed/);
      assert.equal(f.releases, 1);
      await assert.rejects(f.run(['snapshot']), /Session closed/);
    } finally { await f.controller.dispose(); }
  });
}
for (const args of [['snapshot'], ['snapshot', '--json']]) {
  test(`completed capture preserves session after output refusal: ${args.join(' ')}`, async () => {
    const f = fixture();
    try {
      await f.run(['open']);
      await assert.rejects(f.run(args, { async write() { throw new Error('output refused'); } }), /output refused/);
      assert.equal(f.releases, 0);
      await f.run(['snapshot']);
    } finally { await f.controller.dispose(); }
  });
}
test('completed YAML capture preserves session after artifact budget refusal', async () => {
  const f = fixture({ maxArtifactBytes: 1024 });
  try {
    await f.run(['open']); f.setSource('x'.repeat(2048));
    await assert.rejects(f.run(['snapshot', '--filename=page.yml']), /Artifact byte limit/);
    assert.equal(f.releases, 0);
    await f.run(['snapshot']);
  } finally { await f.controller.dispose(); }
});
for (const args of [['snapshot'], ['snapshot', '--json'], ['find']]) test(`completed snapshot limit refusal preserves session: ${args.join(' ')}`, async () => {
  const f = fixture({ maxSnapshotBytes: 32 });
  try {
    await f.run(['open']); f.setSource('x'.repeat(64));
    await assert.rejects(f.run(args), /Snapshot byte limit/);
    assert.equal(f.releases, 0);
    f.setSource('- main'); await f.run(['snapshot']);
  } finally { await f.controller.dispose(); }
});
test('deferred reference cleanup failure retires a completed capture', async () => {
  const f = fixture();
  try {
    await f.run(['open']); await f.run(['snapshot']); f.failDisposal();
    await assert.rejects(f.run(['snapshot']), /cleanup|disposal/);
    assert.equal(f.releases, 1);
  } finally { await f.controller.dispose().catch(() => {}); }
});

test('native JSON string children survive rewriting and root selection', async () => {
  const f = fixture();
  const tree = [{ role: 'button', ref: 'e1', children: ['Save'] }];
  f.page.ariaSnapshotJSON = async () => tree;
  try {
    for (const root of [undefined, {}]) {
      const result = await captureNativePlaywrightJSON(f.page, { maxBytes: 1024, maxRefs: 1, nextRef: () => 'e101',
        ...(root === undefined ? {} : { root: root as NonNullable<Parameters<typeof captureNativePlaywrightJSON>[1]['root']> }) });
      assert.deepEqual(result.tree, [{ role: 'button', ref: 'e101', children: ['Save'] }]);
    }
  } finally { await f.controller.dispose(); }
});
