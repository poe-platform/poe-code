import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { getPlaywrightModal, observePlaywrightModals, onPlaywrightModal, playwrightModalAbilities } from '../../src/playwright/modal-capabilities.js';
import type { PlaywrightAbilityRequest } from '../../src/playwright/abilities.js';
import type { PlaywrightContext, PlaywrightPage } from '../../src/playwright/adapter.js';

function fixture() {
  const context = new EventEmitter() as EventEmitter & PlaywrightContext;
  const frame = {};
  const page = Object.assign(new EventEmitter(), { mainFrame: () => frame }) as unknown as EventEmitter & PlaywrightPage;
  context.pages = () => [page];
  const cleanups: (() => Promise<void>)[] = [];
  observePlaywrightModals(context, close => cleanups.push(close));
  const effects: unknown[] = [];
  const dialog = { page: () => page, type: () => 'prompt', message: () => 'Enter text', defaultValue: () => '', accept: async (value?: string) => { effects.push(['accept', value]); }, dismiss: async () => { effects.push(['dismiss']); } };
  const files = new Map<string, Uint8Array>();
  const request = (command: PlaywrightAbilityRequest['command'], args: string[] = []): PlaywrightAbilityRequest => ({
    command, args, options: {}, session: 's', signal: new AbortController().signal,
    limits: { maxCommandBytes: 128, maxArtifactBytes: 128 },
    browserSession: { context, page: new Proxy(page, {}), registerCleanup() {}, resolveTarget: async () => { throw new Error('unused'); }, selectPage: async () => {} },
    write: async () => {}, readFile: async name => { const bytes = files.get(name); if (!bytes) throw new Error('missing'); return bytes; }, writeArtifact: async () => {}, registerCleanup() {},
  });
  return { context, page, dialog, cleanups, effects, files, request };
}

test('dialog handling observes native state through wrappers and notifies successful clearing', async () => {
  const f = fixture();
  const events: unknown[] = [];
  const unsubscribe = onPlaywrightModal(f.page, modal => events.push(modal?.kind));
  f.context.emit('dialog', f.dialog);
  assert.equal(getPlaywrightModal(new Proxy(f.page, {}))?.kind, 'dialog');
  await playwrightModalAbilities['dialog-accept']!.execute(f.request('dialog-accept', ['answer']));
  assert.deepEqual(f.effects, [['accept', 'answer']]);
  assert.deepEqual(events, ['dialog', undefined]);
  await assert.rejects(playwrightModalAbilities['dialog-dismiss']!.execute(f.request('dialog-dismiss')), /No dialog/);
  f.context.emit('dialog', f.dialog);
  await playwrightModalAbilities['dialog-dismiss']!.execute(f.request('dialog-dismiss'));
  assert.deepEqual(f.effects[1], ['dismiss']);
  unsubscribe();
  for (const close of f.cleanups) await close();
  assert.deepEqual(f.context.eventNames(), []);
  assert.deepEqual(f.page.eventNames(), []);
});

test('failed modal handling retains native state for retry and new pages are observed', async () => {
  const f = fixture();
  f.context.emit('dialog', { ...f.dialog, accept: async () => { throw new Error('native failed'); } });
  await assert.rejects(playwrightModalAbilities['dialog-accept']!.execute(f.request('dialog-accept')), /native failed/);
  assert.equal(getPlaywrightModal(f.page)?.kind, 'dialog');
  const other = new EventEmitter() as EventEmitter & PlaywrightPage;
  f.context.emit('page', other);
  other.emit('filechooser', { page: () => other, isMultiple: () => false, setFiles: async () => {} });
  assert.equal(getPlaywrightModal(other)?.kind, 'filechooser');
  for (const close of f.cleanups) await close();
  assert.equal(getPlaywrightModal(other), undefined);
  assert.deepEqual(other.eventNames(), []);
});

test('upload reads virtual file bytes, prepares native buffers and retains chooser on failed admission', async () => {
  const f = fixture();
  const payloads: unknown[] = [];
  const chooser = { page: () => f.page, isMultiple: () => true, setFiles: async (files: unknown[]) => { payloads.push(files); } };
  f.page.emit('filechooser', chooser);
  f.files.set('/virtual/input.txt', Uint8Array.of(0, 255, 1));
  const request = f.request('upload', ['/virtual/input.txt']);
  let prepared = 0;
  const nativeRequest = { ...request, browserSession: { ...request.browserSession!, prepareFileBytes: (bytes: Uint8Array) => { prepared++; return Buffer.from(bytes); } } };
  await playwrightModalAbilities.upload!.execute(nativeRequest);
  assert.equal(prepared, 1);
  assert.deepEqual(payloads, [[{ name: 'input.txt', mimeType: '', buffer: Buffer.from([0, 255, 1]) }]]);
  assert.equal(getPlaywrightModal(f.page), undefined);
  f.page.emit('filechooser', chooser);
  f.files.set('/virtual/input.txt', new Uint8Array(129));
  await assert.rejects(playwrightModalAbilities.upload!.execute(nativeRequest), /byte limit/);
  assert.equal(getPlaywrightModal(f.page)?.kind, 'filechooser');
  assert.equal(prepared, 1);
  assert.equal(payloads.length, 1);
  for (const close of f.cleanups) await close();
});
