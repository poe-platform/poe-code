import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playwrightStandardAbilities } from '../../src/playwright/standard-capabilities.js';
import type { PlaywrightAbilityRequest } from '../../src/playwright/abilities.js';
import type { PlaywrightContext, PlaywrightPage } from '../../src/playwright/adapter.js';
import { parsePlaywrightStorageState } from '../../src/playwright/storage-state.js';
import { PlaywrightResourceLimitError } from '../../src/playwright/resource-limit.js';
import { flushPlaywrightTrace } from '../../src/playwright/tracing-capabilities.js';

function fixture() {
  const effects: unknown[] = [];
  const files = new Map<string, Uint8Array>();
  const context = {
    cookies: async () => [{ name: 'token', value: 'secret', domain: '.example.com', path: '/app', httpOnly: true, secure: true, sameSite: 'Lax' }],
    addCookies: async (cookies: unknown) => { effects.push(cookies); },
    clearCookies: async (filter: unknown) => { effects.push(filter); },
    storageState: async (options: unknown) => { effects.push(options); return { cookies: [], origins: [] }; },
  } as unknown as PlaywrightContext;
  const page = {
    url: () => 'https://example.com/app',
    goBack: async () => { effects.push('back'); },
    keyboard: { down: async (key: string) => { effects.push(['down', key]); }, insertText: async (value: string) => { effects.push(['type', value]); }, press: async (key: string) => { effects.push(['press', key]); } },
    mouse: { wheel: async (x: number, y: number) => { effects.push([x, y]); } },
    pdf: async () => Uint8Array.of(37, 80, 68, 70, 255),
  } as unknown as PlaywrightPage;
  const request = (command: PlaywrightAbilityRequest['command'], args: string[] = [], options = {}): PlaywrightAbilityRequest => ({
    command, args, options, session: 'owned', signal: new AbortController().signal,
    browserSession: { context, page, resolveTarget: async () => { throw new Error('unused'); }, selectPage: async () => {}, registerCleanup() {}, replaceContext: async state => { effects.push(['replace', state]); } },
    write: async text => { effects.push(text); }, readFile: async path => files.get(path)!, writeArtifact: async (bytes, name) => { files.set(name!, bytes); }, registerCleanup() {},
  });
  const run = (command: PlaywrightAbilityRequest['command'], args?: string[], options?: Record<string, string | boolean>) => playwrightStandardAbilities[command]!.execute(request(command, args, options));
  return { effects, files, context, page, request, run };
}

test('generated capability artifacts use configured output directory while explicit paths are preserved', async () => {
  const f = fixture();
  const request = f.request('pdf');
  const browserSession = { ...request.browserSession!, configuration: { outputDir: '/reports/' } };
  await playwrightStandardAbilities.pdf!.execute({ ...request, browserSession });
  assert.match([...f.files.keys()][0]!, /^\/reports\/page-.*\.pdf$/);
  await playwrightStandardAbilities.pdf!.execute({ ...request, browserSession, options: { filename: 'explicit.pdf' } });
  assert.ok(f.files.has('explicit.pdf'));
});

test('standard navigation, keyboard and mouse abilities invoke native page operations', async () => {
  const f = fixture();
  await f.run('go-back');
  await f.run('keydown', ['Shift']);
  await f.run('type', ['literal\u0000 bytes'], { submit: true });
  await f.run('mousewheel', ['-2', '50']);
  assert.deepEqual(f.effects, ['back', ['down', 'Shift'], ['type', 'literal\u0000 bytes'], ['press', 'Enter'], [-2, 50]]);
  await assert.rejects(f.run('mousewheel', ['NaN', '1']), /Invalid/);
});

test('standard actions use the session modal lifetime and evaluation can yield without fabricating a result', async () => {
  const f = fixture();
  const request = f.request('go-back');
  let actions = 0;
  const session = { ...request.browserSession!, runAction: async (_action: () => Promise<void>) => { actions++; } };
  await playwrightStandardAbilities['go-back']!.execute({ ...request, browserSession: session });
  await playwrightStandardAbilities.type!.execute({ ...request, command: 'type', args: ['hello'], browserSession: session });
  await playwrightStandardAbilities.mousewheel!.execute({ ...request, command: 'mousewheel', args: ['1', '2'], browserSession: session });
  const page = { ...session.page!, evaluate: async () => { throw new Error('must be owned by runAction'); } };
  const result = await playwrightStandardAbilities.eval!.execute({ ...request, command: 'eval', args: ['() => prompt("Question")'], browserSession: { ...session, page } });
  assert.equal(actions, 4);
  assert.deepEqual(f.effects, []);
  assert.ok(result && !result.sections.some(section => section.title === 'Result'));
});

