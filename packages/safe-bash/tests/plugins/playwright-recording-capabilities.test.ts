import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playwrightRecordingAbilities } from '../../src/playwright/recording-capabilities.js';
import type { PlaywrightAbilityRequest } from '../../src/playwright/abilities.js';
import type { PlaywrightContext, PlaywrightPage, PlaywrightRecorderSink } from '../../src/playwright/adapter.js';
import { PlaywrightResourceLimitError } from '../../src/playwright/resource-limit.js';

for (const legacy of [false, true]) test(`native action recording uses ${legacy ? 'pinned legacy' : 'modern'} recorder and preserves event updates`, async () => {
  let sink: PlaywrightRecorderSink | undefined;
  let starts: unknown, stopped = 0;
  const context = {
    [legacy ? '_enableRecorder' : '_startRecording']: async (options: unknown, events: PlaywrightRecorderSink) => { starts = options; sink = events; },
    [legacy ? '_disableRecorder' : '_stopRecording']: async () => { stopped++; },
  } as unknown as PlaywrightContext;
  const cleanups: (() => Promise<void>)[] = [];
  const request = (command: PlaywrightAbilityRequest['command']): PlaywrightAbilityRequest => ({ command, args: [], options: {}, signal: new AbortController().signal, session: 's',
    browserSession: { context, page: undefined, registerCleanup: close => cleanups.push(close), selectPage: async () => {}, resolveTarget: async () => { throw new Error('unused'); } },
    registerCleanup() {}, write: async () => {}, readFile: async () => new Uint8Array(), writeArtifact: async () => {},
  });
  await playwrightRecordingAbilities['recording-start'].execute(request('recording-start'));
  assert.deepEqual(starts, { language: 'playwright-test', ...(legacy ? { mode: 'recording', recorderMode: 'api' } : {}) });
  const page = {} as PlaywrightPage;
  sink!.actionAdded(page, {}, "await page.getByRole('button').click();");
  sink!.actionUpdated(page, {}, "await page.getByRole('button', {name: 'Save'}).click();");
  const result = await playwrightRecordingAbilities['recording-stop'].execute(request('recording-stop'));
  assert.match(JSON.stringify(result), /Recorded actions[\s\S]*Save/);
  assert.equal(stopped, 1);
  for (const close of cleanups) await close();
  assert.equal(stopped, 1);
});

test('native recorder stops on output overflow and cleanup remains idempotent', async () => {
  let sink: PlaywrightRecorderSink | undefined, stopped = 0;
  const context = { _startRecording: async (_options: unknown, events: PlaywrightRecorderSink) => { sink = events; }, _stopRecording: async () => { stopped++; } } as PlaywrightContext;
  const cleanups: (() => Promise<void>)[] = [];
  const request: PlaywrightAbilityRequest = { command: 'recording-start', args: [], options: {}, signal: new AbortController().signal, session: 's', limits: { maxCommandBytes: 10, maxArtifactBytes: 10 },
    browserSession: { context, page: undefined, registerCleanup: close => cleanups.push(close), selectPage: async () => {}, resolveTarget: async () => { throw new Error('unused'); } },
    registerCleanup() {}, write: async () => {}, readFile: async () => new Uint8Array(), writeArtifact: async () => {},
  };
  await playwrightRecordingAbilities['recording-start'].execute(request);
  sink!.actionAdded({} as PlaywrightPage, {}, 'x'.repeat(11));
  await assert.rejects(playwrightRecordingAbilities['recording-stop'].execute({ ...request, command: 'recording-stop' }), PlaywrightResourceLimitError);
  for (const close of cleanups) await close();
  assert.equal(stopped, 1);
});
