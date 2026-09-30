import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createPlaywrightCli, createPlaywrightController, getPlaywrightMainFrameNavigation, type PlaywrightAdapter, type PlaywrightContext, type PlaywrightPage, type PlaywrightSnapshotHook } from '../../src/commands/playwright/index.js';
import { observePlaywrightCapabilities } from '../../src/playwright/capability-events.js';
import { Shell } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import type { PlaywrightElementHandle } from '../../src/playwright/adapter.js';
import { createSnapshotFrame } from '../helpers/playwright-snapshot.js';

function fixture() {
  let url = 'about:blank', title = 'Just a moment...';
  const captures: string[] = [];
  const page = Object.assign(new EventEmitter(), {
    url: () => url, title: async () => title,
    async goto(target: string) { url = target; navigate(target); },
    async ariaSnapshot() { captures.push('yaml'); return `- document "${title}"\n`; },
    async ariaSnapshotJSON() { captures.push('json'); return [{ role: 'document', name: title }]; },
  }) as unknown as PlaywrightPage;
  const context = Object.assign(new EventEmitter(), {
    pages: () => [page], newPage: async () => page, async close() {},
  }) as EventEmitter & PlaywrightContext;
  const frame = { page: () => page, parentFrame: () => null, locator() { throw new Error('Unused locator'); } };
  page.mainFrame = () => frame as ReturnType<NonNullable<PlaywrightPage['mainFrame']>>;
  const navigate = (target: string, navigation = true, main = true) => {
    const request = { url: () => target, method: () => 'GET', resourceType: () => navigation ? 'document' : 'fetch', headers: () => ({ secret: 'request-only' }),
      isNavigationRequest: () => navigation, frame: () => main ? frame : { page: () => page, parentFrame: () => frame }, postData: () => null, failure: () => null };
    context.emit('request', request);
    return request;
  };
  const respond = (request: ReturnType<typeof navigate>, status = 503) => context.emit('response', {
    request: () => request, status: () => status, statusText: () => 'Status', headers: () => ({ 'cf-mitigated': 'challenge' }),
  });
  const adapter: PlaywrightAdapter = { browsers: { chromium: { headed: false } }, async acquire() {
    return { context, onClosed: () => () => {}, async release() {} };
  } };
  return { page, context, adapter, captures, navigate, respond, resolve() { url = 'https://example.com/resolved'; title = 'Welcome'; } };
}

test('navigation reader exposes only retained main-frame response metadata across wrappers and cleanup', async () => {
  const f = fixture();
  const cleanups: (() => Promise<void>)[] = [];
  assert.equal(getPlaywrightMainFrameNavigation(f.context, f.page), undefined);
  observePlaywrightCapabilities(f.context, cleanup => cleanups.push(cleanup), { maxCommandBytes: 512, maxArtifactBytes: 512 });
  try {
    f.navigate('https://example.com/api', false);
    assert.equal(getPlaywrightMainFrameNavigation(f.context, f.page), undefined);
    const request = f.navigate('https://example.com');
    assert.deepEqual(getPlaywrightMainFrameNavigation(f.context, f.page), { url: 'https://example.com' });
    f.respond(request);
    const wrapper = { mainFrame: f.page.mainFrame } as PlaywrightPage;
    assert.deepEqual(getPlaywrightMainFrameNavigation(f.context, wrapper), {
      url: 'https://example.com', status: 503, headers: { 'cf-mitigated': 'challenge' },
    });
    f.navigate('https://example.com/frame', true, false);
    assert.equal(getPlaywrightMainFrameNavigation(f.context, f.page)?.url, 'https://example.com');
    const next = f.navigate('https://example.com/redirect');
    f.respond(request, 200); // Late response from the previous navigation.
    assert.deepEqual(getPlaywrightMainFrameNavigation(f.context, f.page), { url: 'https://example.com/redirect' });
    f.respond(next, 200);
    for (let index = 0; index < 10; index++) f.navigate(`https://example.com/api/${index}`, false);
    assert.deepEqual(getPlaywrightMainFrameNavigation(f.context, f.page), { url: 'https://example.com/redirect', status: 200, headers: { 'cf-mitigated': 'challenge' } });
  } finally { for (const cleanup of cleanups) await cleanup(); }
  assert.equal(getPlaywrightMainFrameNavigation(f.context, f.page), undefined);
});