test('standard element action code identifies an issued reference as an aria reference', async () => {
  const f = fixture();
  const request = f.request('select', ['e7', 'two']);
  const target = { selectOption: async () => ['two'] } as unknown as Awaited<ReturnType<NonNullable<PlaywrightAbilityRequest['browserSession']>['resolveTarget']>>;
  const result = await playwrightStandardAbilities.select!.execute({ ...request, browserSession: { ...request.browserSession!, resolveTarget: async () => target } });
  assert.match(JSON.stringify(result), /locator\('aria-ref=e7'\)/);
  const scoped = await playwrightStandardAbilities.select!.execute({ ...request, browserSession: {
    ...request.browserSession!, resolveTarget: async () => target,
    targetLocator: value => { assert.equal(value, 'e7'); return "page.frameLocator('#child').getByRole('combobox')"; },
  } });
  assert.match(JSON.stringify(scoped), /frameLocator\('#child'\)\.getByRole\('combobox'\)/);
});

test('standard element actions render native code from canonical selectors and preserve double-click options', async () => {
  const f = fixture();
  const generated: unknown[] = [];
  const invoked: unknown[] = [];
  const locator = "getByRole('button', { name: 'Save', exact: true })";
  const selector = 'internal:role=button[name="Save"s]';
  const page = { ...f.page, locator: (value: string) => { assert.equal(value, selector); return { toString: () => locator }; } } as unknown as PlaywrightPage;
  for (const command of ['hover', 'check', 'uncheck', 'select', 'dblclick'] as const) {
    let resolved = false;
    const request = f.request(command, ['e7', command === 'select' ? 'two' : 'right'], command === 'dblclick' ? { modifiers: ['Alt', 'Shift'] } : {});
    const target = { [command === 'select' ? 'selectOption' : command]: async (...args: unknown[]) => { invoked.push([command, ...args]); } } as unknown as Awaited<ReturnType<NonNullable<PlaywrightAbilityRequest['browserSession']>['resolveTarget']>>;
    const result = await playwrightStandardAbilities[command]!.execute({ ...request, browserSession: {
      ...request.browserSession!, page, configuration: { codegen: 'python' },
      targetLocator: () => { assert.equal(resolved, true, 'target must resolve before describing its locator'); return `page.${locator}`; },
      resolveTarget: async () => { resolved = true; return target; },
      generateActionCode: value => { generated.push(value); return `native_python_${command}()`; },
    } });
    assert.match(JSON.stringify(result), new RegExp(`native_python_${command}`));
  }
  assert.deepEqual(generated, [
    { language: 'python', action: { name: 'hover', selector } },
    { language: 'python', action: { name: 'check', selector } },
    { language: 'python', action: { name: 'uncheck', selector } },
    { language: 'python', action: { name: 'select', selector, options: ['two'] } },
    { language: 'python', action: { name: 'click', selector, button: 'right', modifiers: 9, clickCount: 2 } },
  ]);
  assert.deepEqual(invoked.at(-1), ['dblclick', { timeout: 30000, button: 'right', modifiers: ['Alt', 'Shift'] }]);
});

test('run-code uses only the owned native execution hook and supports virtual source files', async () => {
  const f = fixture();
  const source = 'async page => page.title()';
  f.files.set('/code.js', new TextEncoder().encode(source));
  const request = f.request('run-code', [], { filename: '/code.js' });
  let actions = 0;
  const result = await playwrightStandardAbilities['run-code']!.execute({ ...request,
    limits: { maxCommandBytes: 1024, maxArtifactBytes: 1024, actionTimeoutMs: 123, maxPages: 3 },
    browserSession: { ...request.browserSession!, runAction: async action => { actions++; await action(); }, executeCode: async options => {
      assert.equal(options.page, f.page);
      assert.equal(options.source, source);
      assert.equal(options.timeoutMs, 30000);
      assert.equal(options.maxPages, 3);
      assert.equal(options.maxOutputBytes, 1024);
      return 'native title';
    } },
  });
  assert.equal(actions, 1);
  assert.match(JSON.stringify(result), /native title/);
  await assert.rejects(f.run('run-code', [source]), /provider does not support native code execution/);
  await assert.rejects(f.run('run-code', [source], { filename: '/code.js' }), /provider does not support native code execution/);
});

