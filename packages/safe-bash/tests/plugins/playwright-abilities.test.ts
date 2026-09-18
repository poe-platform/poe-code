import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createPlaywrightController, playwrightCommandCatalog, type PlaywrightAbilities, type PlaywrightAbilityRequest, type PlaywrightCommand, type PlaywrightAdapter, type PlaywrightPage } from '../../src/playwright/index.js';
import { createPlaywrightCli } from '../../src/commands/playwright/index.js';
import { Shell } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';

function invocation(args: string[], write: (text: string) => Promise<void> = async () => {}) {
  return { args, env: {}, signal: new AbortController().signal, write };
}

test('an explicit client ability map controls dispatch while help keeps the standard command vocabulary', async () => {
  const calls: unknown[] = [];
  const controller = createPlaywrightController({ abilities: {
    'cookie-set': {
      options: ['domain', 'secure'],
      async execute(request) { calls.push([request.command, request.session, request.args, request.options]); await request.write('saved\n'); },
    },
  } });
  try {
    let help = '';
    await controller.run(invocation(['--help'], async text => { help += text; }));
    assert.ok(help.startsWith('playwright-cli - run playwright mcp commands from terminal\n\nUsage:'));
    assert.ok(help.includes('Storage:\n'));
    assert.ok(help.includes('cookie-set <name> <value>'));
    assert.ok(help.includes('  open [url]'));
    assert.ok(help.includes('Network:'));
    assert.ok(!help.includes('[unsupported]'));
    let output = '';
    await controller.run(invocation(['-s=research', 'cookie-set', 'token', 'value', '--domain', 'example.test', '--secure'], async text => { output += text; }));
    assert.equal(output, 'saved\n');
    assert.deepEqual(calls, [['cookie-set', 'research', ['token', 'value'], { domain: 'example.test', secure: true }]]);
    await assert.rejects(controller.run(invocation(['cookie-set', 'token', 'value', '--httpOnly'])), /Unsupported option/);
    await assert.rejects(controller.run(invocation(['open'])), /not enabled/);
    assert.equal(calls.length, 1);
  } finally { await controller.dispose(); }
});

test('the public catalog covers every command in the independent pinned upstream reference', () => {
  const reference = readFileSync(new URL('./fixtures/playwright-cli-0.1.20-help.txt', import.meta.url), 'utf8');
  const commands = reference.split('\n').filter(line => line.startsWith('  ') && !line.trimStart().startsWith('--')).map(line => line.trimStart().split(' ')[0]!);
  for (const command of commands) assert.ok(Object.hasOwn(playwrightCommandCatalog, command), command);
  assert.equal(Object.keys(playwrightCommandCatalog).length, 92);
});

test('full client implementations receive ordinary targets, optional buttons, variadic files and browser expressions as data', async () => {
  const calls: unknown[] = [];
  const execute = async (request: PlaywrightAbilityRequest) => { calls.push([request.command, request.args]); };
  const controller = createPlaywrightController({ abilities: {
    click: { execute }, snapshot: { execute }, upload: { execute }, eval: { execute },
    'run-code': { execute }, 'webmcp-call': { execute, options: ['params'] },
  } });
  try {
    for (const args of [['click', 'button[name=Save]', 'right'], ['snapshot', 'main'], ['upload', '/a.txt', '/b.txt'], ['eval', '() => window.title', 'main'], ['run-code', 'await page.title()'], ['webmcp-call', 'search', '--params', '{"query":"test"}']]) await controller.run(invocation(args));
    assert.equal(calls.length, 6);
    await assert.rejects(controller.run(invocation(['click'])), /Invalid arguments/);
    await assert.rejects(controller.run(invocation(['snapshot', 'one', 'two'])), /Invalid arguments/);
    await assert.rejects(controller.run(invocation(['upload'])), /Invalid arguments/);
  } finally { await controller.dispose(); }
});

test('all 92 upstream commands and every pinned command option reach an explicitly provided client handler', async () => {
  const reference = JSON.parse(readFileSync(new URL('./fixtures/playwright-cli-0.1.20-commands.json', import.meta.url), 'utf8')) as Record<PlaywrightCommand, { help: string; flags: Record<string, 'string' | 'boolean'>; args: string[] }>;
  const calls: PlaywrightAbilityRequest[] = [];
  const abilities = Object.fromEntries(Object.keys(reference).map(command => [command, { options: 'all', execute: async (request: PlaywrightAbilityRequest) => { calls.push(request); } }])) as PlaywrightAbilities;
  const controller = createPlaywrightController({ abilities });
  try {
    for (const [name, command] of Object.entries(reference)) {
      const args = command.help.split('\n')[0]!.split(' ').slice(2).filter(arg => arg.startsWith('<')).map(arg => arg.slice(1, -1));
      const options: Record<string, string | boolean | readonly string[]> = {};
      const flags: string[] = [];
      for (const [flag, type] of Object.entries(command.flags)) {
        if (flag === 'session') continue;
        flags.push(`--${flag}`);
        if (type === 'string') flags.push('value');
        const line = command.help.split('\n').find(line => line.trimStart().split(' ')[0] === `--${flag}`)!;
        options[flag] = type === 'boolean' ? true : line.includes('(repeatable)') ? ['value'] : 'value';
      }
      await controller.run(invocation([name, ...args, ...flags]));
      const call = calls.at(-1)!;
      assert.equal(call.command, name);
      assert.deepEqual(call.args, args, name);
      assert.deepEqual(call.options, options, name);
      assert.equal(call.browserSession, undefined);
    }
    assert.equal(calls.length, 92);
  } finally { await controller.dispose(); }
});

