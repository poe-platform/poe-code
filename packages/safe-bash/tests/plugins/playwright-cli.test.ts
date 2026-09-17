import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Volume } from 'memfs';
import { createPlaywrightCli } from '../../src/commands/playwright/index.js';
import { Shell } from '../../src/shell/index.js';
import { agentCommands } from '../../src/plugins/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import type { PlaywrightAdapter, PlaywrightPage } from '../../src/playwright/index.js';
import type { SnapshotNode } from '../../src/playwright/adapter.js';
import { createSnapshotFrame } from '../helpers/playwright-snapshot.js';

function fixture() {
  const volume = Volume.fromJSON({ '/work/.keep': '' });
  const output: string[] = [];
  let releases = 0;
  const adapter: PlaywrightAdapter = {
    browsers: { chromium: { headed: false } },
    async acquire(request) {
      output.push(request.session);
      volume.appendFileSync('/work/acquisitions', request.session + '\n');
      const page = { goto: async (url: string) => { output.push(url); }, url: () => 'about:blank' } as PlaywrightPage;
      return { context: { newPage: async () => page, pages: () => [page], close: async () => {}, on() {}, off() {} }, onClosed() { return () => {}; }, async release() { releases++; } };
    },
  };
  return { volume, output, adapter, get releases() { return releases; } };
}

test('standard help works through the shell with and without a configured adapter and never acquires a browser', async () => {
  const configured = fixture();
  for (const options of [{ adapter: configured.adapter }, {}]) {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    const cli = createPlaywrightCli(options);
    shell.use(cli.plugin);
    try {
      for (const args of ['--help', '-h', 'help']) {
        const result = await shell.exec(`playwright-cli ${args}`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, '');
        for (const expected of ['Usage:', 'close-all', '--session', '-s', 'PLAYWRIGHT_CLI_SESSION', 'default']) assert.ok(result.stdout.includes(expected), expected);
        for (const expected of ['open [url]', 'goto <url>', 'snapshot [target]', 'click <target> [button]', 'fill <target> <text>', 'press <key>', 'screenshot [target]', 'tab-list', 'tab-new', 'tab-select', 'tab-close', '--filename', '--full-page']) assert.equal(result.stdout.includes(expected), 'adapter' in options, expected);
        assert.ok(!result.stdout.includes('  cookie-list'));
        assert.ok(!result.stdout.includes('Network:'));
      }
      const unsupported = await shell.exec('playwright-cli run-code --help');
      assert.equal(unsupported.exitCode, 0);
      assert.ok(unsupported.stdout.includes('Not enabled by this client'));
      for (const args of ['click e1 right', 'snapshot e1', 'screenshot e1', 'cookie-list', 'requests', 'webmcp-list', '--json list', '--raw list', '--version']) {
        const result = await shell.exec(`playwright-cli ${args}`);
        assert.equal(result.exitCode, 1, args);
        assert.equal(result.stdout, '', args);
      }
    } finally { await shell.dispose(); }
  }
  assert.deepEqual(configured.output, []);
  assert.equal(configured.releases, 0);
});

test('command help accepts standard prefix and suffix forms without arguments or browser capabilities', async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  shell.use(createPlaywrightCli().plugin);
  try {
    for (const args of ['--help screenshot', 'screenshot --help', 'help screenshot']) {
      const result = await shell.exec(`playwright-cli ${args}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.ok(result.stdout.includes('Usage: playwright-cli screenshot'));
      assert.ok(result.stdout.includes('Not enabled by this client'));
      assert.ok(!result.stdout.includes('--filename'));
      assert.ok(!result.stdout.includes('--full-page'));
    }
    for (const args of ['open --help', 'goto --help', 'list --help', 'close --help', 'close-all --help', 'snapshot --help', 'click --help', 'fill --help', 'press --help', 'tab-list --help', 'tab-new --help', 'tab-select --help', 'tab-close --help', 'tab new --help', 'help tab', '--session research --help']) {
      const result = await shell.exec(`playwright-cli ${args}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.ok(result.stdout.includes('Usage:'));
    }
    const open = await shell.exec('playwright-cli open');
    assert.equal(open.exitCode, 1);
    assert.match(open.stderr, /not enabled/i);
  } finally { await shell.dispose(); }
});