test('action annotations use native screencast APIs independently of video recording', async () => {
  const f = fixture();
  await assert.rejects(f.run('video-show-actions'), /provider does not support native action annotations/);
  Object.defineProperty(f.page, 'screencast', { value: {
    showActions: async (options: unknown) => { f.effects.push(options); },
    hideActions: async () => { f.effects.push('hidden'); },
  } });
  const shown = await f.run('video-show-actions', [], { duration: '123', position: 'bottom-left', cursor: 'none' });
  assert.match(JSON.stringify(shown), /Action annotations enabled/);
  await f.run('video-hide-actions');
  assert.deepEqual(f.effects, [{ duration: 123, position: 'bottom-left', cursor: 'none' }, 'hidden']);
  await assert.rejects(f.run('video-show-actions', [], { position: 'middle' }), /position/);
});

test('cookies use native context operations and standard filtering/defaults', async () => {
  const f = fixture();
  const result = await f.run('cookie-list', [], { domain: 'example', path: '/a' });
  assert.match(JSON.stringify(result), /token=secret/);
  await f.run('cookie-set', ['new', 'value'], { secure: true, sameSite: 'Strict', expires: '42' });
  await f.run('cookie-delete', ['token']);
  assert.deepEqual(f.effects, [[{ name: 'new', value: 'value', domain: 'example.com', path: '/', expires: 42, secure: true, sameSite: 'Strict' }], { name: 'token' }]);
  await assert.rejects(f.run('cookie-set', ['bad', 'value'], { sameSite: 'bad' }), /sameSite/);
});

test('state save uses standard no-IndexedDB defaults and load replaces instead of merging', async () => {
  const f = fixture();
  f.context.setStorageState = async state => { f.effects.push(['set', state]); };
  await f.run('state-save', ['/auth.json']);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(f.files.get('/auth.json'))), { cookies: [], origins: [] });
  await f.run('state-load', ['/auth.json']);
  assert.deepEqual(f.effects, [undefined, ['set', { cookies: [], origins: [] }]]);
  f.files.set('/bad.json', new TextEncoder().encode('{"cookies":[],"origins":[{"origin":"file:///etc","localStorage":[]}]}'));
  await assert.rejects(f.run('state-load', ['/bad.json']), /Invalid/);
  assert.equal(f.effects.length, 2);
});

test('state load without native storage control never resets the context', async () => {
  const f = fixture();
  f.files.set('/empty.json', new TextEncoder().encode('{"cookies":[],"origins":[]}'));
  await assert.rejects(f.run('state-load', ['/empty.json']), /trusted acquired native storage control/);
  assert.deepEqual(f.effects, []);
});

test('PDF uses native byte output and a virtual artifact rather than a host path', async () => {
  const f = fixture();
  const result = await f.run('pdf', [], { filename: '/page.pdf' });
  assert.deepEqual(f.files.get('/page.pdf'), Uint8Array.of(37, 80, 68, 70, 255));
  assert.match(JSON.stringify(result), /page.pdf/);
});

test('tracing uses the native recorder and owned artifact transport', async () => {
  const f = fixture();
  Object.defineProperty(f.context, 'tracing', { value: {
    start: async (options: unknown) => { f.effects.push(options); },
    stop: async (options: unknown) => { f.effects.push(options); },
  } });
  const request = f.request('tracing-start');
  const session = { ...request.browserSession!, captureArtifact: async (produce: (path: string) => Promise<void>) => { await produce('/private/trace.zip'); return Uint8Array.of(80, 75); } };
  await playwrightStandardAbilities['tracing-start']!.execute({ ...request, browserSession: session });
  const result = await playwrightStandardAbilities['tracing-stop']!.execute({ ...request, command: 'tracing-stop', browserSession: session });
  assert.deepEqual(f.effects, [{ screenshots: true, snapshots: true }, { path: '/private/trace.zip' }]);
  assert.deepEqual([...f.files.values()], [Uint8Array.of(80, 75)]);
  assert.match(JSON.stringify(result), /Trace/);
});