test('repeatable options, empty data, negative coordinates and literal flag-like arguments keep their values', async () => {
  const calls: PlaywrightAbilityRequest[] = [];
  const execute = async (request: PlaywrightAbilityRequest) => { calls.push(request); };
  const controller = createPlaywrightController({ abilities: { route: { execute, options: 'all' }, drop: { execute, options: 'all' }, mousemove: { execute }, type: { execute } } });
  try {
    await controller.run(invocation(['route', '**/api', '--header', 'a: b', '--header=c: d', '--body=']));
    assert.deepEqual(calls[0]!.options, { header: ['a: b', 'c: d'], body: '' });
    await controller.run(invocation(['drop', 'main', '--path=/one', '--path=/two', '--data=text/plain=hi']));
    assert.deepEqual(calls[1]!.options, { path: ['/one', '/two'], data: ['text/plain=hi'] });
    await controller.run(invocation(['mousemove', '-10', '-0.5']));
    assert.deepEqual(calls[2]!.args, ['-10', '-0.5']);
    await controller.run(invocation(['type', '--', '--help']));
    assert.deepEqual(calls[3]!.args, ['--help']);
    await assert.rejects(controller.run(invocation(['route', '**', '--body=a', '--body=b'])), /Repeated option/);
  } finally { await controller.dispose(); }
});

test('pinned optional-value flags and the install alias are supported without inventing defaults', async () => {
  const calls: PlaywrightAbilityRequest[] = [];
  const execute = async (request: PlaywrightAbilityRequest) => { calls.push(request); };
  const controller = createPlaywrightController({ abilities: { attach: { execute, options: ['extension'] }, install: { execute, options: ['skills', 'global'] } } });
  try {
    await controller.run(invocation(['attach', '--extension']));
    await controller.run(invocation(['attach', '--extension=chrome']));
    await controller.run(invocation(['install', '--skills', '-g']));
    assert.deepEqual(calls.map(call => call.options), [{ extension: true }, { extension: 'chrome' }, { skills: true, global: true }]);
    let help = '';
    await controller.run(invocation([], async text => { help += text; }));
    assert.ok(help.includes('Usage: playwright-cli'));
  } finally { await controller.dispose(); }
});

test('client configuration is validated and copied rather than allowing mutable option grants', async () => {
  const flags = ['domain'];
  let originalCalls = 0;
  const ability = { options: flags, execute: async () => { originalCalls++; } };
  const abilities = { 'cookie-set': ability };
  const controller = createPlaywrightController({ abilities });
  flags.push('secure');
  ability.execute = async () => { throw new Error('mutated callback'); };
  try {
    await controller.run(invocation(['cookie-set', 'name', 'value']));
    assert.equal(originalCalls, 1);
    await assert.rejects(controller.run(invocation(['cookie-set', 'name', 'value', '--secure'])), /Unsupported option/);
  } finally { await controller.dispose(); }
  for (const invalid of [{ unknown: { execute: async () => {} } }, { 'cookie-set': true }, { 'cookie-set': { execute: async () => {}, options: ['unknown'] } }, { 'cookie-set': { execute: async () => {}, options: ['domain', 'domain'] } }, { 'cookie-set': { execute: async () => {}, scope: 'session' } }, { 'cookie-set': false }]) {
    assert.throws(() => createPlaywrightController({ abilities: invalid as unknown as PlaywrightAbilities }));
  }
});