test('opt-in plugin uses exported session values, shell pipelines and canonical virtual redirects', async () => {
  const f = fixture();
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  const shell = new Shell({ fs, cwd: '/work' });
  shell.use(agentCommands());
  await shell.exec('true');
  assert.equal(shell.commands.has('playwright-cli'), false);
  const controller = createPlaywrightCli({ adapter: f.adapter });
  shell.use(controller.plugin);
  const result = await shell.exec('PLAYWRIGHT_CLI_SESSION=local; playwright-cli open > opened; export PLAYWRIGHT_CLI_SESSION=exported; playwright-cli open; playwright-cli -s=flag open; playwright-cli list | cat > sessions');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(f.output, ['default', 'exported', 'flag']);
  assert.equal(f.volume.readFileSync('/work/acquisitions', 'utf8'), 'default\nexported\nflag\n');
  assert.equal(new TextDecoder().decode(await fs.readFile('/work/opened')), 'Session default open\n');
  assert.match(new TextDecoder().decode(await fs.readFile('/work/sessions')), /default\topen\nexported\topen\nflag\topen\n/);
  assert.equal(f.releases, 0);
  const closing = await shell.exec('playwright-cli close-all; playwright-cli -s=flag goto https://example.com');
  assert.equal(closing.exitCode, 1);
  assert.match(closing.stderr, /closed.*reopen/);
  assert.equal(f.releases, 3);
  await controller.dispose();
  await shell.dispose();
  assert.equal(f.releases, 3);
});

test('registration collision fails without replacement; unsupported flags are diagnostics before acquisition', async () => {
  const f = fixture();
  const shell = new Shell({ fs: new MemoryFileSystem() });
  const first = createPlaywrightCli({ adapter: f.adapter });
  shell.use(first.plugin);
  await shell.exec('playwright-cli list');
  assert.throws(() => createPlaywrightCli({ adapter: f.adapter }).plugin.setup(shell), /registered/);
  const result = await shell.exec('playwright-cli open --browser=webkit');
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Unsupported browser/);
  assert.deepEqual(f.output, []);
  await shell.dispose();
});


function interactiveFixture(limits = {}) {
  const volume = Volume.fromJSON({ '/work/.keep': '' });
  const fs = new MemoryFileSystem();
  const events: string[] = [];
  const pages: PlaywrightPage[] = [];
  const dom: { connected: boolean; name: string }[] = [];
  const listeners = new Map<PlaywrightPage, Map<string, Set<() => void>>>();
  let screenshotOptions: unknown;
  let screenshots = 0;
  const bytes = Buffer.from([0, 255, 128, 10]);
  function newPage() {
    let url = 'about:blank';
    const node = { connected: true, name: 'Same' }; dom.push(node);
    const elements = [0, 1].map(index => {
      const element = { tagName: 'BUTTON', get textContent() { return node.name; }, get isConnected() { return node.connected; }, getAttribute: () => null };
      const native = {
        async evaluate<T>(callback: (node: SnapshotNode) => T) { return callback(element); },
        async click() { events.push(`click:${pages.indexOf(page)}:${index}`); },
        async fill(value: string) { events.push(`fill:${pages.indexOf(page)}:${index}:${value}`); },
        async dispose() { events.push('handle:dispose'); },
      };
      return { node: element, native };
    });
    const snapshot = createSnapshotFrame(elements);
    const page: PlaywrightPage = {
      async goto(value) { url = value; for (const callback of listeners.get(page)?.get('framenavigated') ?? []) callback(); },
      url: () => url,
      locator: () => { throw new Error('Guest locator evaluation forbidden'); },
      frames: () => [snapshot.frame],
      keyboard: { async press(key) { events.push(`press:${key}`); } },
      async screenshot(options) { screenshots++; screenshotOptions = options; return bytes.subarray(0); },
      async close() { pages.splice(pages.indexOf(page), 1); for (const callback of listeners.get(page)?.get('close') ?? []) callback(); },
      on(event, listener) { const map = listeners.get(page)!; const set = map.get(event) ?? new Set(); set.add(listener); map.set(event, set); },
      off(event, listener) { listeners.get(page)?.get(event)?.delete(listener); },
    };
    listeners.set(page, new Map()); pages.push(page); return page;
  }
  const adapter: PlaywrightAdapter = { browsers: { chromium: { headed: false } }, async acquire() { events.push('acquire'); return {
    context: { newPage: async () => newPage(), pages: () => pages, async close() { events.push('release'); }, on() {}, off() {} },
    onClosed: () => () => {}, async release() { events.push('release'); },
  }; } };
  const controller = createPlaywrightCli({ adapter, limits });
  const shell = new Shell({ fs, cwd: '/work' }).use(agentCommands()).use(controller.plugin);
  return { volume, fs, shell, controller, events, pages, dom, bytes, newPage, get screenshotOptions() { return screenshotOptions; }, get screenshots() { return screenshots; } };
}