for (const format of ['yaml', 'json'] as const) test(`${format} hook recaptures without recursion and refreshes page metadata`, async () => {
  const f = fixture();
  let calls = 0;
  const hook: PlaywrightSnapshotHook = async request => {
    calls++;
    assert.equal(request.context, f.context);
    assert.equal(request.page, f.page);
    assert.equal(request.signal.aborted, false);
    if (request.command === 'open') return request.snapshot;
    assert.equal(request.command, 'snapshot');
    assert.equal(request.format, format);
    assert.deepEqual(request.navigation, { url: 'https://example.com', status: 503, headers: { 'cf-mitigated': 'challenge' } });
    assert.ok(JSON.stringify(request.snapshot).includes('Just a moment...'));
    f.resolve();
    return request.recapture();
  };
  const controller = createPlaywrightController({ adapter: f.adapter, onSnapshot: hook });
  const run = async (args: string[]) => {
    let output = '';
    await controller.run({ args, env: {}, signal: new AbortController().signal, async write(text) { output += text; } });
    return output;
  };
  try {
    await run(['open', 'https://example.com']);
    f.respond(f.navigate('https://example.com'));
    f.captures.length = 0;
    const output = await run(['snapshot', ...(format === 'json' ? ['--json'] : [])]);
    assert.equal(calls, 2);
    assert.deepEqual(f.captures, [format, format]);
    assert.ok(output.includes('Welcome'));
    assert.ok(!output.includes('Just a moment...'));
    if (format === 'yaml') {
      assert.ok(output.includes('- Page URL: https://example.com/resolved\n- Page Title: Welcome'));
      assert.ok(output.indexOf('### Page') < output.indexOf('### Snapshot'));
    } else assert.deepEqual(JSON.parse(output), { snapshot: [{ role: 'document', name: 'Welcome' }] });
  } finally { await controller.dispose(); }
});

test('CLI forwards the hook and writes its returned snapshot to the artifact', async () => {
  const f = fixture();
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs });
  shell.use(createPlaywrightCli({ adapter: f.adapter, onSnapshot: async request => {
    f.resolve();
    return request.recapture();
  } }).plugin);
  try {
    const result = await shell.exec('playwright-cli open https://example.com');
    assert.equal(result.exitCode, 0, result.stdout);
    assert.ok(result.stdout.includes('- Page Title: Welcome'));
    const filename = (await fs.readdir('/.playwright-cli')).find(entry => entry.name.endsWith('.yml'))!.name;
    assert.equal(new TextDecoder().decode(await fs.readFile(`/.playwright-cli/${filename}`)), '- document "Welcome"\n');
  } finally { await shell.dispose(); }
});

test('hook errors propagate without publishing an initial snapshot', async () => {
  const f = fixture();
  const failure = new Error('Hook failed');
  const controller = createPlaywrightController({ adapter: f.adapter, onSnapshot: async () => { throw failure; } });
  const output: string[] = [];
  try {
    await assert.rejects(controller.run({ args: ['open'], env: {}, signal: new AbortController().signal, async write(text) { output.push(text); } }), error => error === failure);
    assert.deepEqual(output, []);
  } finally { await controller.dispose(); }
});

test('caller cancellation reaches the hook and prevents recapture and publication', async () => {
  const f = fixture();
  const abort = new AbortController();
  const failure = new Error('Cancelled by caller');
  const controller = createPlaywrightController({ adapter: f.adapter, onSnapshot: async request => {
    abort.abort(failure);
    assert.equal(request.signal.aborted, true);
    await assert.rejects(request.recapture());
    return request.snapshot;
  } });
  const output: string[] = [];
  try {
    await assert.rejects(controller.run({ args: ['open'], env: {}, signal: abort.signal, async write(text) { output.push(text); } }));
    assert.deepEqual(f.captures, ['yaml']);
    assert.deepEqual(output, []);
  } finally { await controller.dispose(); }
});

test('recapture cannot escape the completed hook and session command queue', async () => {
  const f = fixture();
  let recapture: (() => Promise<unknown>) | undefined;
  const controller = createPlaywrightController({ adapter: f.adapter, onSnapshot: async request => {
    recapture = request.recapture;
    return request.snapshot;
  } });
  try {
    await controller.run({ args: ['open'], env: {}, signal: new AbortController().signal, async write() {} });
    await assert.rejects(recapture!(), /snapshot hook has completed/);
    assert.deepEqual(f.captures, ['yaml']);
  } finally { await controller.dispose(); }
});

test('recapture replaces interstitial element refs with actionable post-challenge refs', async () => {
  const f = fixture();
  const clicked: string[] = [];
  const element = (text: string) => ({
    node: { tagName: 'BUTTON', textContent: text, firstChild: { nodeType: 3, textContent: text }, isConnected: true, getAttribute: () => null },
    native: { async click() { clicked.push(text); }, async dispose() {} } as PlaywrightElementHandle,
  });
  const challenge = element('Verify');
  const elements = [challenge];
  const snapshot = createSnapshotFrame(elements);
  delete f.page.ariaSnapshot;
  delete f.page.ariaSnapshotJSON;
  f.page.frames = () => [snapshot.frame];
  const controller = createPlaywrightController({ adapter: f.adapter, onSnapshot: async request => {
    if (request.command !== 'open') return request.snapshot;
    assert.ok(String(request.snapshot).includes('[ref=e1]'));
    challenge.node.isConnected = false;
    elements.splice(0, 1, element('Continue'));
    return request.recapture();
  } });
  const run = async (args: string[]) => {
    let output = '';
    await controller.run({ args, env: {}, signal: new AbortController().signal, async write(text) { output += text; } });
    return output;
  };
  try {
    const output = await run(['open']);
    assert.ok(output.includes('Continue'));
    assert.ok(output.includes('[ref=e2]'));
    assert.ok(!output.includes('[ref=e1]'));
    await run(['click', 'e2']);
    assert.deepEqual(clicked, ['Continue']);
    assert.ok(snapshot.disposedCapsules.length > 0);
  } finally { await controller.dispose(); }
});

