import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createPlaywrightController, type PlaywrightSessionPersistence } from '../../src/playwright/controller.js';
import type { PlaywrightAdapter, PlaywrightContext, PlaywrightElementHandle, PlaywrightLease, PlaywrightPage } from '../../src/playwright/adapter.js';
import { createSnapshotFrame } from '../helpers/playwright-snapshot.js';
import { serializePlaywrightResult } from '../../src/playwright/response.js';
import { PlaywrightStorageReadError } from '../../src/playwright/checkpoint.js';
import { PlaywrightResourceLimitError } from '../../src/playwright/resource-limit.js';

function fixture(persistence?: PlaywrightSessionPersistence) {
  const events: string[] = [];
  const files = new Map<string, Uint8Array>();
  let active: PlaywrightContext;
  let clicks: unknown;
  const navigationTimeouts: (number | undefined)[] = [];
  function lease(): PlaywrightLease {
    const pages: PlaywrightPage[] = [];
    const context: PlaywrightContext = {
      pages: () => pages,
      async newPage() {
        let url = 'about:blank';
        const snapshot = createSnapshotFrame([]);
        const target: PlaywrightElementHandle = {
          async evaluate() { return 1 as never; },
          async click(options) { clicks = options; events.push('click'); },
          async fill(text) { events.push(`fill:${text}`); },
          async dispose() { events.push('dispose-target'); },
          async boundingBox() { return { x: 1, y: 1, width: 4, height: 4 }; },
          async screenshot() { return new Uint8Array([1, 2, 3]); },
        };
        const page: PlaywrightPage = {
          async goto(next, options) { navigationTimeouts.push(options?.timeout); url = next; events.push(`goto:${next}`); }, url: () => url,
          async reload(options) { navigationTimeouts.push(options?.timeout); },
          async title() { return 'Title'; },
          frames: () => [snapshot.frame],
          locator(selector) {
            return {
              ...target,
              async ariaSnapshot() { return '- button "Save"'; },
              async elementHandle() {
                events.push(`selector:${selector}`);
                if (selector === '.ambiguous') throw new Error('strict mode violation');
                return target;
              },
            };
          },
          async evaluate() { return { width: 4, height: 4 } as never; },
          keyboard: { async press(key) { events.push(`press:${key}`); } },
          async screenshot() { return new Uint8Array([1, 2, 3]); },
          async close() { pages.splice(pages.indexOf(page), 1); }, on() {}, off() {},
        };
        pages.push(page);
        return page;
      },
      async close() { pages.splice(0); }, on() {}, off() {},
    };
    active = context;
    return { context, onClosed: () => () => {}, async release() { events.push('release'); await context.close(); } };
  }
  const adapter: PlaywrightAdapter = { browsers: { chromium: { headed: false } }, async acquire() { events.push('acquire'); return lease(); } };
  const controller = createPlaywrightController({ adapter, ...(persistence ? { persistence } : {}) });
  const run = async (...args: string[]) => {
    let output = '';
    await controller.run({ args, env: {}, signal: new AbortController().signal,
      async write(text) { output += text; },
      async readArtifact(filename) { const bytes = files.get(filename); if (!bytes) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return bytes; },
      workspace: { cwd: '/', async mkdir() {}, async exists(filename) { return files.has(filename); },
        async listFiles(directory) { return [...files].filter(([filename]) => ('/' + filename).startsWith(directory + '/')).map(([filename, bytes], index) => ({ filename, size: bytes.byteLength, mtimeMs: index })); },
        async removeFile(filename) { files.delete(filename.replace(/^\//, '')); },
      },
      async writeArtifact(bytes, filename) { assert.ok(filename); files.set(filename, new Uint8Array(bytes)); },
    });
    return output;
  };
  return { controller, run, events, files, lease, navigationTimeouts, get context() { return active; }, get clicks() { return clicks; } };
}

test('default action and navigation use standard CLI timeouts across built-in and ability commands', async () => {
  const f = fixture();
  try {
    await f.run('open', 'https://example.com');
    await f.run('reload');
    await f.run('goto', 'https://example.org');
    await f.run('click', 'button');
    assert.deepEqual(f.navigationTimeouts, [60000, 60000, 60000]);
    assert.deepEqual(f.clicks, { timeout: 5000 });
  } finally { await f.controller.dispose(); }
});

test('configured output directory and retention preserve current artifacts and explicit filenames', async () => {
  const f = fixture();
  f.files.set('config.json', new TextEncoder().encode(JSON.stringify({ outputDir: 'artifacts', outputMaxSize: 5, testIdAttribute: 'data-qa', console: { level: 'warning' } })));
  f.files.set('artifacts/old.txt', new Uint8Array(10));
  f.files.set('elsewhere/keep.txt', new Uint8Array(10));
  try {
    await f.run('open', '--config=config.json');
    await f.run('screenshot');
    assert.equal(f.files.has('artifacts/old.txt'), false);
    assert.equal(f.files.has('elsewhere/keep.txt'), true);
    assert.ok([...f.files.keys()].some(filename => filename.startsWith('artifacts/page-') && filename.endsWith('.png')));
    await f.run('screenshot', '--filename=explicit.png');
    assert.ok(f.files.has('explicit.png'));
    const config = JSON.parse(await f.run('config-print', '--json')).result;
    assert.equal(config.outputDir, 'artifacts');
    assert.equal(config.codegen, 'typescript');
    assert.deepEqual(config.timeouts, { action: 5000, navigation: 60000, expect: 5000, settle: 500, idle: 3600000 });
    assert.deepEqual(config.snapshot, { mode: 'full' });
    assert.equal(config.testIdAttribute, 'data-qa');
    assert.equal(config.skillMode, true);
  } finally { await f.controller.dispose(); }
});

test('attach validates standard targets and detach never closes a normally opened session', async () => {
  const f = fixture();
  try {
    assert.equal(await f.run('detach'), "Browser 'default' is not attached.\n");
    await assert.rejects(f.run('attach'), /no target specified for attach command/);
    await assert.rejects(f.run('attach', 'named', '--cdp=http://localhost:9222'), /only one of/);
    await assert.rejects(f.run('attach', 'named'), /authenticated browser attachment broker/);
    assert.deepEqual(f.events, []);
    await f.run('open');
    await assert.rejects(f.run('detach'), /was not attached; use `playwright-cli close`/);
    assert.equal(f.context.pages().length, 1);
  } finally { await f.controller.dispose(); }
});

test('open reports page details and a readable snapshot file; repeated open replaces its owned browser', async () => {
  const f = fixture();
  try {
    const first = await f.run('--json', 'open', 'https://example.com');
    const output = JSON.parse(first);
    assert.equal(output.session, 'default');
    assert.equal(output.result.page, '- Page URL: https://example.com\n- Page Title: Title');
    assert.ok(f.files.has(output.result.snapshot.file));
    await f.run('open', 'https://example.org');
    assert.equal(f.context.pages()[0]!.url(), 'https://example.org');
    assert.deepEqual(f.events, ['acquire', 'goto:https://example.com', 'release', 'acquire', 'goto:https://example.org']);
  } finally { await f.controller.dispose(); }
});

test('standard idle timeout refreshes on commands and prevents expired implicit resume', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  let restores = 0;
  const f = fixture({ async restore() { restores++; return undefined; }, async checkpoint() {}, async delete() {} });
  try {
    await f.run('open', '--idle-timeout=100');
    assert.equal(f.controller.inspectSessions()[0]?.expiresAt, 1100);
    t.mock.timers.setTime(1090);
    await f.run('snapshot');
    assert.equal(f.controller.inspectSessions()[0]?.expiresAt, 1190);
    t.mock.timers.setTime(1200);
    await assert.rejects(f.run('snapshot'), /closed|expired/);
    assert.equal(restores, 0);
    assert.ok(f.events.includes('release'));
    await f.run('open', '--idle-timeout=0');
    assert.equal(f.controller.inspectSessions()[0]?.expiresAt, undefined);
  } finally { await f.controller.dispose(); }
});

test('idle timeout does not expire a command while native browser work is running', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const f = fixture();
  try {
    await f.run('open', '--idle-timeout=100');
    f.context.pages()[0]!.keyboard.press = async () => { t.mock.timers.setTime(2000); };
    await f.run('press', 'Enter');
    assert.equal(f.controller.inspectSessions()[0]?.expiresAt, 2100);
  } finally { await f.controller.dispose(); }
});

test('cold list includes only owner resumable profiles without restoring a browser and kill-all closes them', async () => {
  let restores = 0;
  let closed = false;
  const f = fixture({
    async list() { return closed ? [] : [{ name: 'saved' }, { name: 'expired', expiresAt: Date.now() - 1 }]; },
    async restore() { restores++; return undefined; }, async checkpoint() {}, async delete() {}, async close(name) { assert.equal(name, undefined); closed = true; },
  });
  try {
    const list = JSON.parse(await f.run('--json', 'list', '--all'));
    assert.deepEqual(list.browsers, [{ name: 'saved', status: 'saved' }]);
    assert.equal(restores, 0);
    assert.deepEqual(f.events, []);
    await f.run('kill-all');
    assert.equal(await f.run('list'), '  (no browsers)\n');
  } finally { await f.controller.dispose(); }
});

test('delete-data purges persisted state after an earlier failed retirement', async () => {
  let deleted = false;
  const f = fixture({ async restore() { return undefined; }, async checkpoint() {}, async delete() { deleted = true; } });
  try {
    await f.run('open');
    f.context.close = async () => { throw new Error('prior cleanup failed'); };
    await assert.rejects(f.run('close'), /prior cleanup failed/);
    await f.run('delete-data');
    assert.equal(deleted, true);
    await f.run('open');
  } finally { await f.controller.dispose(); }
});

test('selectors retain native strictness, click options and cleanup; fill submit presses Enter', async () => {
  const f = fixture();
  try {
    await f.run('open');
    await f.run('click', '#save', 'right', '--modifiers=Shift');
    assert.deepEqual(f.clicks, { timeout: 5_000, button: 'right', modifiers: ['Shift'] });
    assert.ok(f.events.includes('dispose-target'));
    await f.run('fill', '#input', 'typed', '--submit');
    assert.ok(f.events.includes('fill:typed'));
    assert.ok(f.events.includes('press:Enter'));
    await assert.rejects(f.run('click', '.ambiguous'), /strict mode/);
    assert.equal(f.events.filter(event => event === 'click').length, 1);
  } finally { await f.controller.dispose(); }
});

test('screenshots default to files, accept element targets, and JSON/raw preserve result semantics', async () => {
  const f = fixture();
  try {
    await f.run('open');
    const output = JSON.parse(await f.run('--json', 'screenshot'));
    assert.match(output.result, /^- \[Screenshot of viewport\]\(.playwright-cli\/page-/);
    const element = await f.run('--raw', 'screenshot', '#save', '--filename=element.png');
    assert.equal(element, '- [Screenshot of element](element.png)\n');
    assert.deepEqual(f.files.get('element.png'), new Uint8Array([1, 2, 3]));
    await assert.rejects(f.run('screenshot', '#save', '--full-page'), /cannot be used with element/);
  } finally { await f.controller.dispose(); }
});

test('JSON and raw serializer match official section selection and snapshot file encoding', () => {
  const result = { sections: [
    { title: 'Result' as const, content: '42' },
    { title: 'Ran Playwright code' as const, content: 'await page.title();', codeframe: 'js' },
    { title: 'Page' as const, content: '- Page URL: https://example.com' },
    { title: 'Snapshot' as const, content: '- [Snapshot](page.yml)' },
  ] };
  assert.equal(serializePlaywrightResult(result, { raw: true, json: false }), '42\n- [Snapshot](page.yml)\n');
  assert.deepEqual(JSON.parse(serializePlaywrightResult(result, { raw: true, json: true })), { result: '42', snapshot: { file: 'page.yml' } });
});

test('persistence restores lazily in the session queue; help/list never acquire and close retains while delete-data purges', async () => {
  const persisted: string[] = [];
  const persistence: PlaywrightSessionPersistence = {
    async restore({ name }) {
      persisted.push(`restore:${name}`);
      const lease = f.lease();
      const selectedPage = await lease.context.newPage();
      return { lease, selectedPage };
    },
    async checkpoint(session) { persisted.push(`checkpoint:${session.name}:${session.selectedPage?.url()}`); },
    async delete(name) { persisted.push(`delete:${name}`); },
  };
  const f = fixture(persistence);
  try {
    await f.run('--help'); await f.run('list');
    assert.deepEqual(persisted, []);
    await f.run('goto', 'https://example.com');
    assert.deepEqual(persisted, ['restore:default', 'checkpoint:default:https://example.com']);
    await f.run('close');
    assert.equal(persisted.at(-1), 'checkpoint:default:https://example.com');
    await f.run('delete-data');
    assert.equal(persisted.at(-1), 'delete:default');
  } finally { await f.controller.dispose(); }
});

for (const reason of ['expired', 'cancelled', 'capacity'] as const) test(`lazy persistence retires the returned lease when ${reason} prevents ownership transfer`, async () => {
  const signal = new AbortController();
  let released = 0;
  const persistence: PlaywrightSessionPersistence = {
    async restore() {
      const resource = f.lease();
      if (reason === 'cancelled') signal.abort(new Error('cancelled restore'));
      return { lease: { ...resource, async release() { released++; await resource.release(); } },
        ...(reason === 'expired' ? { expiresAt: Date.now() - 1 } : {}) };
    },
    async checkpoint() {}, async delete() {},
  };
  const f = fixture();
  const controller = createPlaywrightController({
    adapter: { browsers: { chromium: { headed: false } }, async acquire() { return f.lease(); } }, persistence,
    limits: { maxSessions: 1 },
  });
  const run = (args: string[]) => controller.run({ args, env: {}, signal: signal.signal, async write() {} });
  try {
    if (reason === 'capacity') await run(['-s=already-open', 'open']);
    await assert.rejects(run(['goto', 'https://example.com']), reason === 'expired' ? /expired/ : reason === 'cancelled' ? /cancelled restore/ : /capacity/);
    assert.equal(released, 1);
  } finally { await controller.dispose(); await f.controller.dispose(); }
});

test('client-scoped commands do not trigger lazy browser restoration', async () => {
  let restored = 0;
  const controller = createPlaywrightController({
    abilities: { install: { async execute() {} } },
    persistence: { async restore() { restored++; return undefined; }, async checkpoint() {}, async delete() {} },
  });
  try {
    await controller.run({ args: ['install'], env: {}, signal: new AbortController().signal, async write() {} });
    assert.equal(restored, 0);
  } finally { await controller.dispose(); }
});

for (const command of ['close', 'close-all'] as const) test(`${command} suppresses implicit restoration and marks durable closure while explicit open remains available`, async () => {
  let restores = 0;
  const closed: (string | undefined)[] = [];
  const f = fixture({ async restore() { restores++; return undefined; }, async checkpoint() {}, async delete() {},
    async close(name) { closed.push(name); },
  });
  try {
    await f.run('open');
    await f.run(command);
    assert.deepEqual(closed, [command === 'close' ? 'default' : undefined]);
    await assert.rejects(f.run('snapshot'), /Session closed/);
    assert.equal(restores, 0);
    await f.run('open');
    assert.equal(f.controller.inspectSessions().length, 1);
  } finally { await f.controller.dispose(); }
});

test('explicit close still retires its resource and durable resumability if checkpoint fails', async () => {
  let failed = false;
  const closed: (string | undefined)[] = [];
  const f = fixture({ async restore() { return undefined; }, async checkpoint() { if (failed) throw new Error('checkpoint unavailable'); }, async delete() {},
    async close(name) { closed.push(name); },
  });
  try {
    await f.run('open'); failed = true;
    await assert.rejects(f.run('close'), /checkpoint unavailable/);
    assert.equal(f.events.filter(event => event === 'release').length, 1);
    assert.deepEqual(closed, ['default']);
    assert.deepEqual(f.controller.inspectSessions(), []);
  } finally { await f.controller.dispose(); }
});

for (const resourceFailure of [false, true]) test(`custom ${resourceFailure ? 'resource limit retires' : 'validation failure preserves'} a healthy browser`, async () => {
  const f = fixture();
  const controller = createPlaywrightController({ adapter: { browsers: { chromium: { headed: false } }, async acquire() { return f.lease(); } },
    abilities: { open: true, snapshot: true, eval: { scope: 'session', async execute() { throw resourceFailure ? new PlaywrightResourceLimitError('Test resource limit') : new SyntaxError('Invalid tool parameters'); } } },
  });
  const run = (args: string[]) => controller.run({ args, env: {}, signal: new AbortController().signal, async write() {}, async writeArtifact() {} });
  try {
    await run(['open']);
    await assert.rejects(run(['eval', 'invalid']), resourceFailure ? /resource limit/ : /Invalid tool parameters/);
    assert.equal(controller.inspectSessions().length, resourceFailure ? 0 : 1);
    if (!resourceFailure) await run(['snapshot']);
  } finally { await controller.dispose(); await f.controller.dispose(); }
});

test('idle disposal waits for its storage checkpoint before closing the native context', async () => {
  let delaying = false;
  let entered!: () => void, finish!: () => void;
  const checkpointEntered = new Promise<void>(resolve => { entered = resolve; });
  const checkpointFinished = new Promise<void>(resolve => { finish = resolve; });
  const f = fixture({ async restore() { return undefined; }, async checkpoint() { if (delaying) { entered(); await checkpointFinished; } }, async delete() {} });
  await f.run('open');
  delaying = true;
  const disposing = f.controller.dispose();
  await checkpointEntered;
  await setImmediate();
  try { assert.equal(f.events.filter(event => event === 'release').length, 0); }
  finally { finish(); await disposing; }
  assert.equal(f.events.filter(event => event === 'release').length, 1);
});

test('a settled native action error leaves its healthy browser available for the next command', async () => {
  const f = fixture();
  try {
    await f.run('open');
    f.context.pages()[0]!.keyboard.press = async () => { throw new Error('Unknown key'); };
    await assert.rejects(f.run('press', 'unknown'), /Unknown key/);
    assert.equal(f.controller.inspectSessions().length, 1);
    await f.run('snapshot');
  } finally { await f.controller.dispose(); }
});

for (const command of ['open', 'goto', 'reload', 'snapshot']) test(`completed ${command} survives a cleaned checkpoint failure without replay`, async () => {
  let failing = false;
  let committed = 'previous';
  const f = fixture({ async restore() { return undefined; }, async delete() {}, async checkpoint(session) {
    if (failing) throw new PlaywrightStorageReadError(new Error('synthetic navigation timeout'));
    committed = session.selectedPage!.url();
  } });
  try {
    if (command !== 'open') await f.run('open', 'https://previous.example');
    const previous = committed;
    const context = command === 'open' ? undefined : f.context;
    failing = true;
    await assert.rejects(f.run(command, ...(['open', 'goto'].includes(command) ? ['https://completed.example'] : [])), /Action completed.*persistence failed/);
    assert.equal(f.controller.inspectSessions().length, 1);
    if (context) assert.equal(f.context, context);
    assert.equal(committed, previous);
    assert.ok(!f.events.includes('release'));
    assert.equal(f.events.filter(event => event === 'goto:https://completed.example').length, ['reload', 'snapshot'].includes(command) ? 0 : 1);
    failing = false;
    await f.run('snapshot');
    assert.equal(committed, f.context.pages()[0]!.url());
    await f.run('close');
    assert.equal(f.controller.inspectSessions().length, 0);
  } finally { failing = false; await f.controller.dispose(); }
});

test('unsafe checkpoint failure retires a session after a normal snapshot action', async () => {
  let failing = false;
  const f = fixture({ async restore() { return undefined; }, async delete() {}, async checkpoint() {
    if (failing) throw new Error('cleanup unconfirmed');
  } });
  try {
    await f.run('open');
    failing = true;
    await assert.rejects(f.run('snapshot'), /cleanup unconfirmed/);
    assert.equal(f.controller.inspectSessions().length, 0);
    assert.ok(f.events.includes('release'));
  } finally { failing = false; await f.controller.dispose(); }
});

test('typed checkpoint outcome preserves a custom ability result and retires on explicit close', async () => {
  const f = fixture();
  let failing = false;
  let executions = 0;
  const controller = createPlaywrightController({
    adapter: { browsers: { chromium: { headed: false } }, async acquire() { return f.lease(); } },
    abilities: { open: true, close: true, eval: { scope: 'session', async execute() {
      executions++;
      return { sections: [{ title: 'Result', content: 'completed custom action' }] };
    } } },
    persistence: { async restore() { return undefined; }, async delete() {}, async checkpoint() {
      return failing ? { status: 'storage-read-failed', error: new PlaywrightStorageReadError(new Error('read failed')) } : { status: 'committed' };
    } },
  });
  let output = '';
  const run = (args: string[]) => controller.run({ args, env: {}, signal: new AbortController().signal, async write(text) { output += text; } });
  try {
    await run(['open']);
    output = '';
    failing = true;
    await assert.rejects(run(['eval', '() => undefined']), /Action completed; persistence failed/);
    assert.equal(executions, 1);
    assert.match(output, /completed custom action/);
    assert.equal(controller.inspectSessions().length, 1);
    await assert.rejects(run(['close']), PlaywrightStorageReadError);
    assert.equal(controller.inspectSessions().length, 0);
  } finally { failing = false; await controller.dispose(); await f.controller.dispose(); }
});

test('graceful disposal releases the session even when the final checkpoint is recoverable', async () => {
  let failing = false;
  const f = fixture({ async restore() { return undefined; }, async delete() {}, async checkpoint() {
    if (failing) throw new PlaywrightStorageReadError(new Error('read failed'));
  } });
  await f.run('open');
  failing = true;
  await assert.rejects(f.controller.dispose(), AggregateError);
  assert.equal(f.controller.inspectSessions().length, 0);
  assert.ok(f.events.includes('release'));
});

test('expiration after a recoverable checkpoint still retires the live browser', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  let failing = false;
  const f = fixture({ async restore() { return undefined; }, async delete() {}, async checkpoint() {
    if (failing) throw new PlaywrightStorageReadError(new Error('read failed'));
  } });
  try {
    await f.run('open', '--idle-timeout=100');
    failing = true;
    await assert.rejects(f.run('snapshot'), /Action completed/);
    t.mock.timers.setTime(1200);
    await f.run('list');
    assert.equal(f.controller.inspectSessions().length, 0);
    assert.ok(f.events.includes('release'));
  } finally { failing = false; await f.controller.dispose(); }
});