test('help preserves retained sessions and literal help-like action values', async () => {
  const fixture = interactiveFixture();
  try {
    const result = await fixture.shell.exec('playwright-cli open; playwright-cli snapshot; playwright-cli --help; playwright-cli fill e1 -- --help; playwright-cli press -- --help');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(fixture.events, ['acquire', 'fill:0:0:--help', 'press:--help']);
  } finally { await fixture.shell.dispose(); }
});

test('open rejects an injected context already at the tab limit before creating or navigating a page', async () => {
  const f = interactiveFixture({ maxTabs: 1 });
  f.newPage();
  const result = await f.shell.exec('playwright-cli open https://example.com');
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /tab limit/);
  assert.equal(f.pages.length, 1);
  assert.equal(f.pages[0]!.url(), 'about:blank');
  assert.deepEqual(f.events, ['acquire', 'release']);
  f.pages.splice(0);
  const reopened = await f.shell.exec('playwright-cli open; playwright-cli tab-list');
  assert.equal(reopened.exitCode, 0, reopened.stderr);
  assert.match(reopened.stdout, /0\tselected\t"about:blank"/);
  const full = await f.shell.exec('playwright-cli tab-new');
  assert.equal(full.exitCode, 1);
  assert.match(full.stderr, /tab limit/);
  assert.equal(f.pages.length, 1);
  assert.deepEqual(f.events, ['acquire', 'release', 'acquire']);
  await f.shell.dispose();
});

