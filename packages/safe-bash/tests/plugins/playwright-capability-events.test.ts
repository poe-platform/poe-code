import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { flushPlaywrightConsole, observePlaywrightCapabilities, playwrightEventAbilities } from '../../src/playwright/capability-events.js';
import type { PlaywrightAbilityRequest } from '../../src/playwright/abilities.js';
import type { PlaywrightContext, PlaywrightPage } from '../../src/playwright/adapter.js';

test('automatic console logs honor configured levels while explicit console retains all native message types', async () => {
  const context = new EventEmitter() as EventEmitter & PlaywrightContext;
  const page = {} as PlaywrightPage;
  const cleanups: (() => Promise<void>)[] = [];
  observePlaywrightCapabilities(context, close => cleanups.push(close), { maxCommandBytes: 4096, maxArtifactBytes: 4096 });
  const emit = (type: string, text: string) => context.emit('console', { page: () => page, type: () => type, text: () => text, location: () => ({ url: 'https://example.com', lineNumber: 2, columnNumber: 0 }) });
  emit('table', 'info table'); emit('assert', 'assertion failed'); emit('trace', 'debug trace'); emit('warning', 'first warning');
  const files = new Map<string, string>();
  const options = { configuration: { outputDir: '/reports', console: { level: 'warning' as const } }, writeArtifact: async (bytes: Uint8Array, filename: string) => { files.set(filename, new TextDecoder().decode(bytes)); } };
  const link = await flushPlaywrightConsole(context, page, options);
  assert.match(link!, /^\/reports\/console-.*\.log#L1-L2$/);
  const filename = link!.split('#')[0]!;
  assert.match(files.get(filename)!, /ASSERT.*assertion failed/);
  assert.match(files.get(filename)!, /WARNING.*first warning/);
  assert.doesNotMatch(files.get(filename)!, /info table|debug trace/);
  assert.equal(await flushPlaywrightConsole(context, page, options), undefined);
  emit('error', 'second\nerror');
  assert.equal(await flushPlaywrightConsole(context, page, options), `${filename}#L3-L4`);
  assert.match(files.get(filename)!, /first warning/);
  const result = await playwrightEventAbilities.console!.execute({ command: 'console', args: [], options: {}, session: 's', signal: new AbortController().signal,
    browserSession: { context, page, configuration: options.configuration, registerCleanup() {}, resolveTarget: async () => { throw new Error('unused'); }, selectPage: async () => {} },
    write: async () => {}, readFile: async () => new Uint8Array(), writeArtifact: async () => {}, registerCleanup() {},
  });
  assert.match(JSON.stringify(result), /info table/);
  assert.doesNotMatch(JSON.stringify(result), /debug trace/);
  context.emit('request', { url: () => 'https://example.com/next', method: () => 'GET', resourceType: () => 'document', headers: () => ({}), postData: () => null, failure: () => null, frame: () => ({ page: () => page, parentFrame: () => null }), isNavigationRequest: () => true });
  emit('error', 'new navigation');
  const next = await flushPlaywrightConsole(context, page, options);
  assert.notEqual(next!.split('#')[0], filename);
  assert.match(next!, /#L1$/);
  for (const close of cleanups) await close();
});

test('failed console publication retains unseen entries and cumulative logs respect artifact limits', async () => {
  const context = new EventEmitter() as EventEmitter & PlaywrightContext;
  const page = {} as PlaywrightPage;
  const cleanups: (() => Promise<void>)[] = [];
  observePlaywrightCapabilities(context, close => cleanups.push(close), { maxCommandBytes: 4096, maxArtifactBytes: 100 });
  const emit = (text: string) => context.emit('console', { page: () => page, type: () => 'log', text: () => text, location: () => ({ url: '', lineNumber: 0, columnNumber: 0 }) });
  emit('first');
  await assert.rejects(flushPlaywrightConsole(context, page, { writeArtifact: async () => { throw new Error('write failed'); } }), /write failed/);
  let content = '';
  const publish = { writeArtifact: async (bytes: Uint8Array) => { content = new TextDecoder().decode(bytes); } };
  assert.match((await flushPlaywrightConsole(context, page, publish))!, /#L1$/);
  assert.match(content, /first/);
  emit('x'.repeat(100));
  await assert.rejects(flushPlaywrightConsole(context, page, publish), /console log byte limit/);
  assert.doesNotMatch(content, /xxx/);
  for (const close of cleanups) await close();
});

test('raw native events remain visible through a page wrapper sharing its main frame', async () => {
  const context = new EventEmitter() as EventEmitter & PlaywrightContext;
  const mainFrame = {};
  const rawPage = { mainFrame: () => mainFrame } as unknown as PlaywrightPage;
  const wrappedPage = new Proxy(rawPage, {});
  assert.notEqual(rawPage, wrappedPage);
  const cleanups: (() => Promise<void>)[] = [];
  observePlaywrightCapabilities(context, close => cleanups.push(close), { maxCommandBytes: 4096, maxArtifactBytes: 4096 });
  const native = { url: () => 'https://example.com/api', method: () => 'GET', resourceType: () => 'fetch', headers: () => ({}), postData: () => null, failure: () => null, frame: () => ({ page: () => rawPage, parentFrame: () => null }), isNavigationRequest: () => false };
  context.emit('request', native);
  context.emit('console', { page: () => rawPage, type: () => 'log', text: () => 'visible through wrapper', location: () => ({ url: 'https://example.com', lineNumber: 0, columnNumber: 0 }) });
  const run = (command: PlaywrightAbilityRequest['command'], page: PlaywrightPage) => playwrightEventAbilities[command]!.execute({
    command, args: [], options: {}, session: 's', signal: new AbortController().signal,
    browserSession: { context, page, registerCleanup() {}, resolveTarget: async () => { throw new Error('unused'); }, selectPage: async () => {} },
    write: async () => {}, readFile: async () => new Uint8Array(), writeArtifact: async () => {}, registerCleanup() {},
  });
  assert.match(JSON.stringify(await run('requests', wrappedPage)), /1\. \[GET\] https:\/\/example.com\/api/);
  assert.match(JSON.stringify(await run('console', wrappedPage)), /visible through wrapper/);
  const otherPage = { mainFrame: () => ({}) } as unknown as PlaywrightPage;
  assert.doesNotMatch(JSON.stringify(await run('console', otherPage)), /visible through wrapper/);
  for (const close of cleanups) await close();
});

test('request indexes preserve native events, binary response artifacts and observer cleanup', async () => {
  const context = new EventEmitter() as EventEmitter & PlaywrightContext;
  const page = {} as PlaywrightPage;
  const cleanups: (() => Promise<void>)[] = [];
  observePlaywrightCapabilities(context, close => cleanups.push(close), { maxCommandBytes: 4096, maxArtifactBytes: 4096 });
  const request = { url: () => 'https://example.com/api', method: () => 'POST', resourceType: () => 'fetch', headers: () => ({ accept: '*/*' }), postData: () => 'payload', failure: () => null, frame: () => ({ page: () => page, parentFrame: () => null }), isNavigationRequest: () => false };
  context.emit('request', request);
  context.emit('response', { request: () => request, status: () => 200, statusText: () => 'OK', headers: () => ({ 'content-type': 'application/octet-stream' }), body: async () => Uint8Array.of(0, 255, 1) });
  const artifacts: Uint8Array[] = [];
  const run = (command: PlaywrightAbilityRequest['command'], args: string[] = []) => playwrightEventAbilities[command]!.execute({
    command, args, options: {}, session: 's', signal: new AbortController().signal,
    browserSession: { context, page, registerCleanup() {}, resolveTarget: async () => { throw new Error('unused'); }, selectPage: async () => {} },
    write: async () => {}, readFile: async () => new Uint8Array(), writeArtifact: async bytes => { artifacts.push(bytes); }, registerCleanup() {},
  });
  assert.match(JSON.stringify(await run('requests')), /1\. \[POST\] https:\/\/example.com\/api => \[200\] OK/);
  assert.match(JSON.stringify(await run('request-body', ['1'])), /payload/);
  await run('response-body', ['1']);
  assert.deepEqual(artifacts, [Uint8Array.of(0, 255, 1)]);
  for (const close of cleanups) await close();
  assert.deepEqual(context.eventNames(), []);
});

test('observer retention limits fail explicitly and do not keep growing', async () => {
  const context = new EventEmitter() as EventEmitter & PlaywrightContext;
  const page = {} as PlaywrightPage;
  const closes: (() => Promise<void>)[] = [];
  observePlaywrightCapabilities(context, close => closes.push(close), { maxCommandBytes: 10, maxArtifactBytes: 10 });
  context.emit('console', { page: () => page, type: () => 'log', text: () => 'x'.repeat(20), location: () => ({ url: '', lineNumber: 0, columnNumber: 0 }) });
  await assert.rejects(playwrightEventAbilities.console!.execute({ command: 'console', args: [], options: {}, session: 's', signal: new AbortController().signal,
    browserSession: { context, page, registerCleanup() {}, resolveTarget: async () => { throw new Error('unused'); }, selectPage: async () => {} },
    write: async () => {}, readFile: async () => new Uint8Array(), writeArtifact: async () => {}, registerCleanup() {},
  }), /limit exceeded/);
  for (const close of closes) await close();
});