test('the actual CLI wires uploads, state files and binary response artifacts through the virtual filesystem', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  await fs.writeFile('/work/input.bin', new Uint8Array([0, 255, 128]));
  const shell = new Shell({ fs, cwd: '/work' });
  shell.use(createPlaywrightCli({ abilities: {
    upload: { async execute(request) { const bytes = await request.readFile(request.args[0]!); assert.deepEqual([...bytes], [0, 255, 128]); await request.write('uploaded\n'); } },
    'response-body': { options: ['filename'], async execute(request) { await request.writeArtifact(new Uint8Array([0, 254, 129]), request.options.filename as string); } },
    'state-save': { async execute(request) { await request.writeArtifact(new TextEncoder().encode('{"cookies":[]}'), request.args[0]); } },
    'state-load': { async execute(request) { assert.equal(new TextDecoder().decode(await request.readFile(request.args[0]!)), '{"cookies":[]}'); } },
  } }).plugin);
  try {
    for (const command of ['upload input.bin', 'response-body 0 --filename response.bin', 'state-save state.json', 'state-load state.json']) {
      const result = await shell.exec(`playwright-cli ${command}`);
      assert.equal(result.exitCode, 0, result.stderr);
    }
    assert.deepEqual([...await fs.readFile('/work/response.bin')], [0, 254, 129]);
    const missing = await shell.exec('playwright-cli upload missing.bin');
    assert.equal(missing.exitCode, 1);
  } finally { await shell.dispose(); }
});

function retainedFixture() {
  const events: string[] = [];
  const page = { goto: async () => {}, url: () => 'about:blank' } as unknown as PlaywrightPage;
  const pages = [page];
  const context = { newPage: async () => page, pages: () => pages, close: async () => {}, on() {}, off() {} };
  const adapter: PlaywrightAdapter = { browsers: { chromium: { headed: false } }, async acquire() { return { context, onClosed() { return () => {}; }, async release() { events.push('released'); } }; } };
  return { adapter, context, page, pages, events };
}

test('session abilities borrow the retained context and register cleanup that runs before browser release', async () => {
  const fixture = retainedFixture();
  const controller = createPlaywrightController({ adapter: fixture.adapter, abilities: {
    open: true, close: true,
    'cookie-get': { scope: 'session', async execute(request) {
      assert.equal(request.browserSession!.context, fixture.context);
      assert.equal(request.browserSession!.page, fixture.page);
      request.browserSession!.registerCleanup(async () => { fixture.events.push('session-cleanup'); });
      request.registerCleanup(async () => { fixture.events.push('invocation-cleanup'); });
      await request.write('cookie\n');
    } },
  } });
  try {
    await controller.run(invocation(['open']));
    await controller.run(invocation(['cookie-get', 'name']));
    assert.deepEqual(fixture.events, ['invocation-cleanup']);
    await controller.run(invocation(['close']));
    assert.deepEqual(fixture.events, ['invocation-cleanup', 'session-cleanup', 'released']);
  } finally { await controller.dispose(); }
});

test('a resource-limited borrowed ability retires its session and preserves execution plus cleanup errors', async () => {
  const fixture = retainedFixture();
  const executeFailure = new PlaywrightResourceLimitError('ability resource limit');
  const cleanupFailure = new Error('cleanup failed');
  const controller = createPlaywrightController({ adapter: fixture.adapter, abilities: {
    open: true, 'cookie-get': { scope: 'session', async execute(request) { request.browserSession!.registerCleanup(async () => { throw cleanupFailure; }); throw executeFailure; } },
  } });
  await controller.run(invocation(['open']));
  await assert.rejects(controller.run(invocation(['cookie-get', 'name'])), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [executeFailure, cleanupFailure]);
    return true;
  });
  assert.deepEqual(fixture.events, ['released']);
  await assert.rejects(controller.dispose(), AggregateError);
});

test('borrowed abilities never receive a selected page that was externally closed', async () => {
  const fixture = retainedFixture();
  const controller = createPlaywrightController({ adapter: fixture.adapter, abilities: {
    open: true, 'cookie-list': { scope: 'session', async execute(request) {
      assert.equal(request.browserSession!.context, fixture.context);
      assert.equal(request.browserSession!.page, undefined);
    } },
  } });
  try {
    await controller.run(invocation(['open']));
    fixture.pages.length = 0;
    await controller.run(invocation(['cookie-list']));
  } finally { await controller.dispose(); }
});

test('session cleanup cannot prevent browser release from unblocking in-flight browser work', async () => {
  const fixture = retainedFixture();
  let finishCleanup!: () => void;
  let cleanupStarted!: () => void;
  const pending = new Promise<void>(resolve => { finishCleanup = resolve; });
  const started = new Promise<void>(resolve => { cleanupStarted = resolve; });
  const controller = createPlaywrightController({ adapter: fixture.adapter, abilities: {
    open: true, close: true, requests: { scope: 'session', async execute(request) {
      request.browserSession!.registerCleanup(async () => { cleanupStarted(); await pending; });
    } },
  } });
  await controller.run(invocation(['open']));
  await controller.run(invocation(['requests']));
  const closing = controller.run(invocation(['close']));
  try {
    await started;
    await Promise.resolve();
    assert.deepEqual(fixture.events, ['released']);
  } finally { finishCleanup(); await closing; await controller.dispose(); }
});
import { PlaywrightResourceLimitError } from '../../src/playwright/resource-limit.js';
