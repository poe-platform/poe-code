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

test('automatic console logs rotate at the artifact boundary without ending a retained session', async () => {
  const context = new EventEmitter() as EventEmitter & PlaywrightContext;
  const page = {} as PlaywrightPage;
  const cleanups: (() => Promise<void>)[] = [];
  observePlaywrightCapabilities(context, close => cleanups.push(close), { maxCommandBytes: 4096, maxArtifactBytes: 100 });
  const files = new Map<string, string>();
  const publish = { writeArtifact: async (bytes: Uint8Array, filename: string) => { assert.ok(bytes.length <= 100); files.set(filename, new TextDecoder().decode(bytes)); } };
  const links: string[] = [];
  for (let i = 0; i < 10; i++) {
    context.emit('console', { page: () => page, type: () => 'log', text: () => `message-${i}`, location: () => ({ url: '', lineNumber: 0, columnNumber: 0 }) });
    links.push((await flushPlaywrightConsole(context, page, publish))!);
  }
  assert.ok(files.size > 1);
  assert.notEqual(links[0]!.split('#')[0], links.at(-1)!.split('#')[0]);
  assert.match([...files.values()].join('\n'), /message-0/);
  assert.match([...files.values()].join('\n'), /message-9/);
  for (const close of cleanups) await close();
});

test('console publication retains its cursor when diagnostic history rolls during a pending write', async () => {
  const context = new EventEmitter() as EventEmitter & PlaywrightContext;
  const page = {} as PlaywrightPage;
  const cleanups: (() => Promise<void>)[] = [];
  observePlaywrightCapabilities(context, close => cleanups.push(close), { maxCommandBytes: 100, maxArtifactBytes: 4096 });
  const emit = (text: string) => context.emit('console', { page: () => page, type: () => 'log', text: () => text, location: () => ({ url: '', lineNumber: 0, columnNumber: 0 }) });
  emit('first');
  const publication = Promise.withResolvers<void>();
  const pending = flushPlaywrightConsole(context, page, { writeArtifact: async () => publication.promise });
  for (let i = 0; i < 100; i++) emit(`recent-${i}`);
  publication.resolve();
  await pending;
  let content = '';
  await flushPlaywrightConsole(context, page, { writeArtifact: async bytes => { content = new TextDecoder().decode(bytes); } });
  assert.match(content, /recent-99/);
  assert.doesNotMatch(content, /recent-0\b/);
  assert.equal(await flushPlaywrightConsole(context, page, { writeArtifact: async () => assert.fail('no duplicate publication') }), undefined);
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

test('oversized diagnostic entries are discarded without poisoning later commands', async () => {
  const context = new EventEmitter() as EventEmitter & PlaywrightContext;
  const page = {} as PlaywrightPage;
  const closes: (() => Promise<void>)[] = [];
  observePlaywrightCapabilities(context, close => closes.push(close), { maxCommandBytes: 10, maxArtifactBytes: 10 });
  context.emit('console', { page: () => page, type: () => 'log', text: () => 'x'.repeat(20), location: () => ({ url: '', lineNumber: 0, columnNumber: 0 }) });
  const run = () => playwrightEventAbilities.console!.execute({ command: 'console', args: [], options: {}, session: 's', signal: new AbortController().signal,
    browserSession: { context, page, registerCleanup() {}, resolveTarget: async () => { throw new Error('unused'); }, selectPage: async () => {} },
    write: async () => {}, readFile: async () => new Uint8Array(), writeArtifact: async () => {}, registerCleanup() {},
  });
  assert.match(JSON.stringify(await run()), /Total messages: 0/);
  context.emit('console', { page: () => page, type: () => 'log', text: () => 'ok', location: () => ({ url: '', lineNumber: 0, columnNumber: 0 }) });
  assert.match(JSON.stringify(await run()), /ok/);
  for (const close of closes) await close();
});

test('large uploads and repeated requests roll diagnostics without imposing a traffic lifetime limit', async () => {
  const context = new EventEmitter() as EventEmitter & PlaywrightContext;
  const page = {} as PlaywrightPage;
  const closes: (() => Promise<void>)[] = [];
  observePlaywrightCapabilities(context, close => closes.push(close), { maxCommandBytes: 1024 * 1024, maxArtifactBytes: 4096 });
  let bodyReads = 0;
  const emit = (index: number, body: string | null) => {
    const native = { url: () => `https://example.com/upload/${index}`, method: () => 'POST', resourceType: () => 'fetch', headers: () => ({}), postData: () => { bodyReads++; return body; }, failure: () => null, frame: () => ({ page: () => page, parentFrame: () => null }), isNavigationRequest: () => false };
    context.emit('request', native);
    context.emit('response', { request: () => native, status: () => 200, statusText: () => 'OK', headers: () => ({}), body: async () => new Uint8Array() });
  };
  const run = (command: PlaywrightAbilityRequest['command'], args: string[] = [], maxCommandBytes = 1024 * 1024) => playwrightEventAbilities[command]!.execute({
    command, args, options: {}, session: 's', signal: new AbortController().signal, limits: { maxCommandBytes, maxArtifactBytes: 4096 },
    browserSession: { context, page, registerCleanup() {}, resolveTarget: async () => { throw new Error('unused'); }, selectPage: async () => {} },
    write: async () => {}, readFile: async () => new Uint8Array(), writeArtifact: async () => {}, registerCleanup() {},
  });
  for (let i = 0; i < 33; i++) emit(i, 'x'.repeat(2 * 1024 * 1024));
  assert.equal(bodyReads, 0);
  assert.match(JSON.stringify(await run('requests')), /33\. \[POST\] https:\/\/example.com\/upload\/32 => \[200\] OK/);
  assert.equal(bodyReads, 0);
  await assert.rejects(run('request-body', ['33']), /result byte limit/);
  for (let i = 33; i < 5033; i++) emit(i, 'last body');
  assert.equal(await flushPlaywrightConsole(context, page, { writeArtifact: async () => {} }), undefined);
  const history = JSON.stringify(await run('requests'));
  assert.match(history, /5033\. \[POST\] https:\/\/example.com\/upload\/5032 => \[200\] OK/);
  assert.doesNotMatch(history, /https:\/\/example.com\/upload\/33 =>/);
  assert.match(JSON.stringify(await run('request-body', ['5033'])), /last body/);
  await assert.rejects(run('request', ['34']), /not found/);
  await assert.rejects(run('request-body', ['5033'], 4), /result byte limit/);
  assert.match(JSON.stringify(await run('request-body', ['5033'])), /last body/);
  for (const close of closes) await close();
});
