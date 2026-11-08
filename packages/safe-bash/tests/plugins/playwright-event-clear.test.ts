import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { PlaywrightAbilityRequest } from '../../src/playwright/abilities.js';
import type { PlaywrightContext, PlaywrightPage } from '../../src/playwright/adapter.js';
import { flushPlaywrightConsole, observePlaywrightCapabilities, playwrightEventAbilities } from '../../src/playwright/capability-events.js';
import { serializePlaywrightResult } from '../../src/playwright/response.js';

function fixture(maxCommandBytes = 4096) {
  const context = new EventEmitter() as EventEmitter & PlaywrightContext;
  const page = {} as PlaywrightPage;
  const otherPage = {} as PlaywrightPage;
  const cleanups: (() => Promise<void>)[] = [];
  const artifacts: string[] = [];
  observePlaywrightCapabilities(context, cleanup => cleanups.push(cleanup), { maxCommandBytes, maxArtifactBytes: 4096 });
  const emitConsole = (text: string, selectedPage = page) => context.emit('console', {
    page: () => selectedPage, type: () => 'log', text: () => text,
    location: () => ({ url: '', lineNumber: 0, columnNumber: 0 }),
  });
  const emitRequest = (url: string, selectedPage = page) => {
    const request = { url: () => url, method: () => 'GET', resourceType: () => 'fetch', headers: () => ({}),
      postData: () => null, failure: () => null, isNavigationRequest: () => false,
      frame: () => ({ page: () => selectedPage, parentFrame: () => null }) };
    context.emit('request', request);
    return request;
  };
  const run = (command: 'console' | 'requests' | 'request', options: PlaywrightAbilityRequest['options'] = {}, selectedPage = page, args: string[] = []) => playwrightEventAbilities[command]!.execute({
    command, args, options, session: 'owned', signal: new AbortController().signal,
    browserSession: { context, page: selectedPage, registerCleanup() {}, resolveTarget: async () => { throw new Error('unused'); }, selectPage: async () => {} },
    write: async () => {}, readFile: async () => new Uint8Array(),
    writeArtifact: async bytes => { artifacts.push(new TextDecoder().decode(bytes)); }, registerCleanup() {},
  });
  return { context, page, otherPage, emitConsole, emitRequest, run, artifacts, async close() { for (const cleanup of cleanups) await cleanup(); } };
}

for (const command of ['console', 'requests'] as const) {
  test(`${command} --clear clears only the selected page and returns the pinned empty result`, async () => {
    const state = fixture();
    try {
      if (command === 'console') {
        state.emitConsole('before-clear'); state.emitConsole('other-page', state.otherPage);
      } else {
        state.emitRequest('https://example.com/before-clear'); state.emitRequest('https://example.com/other-page', state.otherPage);
      }
      assert.match(JSON.stringify(await state.run(command)), /before-clear/);
      const cleared = await state.run(command, { clear: true });
      assert.deepEqual(cleared, { sections: [] });
      assert.equal(serializePlaywrightResult(cleared!, { json: true, raw: false }), '{}\n');
      assert.equal(serializePlaywrightResult(cleared!, { json: false, raw: true }), '\n');
      assert.doesNotMatch(JSON.stringify(await state.run(command)), /before-clear/);
      assert.match(JSON.stringify(await state.run(command, {}, state.otherPage)), /other-page/);
      assert.deepEqual(await state.run(command, { clear: true }), { sections: [] });
      assert.deepEqual(state.artifacts, []);
    } finally { await state.close(); }
  });
}

test('request clear resets numbering and discards responses to cleared native requests', async () => {
  const state = fixture();
  try {
    const previous = state.emitRequest('https://example.com/previous');
    await state.run('requests', { clear: true });
    state.context.emit('response', { request: () => previous, status: () => 200, statusText: () => 'OK', headers: () => ({}) });
    await assert.rejects(state.run('request', {}, state.page, ['1']), { message: 'Request #1 not found. Use browser_network_requests to see available indexes.' });
    state.emitRequest('https://example.com/next');
    assert.match(JSON.stringify(await state.run('requests')), /1\. \[GET\] https:\/\/example.com\/next/);
    assert.match(JSON.stringify(await state.run('request', {}, state.page, ['1'])), /example.com\/next/);
  } finally { await state.close(); }
});

test('console clear preserves unseen later entries without republishing old artifact content', async () => {
  const state = fixture();
  const content: string[] = [];
  const publication = { writeArtifact: async (bytes: Uint8Array) => { content.push(new TextDecoder().decode(bytes)); } };
  try {
    state.emitConsole('before-clear');
    await flushPlaywrightConsole(state.context, state.page, publication);
    await state.run('console', { clear: true });
    assert.equal(await flushPlaywrightConsole(state.context, state.page, publication), undefined);
    state.emitConsole('after-clear');
    await flushPlaywrightConsole(state.context, state.page, publication);
    assert.equal(content.length, 2);
    assert.match(content[1]!, /after-clear/);
    assert.doesNotMatch(content[1]!, /before-clear/);
  } finally { await state.close(); }
});

test('console clear releases shared retention bytes rather than evicting another page later', async () => {
  const state = fixture(50);
  try {
    state.emitConsole('a'.repeat(20)); state.emitConsole('b'.repeat(20), state.otherPage);
    await state.run('console', { clear: true });
    state.emitConsole('c'.repeat(20));
    assert.match(JSON.stringify(await state.run('console', {}, state.otherPage)), /bbbbbbbbbbbbbbbbbbbb/);
    assert.match(JSON.stringify(await state.run('console')), /cccccccccccccccccccc/);
  } finally { await state.close(); }
});

test('clearing empty pages and negated clear flags are safe', async () => {
  const state = fixture();
  try {
    assert.deepEqual(await state.run('console', { clear: true }), { sections: [] });
    assert.deepEqual(await state.run('requests', { clear: true }), { sections: [] });
    state.emitConsole('retained'); state.emitRequest('https://example.com/retained');
    assert.match(JSON.stringify(await state.run('console', { clear: false })), /retained/);
    assert.match(JSON.stringify(await state.run('requests', { clear: false })), /retained/);
  } finally { await state.close(); }
});