test('actual shell invokes snapshot, quoted ref actions, streams, statuses, and tab subset through middleware', async () => {
  const f = interactiveFixture(); await f.fs.mkdir('/work');
  const middleware: string[] = [];
  f.shell.use(async (context, next) => { if (context.command === 'playwright-cli') middleware.push(context.args.join('|')); return await next(); });
  const result = await f.shell.exec(`playwright-cli open; playwright-cli snapshot | cat > refs; playwright-cli click e2; playwright-cli fill e1 'a "quote"; $(literal)'; playwright-cli press 'Control+Enter'; playwright-cli tab-new https://example.com; playwright-cli tab-list; playwright-cli tab-select 0; playwright-cli tab-close 1`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(new TextDecoder().decode(await f.fs.readFile('/work/refs')), /Same.*ref=e2/);
  assert.ok(f.events.includes('click:0:1'));
  assert.ok(f.events.includes('fill:0:0:a "quote"; $(literal)'));
  assert.ok(f.events.includes('press:Control+Enter'));
  assert.equal(f.pages.length, 1);
  assert.equal(middleware.length, 9);
  const stale = await f.shell.exec('playwright-cli click e1 2> errors; echo $?');
  assert.equal(stale.stdout, '1\n');
  assert.match(new TextDecoder().decode(await f.fs.readFile('/work/errors')), /stale/);
  await f.shell.dispose();
});

test('screenshots are path-free bytes copied before awaited canonical VFS writes; limits reject before writes', async () => {
  const f = interactiveFixture(); await f.fs.mkdir('/work');
  await f.fs.mkdir('/artifacts'); await f.fs.symlink('/artifacts', '/work/link');
  const original = f.fs.writeFile.bind(f.fs);
  let settled = false;
  f.fs.writeFile = async (path, incoming, options) => {
    assert.equal(path, '/work/link/a b.png');
    // Buffer-only library callers receive an explicit Buffer conversion.
    const owned = Buffer.from(incoming as Uint8Array);
    f.bytes.fill(7);
    await Promise.resolve();
    f.volume.writeFileSync('/work/a b.png', owned);
    await original(path, incoming, options); settled = true;
  };
  const result = await f.shell.exec(`playwright-cli open; playwright-cli screenshot --filename='link/a b.png' --full-page`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(settled, true);
  assert.deepEqual([...await f.fs.readFile('/artifacts/a b.png')], [0, 255, 128, 10]);
  assert.deepEqual([...f.volume.readFileSync('/work/a b.png') as Buffer], [0, 255, 128, 10]);
  assert.deepEqual(f.screenshotOptions, { type: 'png', fullPage: true, timeout: 30000 });
  await f.shell.dispose();
  const bounded = interactiveFixture({ maxArtifactBytes: 3 }); await bounded.fs.mkdir('/work');
  const rejected = await bounded.shell.exec('playwright-cli open; playwright-cli screenshot --filename=x.png');
  assert.equal(rejected.exitCode, 1); assert.match(rejected.stderr, /limit/);
  await assert.rejects(bounded.fs.readFile('/work/x.png'));
  await bounded.shell.dispose();
});

test('unsupported commands, options and invalid arguments are preflighted before effects', async () => {
  const f = interactiveFixture(); await f.fs.mkdir('/work');
  for (const args of ['pdf', 'run-code "process.exit()"', 'install', 'kill-all', 'video-start', 'tracing-start', 'open --browser=webkit', 'screenshot --filename=x.pdf', 'click "page.locator(123)"', 'tab-new javascript:alert', 'tab-select -1', 'fill e1', 'snapshot --depth=3', 'screenshot --quality=90']) {
    const result = await f.shell.exec(`playwright-cli ${args}`);
    assert.equal(result.exitCode, 1, args);
  }
  assert.deepEqual(f.events, []);
  await f.shell.dispose();
});

test('navigation, dynamic DOM, external tabs and session generations invalidate refs without replay', async () => {
  const f = interactiveFixture(); await f.fs.mkdir('/work');
  const run = async (source: string) => { const result = await f.shell.exec(source); assert.equal(result.exitCode, 0, result.stderr); return result; };
  await run('playwright-cli open; playwright-cli snapshot');
  f.dom[0]!.connected = false;
  const detached = await f.shell.exec('playwright-cli click e1');
  assert.equal(detached.exitCode, 1); assert.match(detached.stderr, /stale/);
  f.dom[0]!.connected = true; f.dom[0]!.name = 'Changed';
  const next = await run('playwright-cli snapshot'); assert.match(next.stdout, /Changed.*e3/);
  await f.pages[0]!.goto('https://external.example');
  assert.equal((await f.shell.exec('playwright-cli click e3')).exitCode, 1);
  await run('playwright-cli snapshot; playwright-cli goto https://example.com');
  assert.equal((await f.shell.exec('playwright-cli click e5')).exitCode, 1);
  await run('playwright-cli snapshot');
  f.pages.push(f.pages[0]!); // Fake host-observed tab change.
  assert.equal((await f.shell.exec('playwright-cli click e7')).exitCode, 1); f.pages.pop();
  await run('playwright-cli close; playwright-cli open; playwright-cli snapshot');
  assert.equal((await f.shell.exec('playwright-cli click e1')).exitCode, 1);
  assert.equal(f.events.filter(event => event.startsWith('click:')).length, 0);
  await f.shell.dispose();
});

test('closing the last tab keeps the session usable for list/new/select, including externally closed selection', async () => {
  const f = interactiveFixture(); await f.fs.mkdir('/work');
  for (const source of ['playwright-cli open; playwright-cli tab close', 'playwright-cli tab list', 'playwright-cli tab new', 'playwright-cli tab new']) {
    const result = await f.shell.exec(source); assert.equal(result.exitCode, 0, result.stderr);
  }
  await f.pages[1]!.close();
  const result = await f.shell.exec('playwright-cli tab-select 0; playwright-cli snapshot');
  assert.equal(result.exitCode, 0, result.stderr);
  await f.shell.dispose();
});

test('borrowed mutable tab arrays cannot hide external tab changes from snapshot invalidation', async () => {
  const f = interactiveFixture(); await f.fs.mkdir('/work');
  const opened = await f.shell.exec('playwright-cli open; playwright-cli snapshot');
  assert.equal(opened.exitCode, 0, opened.stderr);
  // This injected context returns its live array. Mutating it must not also
  // mutate the controller's retained observation of the previous tab topology.
  f.newPage();
  const stale = await f.shell.exec('playwright-cli click e1');
  assert.equal(stale.exitCode, 1);
  assert.match(stale.stderr, /stale/);
  assert.equal(f.events.some(event => event.startsWith('click:')), false);
  f.pages.pop();
  const refreshed = await f.shell.exec('playwright-cli snapshot; playwright-cli click e3');
  assert.equal(refreshed.exitCode, 0, refreshed.stderr);
  await f.shell.dispose();
});

test('binary screenshot stdout streams through pipelines and propagates awaited output failure', async () => {
  const f = interactiveFixture(); await f.fs.mkdir('/work');
  const result = await f.shell.exec('playwright-cli open; playwright-cli screenshot | cat > shot.png');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual([...await f.fs.readFile('/work/shot.png')], [0, 255, 128, 10]);
  f.fs.writeFile = async () => { throw new Error('artifact destination failed'); };
  const failed = await f.shell.exec('playwright-cli screenshot --filename=x.png');
  assert.equal(failed.exitCode, 1); assert.match(failed.stderr, /artifact destination failed/);
  await f.shell.dispose();
});

test('middleware denial prevents effects and preserves command and pipeline statuses', async () => {
  const f = interactiveFixture(); await f.fs.mkdir('/work');
  await f.shell.exec('playwright-cli open; playwright-cli snapshot');
  f.shell.use(async (context, next) => context.command === 'playwright-cli' && context.args[0] === 'click' ? { exitCode: 42 } : await next());
  const denied = await f.shell.exec('playwright-cli click e1 | cat; printf "%s\\n" "${PIPESTATUS[@]}"');
  assert.equal(denied.exitCode, 0, denied.stderr);
  assert.equal(denied.stdout, '42\n0\n');
  assert.equal(f.events.some(event => event.startsWith('click:')), false);
  await f.shell.dispose();
});

test('snapshot artifact and tab limits reject publication or allocation, leaving sessions usable', async () => {
  const f = interactiveFixture({ maxSnapshotBytes: 1, maxTabs: 1 }); await f.fs.mkdir('/work');
  await f.shell.exec('playwright-cli open');
  const snapshot = await f.shell.exec('playwright-cli snapshot --filename=x.txt');
  assert.equal(snapshot.exitCode, 1); assert.match(snapshot.stderr, /limit/);
  await assert.rejects(f.fs.readFile('/work/x.txt'));
  const tab = await f.shell.exec('playwright-cli tab-new');
  assert.equal(tab.exitCode, 1); assert.match(tab.stderr, /limit/); assert.equal(f.pages.length, 1);
  assert.equal((await f.shell.exec('playwright-cli tab-list')).exitCode, 0);
  await f.shell.dispose();
});
