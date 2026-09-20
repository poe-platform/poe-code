import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { collectPlaywrightDownloads, observePlaywrightDownloads } from '../../src/playwright/download-capabilities.js';
import type { PlaywrightContext, PlaywrightPage } from '../../src/playwright/adapter.js';
import { PlaywrightResourceLimitError } from '../../src/playwright/resource-limit.js';

for (const outputDir of [undefined, '/reports']) test(`native downloads use owned artifact transport with a sanitized name under ${outputDir ?? 'default output'}`, async () => {
  const context = new EventEmitter() as EventEmitter & PlaywrightContext;
  const frame = {};
  const page = Object.assign(new EventEmitter(), { mainFrame: () => frame }) as unknown as EventEmitter & PlaywrightPage;
  context.pages = () => [page];
  const cleanups: (() => Promise<void>)[] = [], effects: unknown[] = [];
  observePlaywrightDownloads(context, close => cleanups.push(close));
  page.emit('download', { suggestedFilename: () => '../../native.bin', saveAs: async (path: string) => { effects.push(path); }, cancel: async () => { effects.push('cancel'); }, delete: async () => { effects.push('delete'); } });
  const artifacts = await collectPlaywrightDownloads(new Proxy(page, {}), async (produce, options) => {
    assert.equal(options.extension, 'bin');
    await produce('/private/download-unique.bin'); return Uint8Array.of(0, 255, 1);
  }, { signal: new AbortController().signal, maxBytes: 128, ...(outputDir === undefined ? {} : { configuration: { outputDir } }) });
  assert.equal(artifacts.length, 1);
  assert.ok(artifacts[0]!.filename.startsWith(`${outputDir ?? '.playwright-cli'}/download-`));
  assert.ok(artifacts[0]!.filename.endsWith('-native.bin'));
  assert.deepEqual([...artifacts[0]!.bytes], [0, 255, 1]);
  assert.deepEqual(effects, ['/private/download-unique.bin', 'delete']);
  for (const close of cleanups) await close();
  assert.deepEqual(context.eventNames(), []);
  assert.deepEqual(page.eventNames(), []);
});

test('download overflow retires its native download and queued downloads cancel on observer disposal', async () => {
  const context = new EventEmitter() as EventEmitter & PlaywrightContext;
  const page = new EventEmitter() as EventEmitter & PlaywrightPage;
  context.pages = () => [page];
  const cleanups: (() => Promise<void>)[] = [], effects: string[] = [];
  observePlaywrightDownloads(context, close => cleanups.push(close));
  const download = { suggestedFilename: () => 'large.bin', saveAs: async () => {}, cancel: async () => { effects.push('cancel'); }, delete: async () => { effects.push('delete'); } };
  page.emit('download', download);
  await assert.rejects(collectPlaywrightDownloads(page, async produce => { await produce('/private/only'); return new Uint8Array(11); }, { signal: new AbortController().signal, maxBytes: 10 }), PlaywrightResourceLimitError);
  assert.deepEqual(effects, ['cancel', 'delete']);
  page.emit('download', download);
  for (const close of cleanups) await close();
  assert.deepEqual(effects, ['cancel', 'delete', 'cancel', 'delete']);
});

test('provider download transport overrides native filesystem capture and retains cleanup on unsupported retrieval', async () => {
  const context = new EventEmitter() as EventEmitter & PlaywrightContext;
  const page = new EventEmitter() as EventEmitter & PlaywrightPage;
  context.pages = () => [page];
  const cleanups: (() => Promise<void>)[] = [], effects: string[] = [];
  observePlaywrightDownloads(context, close => cleanups.push(close));
  const download = { suggestedFilename: () => 'remote.bin', saveAs: async () => { throw new Error('must not read host path'); }, cancel: async () => { effects.push('cancel'); }, delete: async () => { effects.push('delete'); } };
  page.emit('download', download);
  await assert.rejects(collectPlaywrightDownloads(page, undefined, { signal: new AbortController().signal, maxBytes: 10 }, async (native, options) => {
    assert.equal(native, download);
    assert.equal(options.maxBytes, 10);
    throw new Error('Playwright provider does not support download artifact retrieval');
  }), /provider does not support download artifact retrieval/);
  assert.deepEqual(effects, ['cancel', 'delete']);
  page.emit('download', download);
  const captured = await collectPlaywrightDownloads(page, undefined, { signal: new AbortController().signal, maxBytes: 10 }, async () => Uint8Array.of(0, 255));
  assert.deepEqual([...captured[0]!.bytes], [0, 255]);
  for (const close of cleanups) await close();
});

test('download retention overflow stops admission before later native events can retain more work', async () => {
  const context = new EventEmitter() as EventEmitter & PlaywrightContext;
  const page = new EventEmitter() as EventEmitter & PlaywrightPage;
  context.pages = () => [page];
  const cleanups: (() => Promise<void>)[] = [];
  let cancelled = 0, deleted = 0;
  observePlaywrightDownloads(context, close => cleanups.push(close), { maxCount: 1 });
  const download = { suggestedFilename: () => 'data.bin', saveAs: async () => {}, cancel: async () => { cancelled++; }, delete: async () => { deleted++; } };
  page.emit('download', download);
  page.emit('download', download);
  assert.equal(page.listenerCount('download'), 0);
  for (let index = 0; index < 100; index++) page.emit('download', download);
  await assert.rejects(collectPlaywrightDownloads(page, undefined, { signal: new AbortController().signal, maxBytes: 10 }), PlaywrightResourceLimitError);
  await Promise.all(cleanups.map(close => close()));
  assert.equal(cancelled, 2);
  assert.equal(deleted, 2);
});