for (const outputDir of [undefined, '/reports']) test(`live traces copy native files under ${outputDir ?? 'default output'} before links and flush the final trace`, async () => {
  const f = fixture();
  let traceName = '';
  let stopped = false;
  Object.defineProperty(f.context, 'tracing', { value: {
    start: async (options: { name: string; live: boolean; _live: boolean }) => { traceName = options.name; assert.ok(options.live && options._live); },
    stop: async () => { stopped = true; },
  } });
  const request = f.request('tracing-start');
  const captureTrace = async () => ({ files: [
    { path: `${traceName}.trace`, bytes: new TextEncoder().encode(stopped ? 'final' : 'live') },
    { path: `${traceName}.network`, bytes: new Uint8Array() },
    { path: 'resources/page@native-123.45.jpeg', bytes: Uint8Array.of(255, 216) },
  ] });
  const session = { ...request.browserSession!, captureTrace, ...(outputDir === undefined ? {} : { configuration: { outputDir } }) };
  await playwrightStandardAbilities['tracing-start']!.execute({ ...request, browserSession: session });
  const directories: string[] = [];
  const options = { signal: request.signal, maxBytes: 1024, writeArtifact: request.writeArtifact, mkdir: async (path: string) => { directories.push(path); } };
  const links = await flushPlaywrightTrace(f.context, captureTrace, options);
  assert.equal(links.length, 3);
  const directory = `${outputDir ?? '.playwright-cli'}/traces`;
  assert.ok(f.files.has(`${directory}/${traceName}.trace`));
  assert.deepEqual(f.files.get(`${directory}/resources/page@native-123.45.jpeg`), Uint8Array.of(255, 216));
  assert.deepEqual(directories, [`${directory}/resources`]);
  await playwrightStandardAbilities['tracing-stop']!.execute({ ...request, command: 'tracing-stop', browserSession: session });
  await flushPlaywrightTrace(f.context, captureTrace, options);
  assert.equal(new TextDecoder().decode(f.files.get(`${directory}/${traceName}.trace`)), 'final');
  assert.deepEqual(await flushPlaywrightTrace(f.context, captureTrace, options), []);
});

test('portable storage parser preserves explicit IndexedDB records and rejects invalid or unbounded state', () => {
  const state = { cookies: [], origins: [{ origin: 'https://example.com', localStorage: [], indexedDB: [{ name: 'auth', version: 1, stores: [{ name: 'tokens', autoIncrement: false, keyPath: 'id', records: [{ value: { id: 'current', token: 'secret' } }], indexes: [] }] }] }] };
  assert.deepEqual(parsePlaywrightStorageState(state), state);
  assert.throws(() => parsePlaywrightStorageState(state, { maxNodes: 5 }), /structure limit/);
  assert.throws(() => parsePlaywrightStorageState(state, { maxBytes: 5 }), /byte limit/);
  assert.throws(() => parsePlaywrightStorageState({ cookies: [], origins: [{ ...state.origins[0], indexedDB: [{ name: 'broken' }] }] }), /IndexedDB|array/);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => parsePlaywrightStorageState(cyclic), /cyclic/);
  assert.throws(() => parsePlaywrightStorageState({ get cookies() { throw new Error('must not invoke'); }, origins: [] }), /accessor/);
});

test('portable storage parser validates own data and returns owned state without inherited accessors', () => {
  let inheritedReads = 0;
  const inheritedRoot = Object.create({ get cookies() { inheritedReads++; return []; } }) as Record<string, unknown>;
  inheritedRoot.origins = [];
  assert.throws(() => parsePlaywrightStorageState(inheritedRoot), /Invalid/);
  assert.equal(inheritedReads, 0);
  const cookie = { name: 'token', value: 'secret', domain: 'example.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Strict' };
  Object.setPrototypeOf(cookie, { get partitionKey() { inheritedReads++; throw new Error('must not invoke'); } });
  const state = { cookies: [cookie], origins: [] };
  const parsed = parsePlaywrightStorageState(state);
  assert.equal(inheritedReads, 0);
  assert.equal(parsed.cookies[0]?.partitionKey, undefined);
  cookie.value = 'changed';
  assert.equal(parsed.cookies[0]?.value, 'secret');
  assert.throws(() => parsePlaywrightStorageState({ cookies: new Array(1), origins: [] }), /Invalid/);
});

test('WebMCP validates parameters before browser access and maps remote overflow to a resource limit', async () => {
  const f = fixture();
  await assert.rejects(f.run('webmcp-call', ['echo'], { params: '[]' }), /JSON object/);
  await assert.rejects(f.run('webmcp-call', ['echo'], { params: 'null' }), /JSON object/);
  const request = f.request('webmcp-list');
  const page = { url: () => 'https://example.test', evaluate: async () => null } as unknown as PlaywrightPage;
  await assert.rejects(playwrightStandardAbilities['webmcp-list']!.execute({ ...request, browserSession: { ...request.browserSession!, page } }), PlaywrightResourceLimitError);
});

test('drop rejects missing or malformed data and oversized transport before touching its target', async () => {
  const f = fixture();
  await assert.rejects(f.run('drop', ['#target']), /At least one/);
  await assert.rejects(f.run('drop', ['#target'], { data: 'text/plain' }), /mime\/type=value/);
  const request = f.request('drop', ['#target'], { data: 'text/plain=' + 'x'.repeat(50) });
  await assert.rejects(playwrightStandardAbilities.drop!.execute({ ...request, limits: { maxCommandBytes: 10, maxArtifactBytes: 10 } }), PlaywrightResourceLimitError);
});