for (const throws of [false, true]) test(`pending recapture drains before hook ${throws ? 'failure' : 'return'}`, async () => {
  const f = fixture();
  let finish!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let captures = 0;
  f.page.ariaSnapshot = async () => {
    if (++captures === 2) { started(); await pending; }
    return '- document "Ready"\n';
  };
  const failure = new Error('Hook failed');
  const controller = createPlaywrightController({ adapter: f.adapter, onSnapshot: async request => {
    void request.recapture();
    void request.recapture();
    await ready;
    if (throws) throw failure;
    return request.snapshot;
  } });
  let settled = false;
  const run = controller.run({ args: ['open'], env: {}, signal: new AbortController().signal, async write() {} });
  const outcome = run.then(() => { settled = true; }, error => { settled = true; assert.equal(error, failure); });
  try {
    await ready;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(captures, 2);
  } finally { finish(); await outcome; await controller.dispose(); }
  assert.equal(captures, 3);
});

test('snapshot flushes only destination console messages after the hook', async () => {
  const f = fixture();
  const artifacts: string[] = [];
  const log = (text: string) => f.context.emit('console', { page: () => f.page, type: () => 'warning', text: () => text, location: () => ({ url: f.page.url(), lineNumber: 1 }) });
  f.page.ariaSnapshot = async () => { log('challenge'); return '- document "Challenge"\n'; };
  const controller = createPlaywrightController({ adapter: f.adapter, onSnapshot: async request => {
    await f.page.goto!('https://example.com/destination');
    log('destination');
    return request.snapshot;
  } });
  try {
    await controller.run({ args: ['open'], env: {}, signal: new AbortController().signal, async write() {}, async writeArtifact(bytes) { artifacts.push(new TextDecoder().decode(bytes)); } });
    assert.ok(artifacts.some(text => text.includes('destination')));
    assert.ok(!artifacts.some(text => text.includes('challenge')));
  } finally { await controller.dispose(); }
});

test('console eviction preserves navigation within configured entry and byte limits', async () => {
  const f = fixture();
  const cleanups: (() => Promise<void>)[] = [];
  observePlaywrightCapabilities(f.context, cleanup => cleanups.push(cleanup), { maxCommandBytes: 512, maxArtifactBytes: 512, maxEventEntries: 2 });
  try {
    const request = f.navigate('https://example.com');
    f.respond(request, 200);
    for (let i = 0; i < 10; i++) f.context.emit('console', { page: () => f.page, type: () => 'info', text: () => `message ${i}`, location: () => ({ url: 'https://example.com', lineNumber: 1 }) });
    assert.equal(getPlaywrightMainFrameNavigation(f.context, f.page)?.status, 200);
    f.navigate('x'.repeat(513));
    assert.equal(getPlaywrightMainFrameNavigation(f.context, f.page), undefined);
  } finally { for (const cleanup of cleanups) await cleanup(); }
});

test('unlimited event retention preserves more than 4096 records', async () => {
  const f = fixture();
  const cleanups: (() => Promise<void>)[] = [];
  observePlaywrightCapabilities(f.context, cleanup => cleanups.push(cleanup), { maxCommandBytes: Infinity, maxArtifactBytes: Infinity });
  try {
    f.navigate('https://example.com');
    for (let i = 0; i < 4100; i++) f.navigate(`https://example.com/api/${i}`, false);
    assert.deepEqual(getPlaywrightMainFrameNavigation(f.context, f.page), { url: 'https://example.com' });
  } finally { for (const cleanup of cleanups) await cleanup(); }
});

for (const format of ['yaml', 'json'] as const) test(`${format} target snapshot resolves the root again after DOM replacement`, async () => {
  const f = fixture();
  let generation = 0;
  const roots: PlaywrightElementHandle[] = [];
  f.page.locator = () => ({ async elementHandle() {
    const root = { generation, async dispose() {} } as unknown as PlaywrightElementHandle;
    roots.push(root);
    return root;
  }, toString: () => '[object Object]' }) as ReturnType<PlaywrightPage['locator']>;
  f.page.ariaSnapshot = async () => '- document "Ready"\n';
  const controller = createPlaywrightController({ adapter: f.adapter, onSnapshot: async request => {
    if (request.command !== 'snapshot') return request.snapshot;
    generation++;
    return request.recapture();
  } });
  const run = (args: string[]) => controller.run({ args, env: {}, signal: new AbortController().signal, async write() {} });
  try {
    await run(['open']);
    await run(['snapshot', '#root', ...(format === 'json' ? ['--json'] : [])]);
    assert.deepEqual(roots.map(root => (root as unknown as { generation: number }).generation), [0, 1]);
  } finally { await controller.dispose(); }
});
