import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { cases } from './frozen-cases.mjs';

const entry = process.env.REVIEW_PACKAGE;
const module = await import(pathToFileURL(entry + '/dist/commands/html-to-markdown/index.js').href);
const { createHtmlToMarkdownCommand, createHtmlToMarkdownCommands, htmlToMarkdownCommands } = module;
const { toByteSource, FsError, CommandRegistry } = await import(pathToFileURL(entry + '/dist/contracts/index.js').href);
const { MemoryFileSystem } = await import(pathToFileURL(entry + '/dist/fs/memory/index.js').href);
const { Shell } = await import(pathToFileURL(entry + '/dist/shell/index.js').href);
const id = process.argv[2];
const encoder = new TextEncoder();
let actual;
const sink = chunks => ({ async write(bytes) { chunks.push(Buffer.from(bytes)); } });
async function convert(input = '', options = {}) {
  const stdout = [], stderr = [], cleanup = [];
  const context = { command: 'html-to-markdown', args: [], cwd: '/', env: {}, fs: new MemoryFileSystem(), signal: new AbortController().signal, stdin: toByteSource(input), stdout: sink(stdout), stderr: sink(stderr), registerCleanup: callback => cleanup.push(callback), ...options.context };
  const result = await (options.command ?? createHtmlToMarkdownCommand({ limits: options.limits })).execute(context);
  actual = { exitCode: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
  return { ...actual, cleanup, context };
}
function check(test, output) {
  assert.equal(output.exitCode, test.status ?? 0);
  if (test.kind === 'literal') assert.equal(output.stdout, test.expected);
  if (test.kind === 'limit' || test.kind === 'bytes-error') assert.match(output.stderr, /^html-to-markdown:/u);
  if (test.kind === 'diagnostic') { assert(Buffer.byteLength(output.stderr) <= test.maximum); assert.match(output.stderr, /^html-to-markdown:/u); }
  if (test.kind !== 'invariant') return;
  const text = output.stdout;
  switch (test.rule) {
    case 'safe-link': assert(text.includes(`](<${test.destination}>)`) || text.includes(`](${test.destination})`)); assert(text.includes('[label]')); break;
    case 'record-destination-ambiguity': assert(text.includes('label')); break;
    case 'no-injected-active-markdown': assert(!text.includes('[evil](javascript:')); assert(!text.includes('<img src=x')); assert(!text.includes('title=')); assert(text.includes('safe')); break;
    case 'encoded-delimiters': assert(text.includes('%20')); assert(text.includes('%28')); assert(text.includes('%22')); assert(text.includes('%3E')); assert(text.includes('%5B')); break;
    case 'nested-list': assert.match(text, /^7\. +alpha/mu); assert.match(text, /^ +[-*+] +beta/mu); assert.match(text, /^8\. +gamma/mu); break;
    case 'quote': assert.match(text, /^> alpha/mu); assert.match(text, /^> beta/mu); break;
    case 'fence-preserves': assert.match(text, /^`{4,} ?js\nconst x = ```;\n\n end\n`{4,}\n$/u); break;
    case 'code-span-preserves': assert(text.includes('`x`')); assert.match(text, /^`{2,}/u); break;
    case 'table-content': assert(text.indexOf('cap') < text.indexOf('a')); assert(text.includes('b\\|c')); assert(text.includes('d')); assert.match(text, /\|\s*\|\s*\|\n\| ---/u); break;
    case 'rawtext-content': assert(text.includes('\\&amp;')); assert(text.includes('\\<b\\>X\\</b\\>')); assert(text.includes('\\<i\\>Y\\</i\\>')); break;
    case 'hardbreak-rule': assert.match(text, /a(?: {2}|\\)\nb/u); assert.match(text, /\n(?:---|\*\*\*)\n/u); break;
    default: throw new Error('unimplemented invariant ' + test.rule);
  }
}
async function frozen(test) {
  const input = test.bytes ? Uint8Array.from(test.bytes) : test.input;
  check(test, await convert(input, { limits: test.limits, context: { args: test.args ?? [] } }));
  if (test.everyByteSplit) {
    const bytes = encoder.encode(input);
    for (let boundary = 0; boundary <= bytes.length; boundary++) {
      const stdin = (async function* () { yield bytes.subarray(0, boundary); yield bytes.subarray(boundary); })();
      check(test, await convert('', { context: { stdin } }));
    }
    actual.splitBoundaries = bytes.length + 1;
  }
}
const protocols = {
  async 'P01-help-no-read'() {
    let reads = 0;
    const stdin = { [Symbol.asyncIterator]() { reads++; throw new Error('UNSOLICITED'); } };
    for (const arg of ['--help', '--version']) assert.equal((await convert('', { context: { args: [arg], stdin, fs: new Proxy({}, { get() { reads++; throw new Error('VFS'); } }) } })).exitCode, 0);
    assert.equal(reads, 0);
  },
  async 'P02-shared-stdin'() { const result = await convert('<p>once</p>', { context: { args: ['-', '-', '-'] } }); assert.equal(result.stdout, 'once\n'); assert.equal(result.exitCode, 0); },
  async 'P03-borrowed-buffer'() {
    const buffer = Buffer.alloc(16); const fragments = ['<p>alpha', ' beta</p>']; let index = 0;
    const stdin = { [Symbol.asyncIterator]() { return { async next() { buffer.fill(120); if (index === fragments.length) return { done: true }; const fragment = fragments[index++]; buffer.write(fragment); return { done: false, value: buffer.subarray(0, fragment.length) }; }, async return() { buffer.fill(90); return { done: true }; } }; } };
    assert.equal((await convert('', { context: { stdin } })).stdout, 'alpha beta\n');
  },
  async 'P04-abort-before-read'() {
    const controller = new AbortController(), reason = new Error('CALLER_BEFORE'); controller.abort(reason); let reads = 0;
    await assert.rejects(convert('', { context: { signal: controller.signal, stdin: { [Symbol.asyncIterator]() { reads++; throw new Error('read'); } } } }), error => error === reason); assert.equal(reads, 0);
  },
  async 'P05-abort-pending-read'() {
    const controller = new AbortController(), reason = new Error('CALLER_PENDING'); let returns = 0, resolveNext;
    const stdin = { [Symbol.asyncIterator]() { return { next() { queueMicrotask(() => controller.abort(reason)); return new Promise(resolve => { resolveNext = resolve; }); }, async return() { returns++; resolveNext({ done: true }); return { done: true }; } }; } };
    await assert.rejects(convert('', { context: { stdin, signal: controller.signal } }), error => error === reason); assert.equal(returns, 1);
  },
  async 'P06-backpressure'() {
    let active = 0, writes = 0, settled = false, release, first;
    const started = new Promise(resolve => { first = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    const stdout = { async write() { assert.equal(active, 0); active++; writes++; first(); await blocked; await pause(2); active--; } };
    const pending = convert('<p>' + 'x'.repeat(12000) + '</p>', { context: { stdout } }).then(result => { settled = true; return result; });
    await started; await pause(10); assert.equal(settled, false); assert.equal(writes, 1); release(); assert.equal((await pending).exitCode, 0); assert(writes > 1); assert.equal(active, 0); actual = { writes, awaited: true };
  },
  async 'P07-sink-error'() { const result = await convert('<p>x</p>', { context: { stdout: { async write() { throw new Error('SINK_FAILED'); } } } }); assert.equal(result.exitCode, 1); assert.match(result.stderr, /SINK_FAILED/u); await Promise.all(result.cleanup.map(callback => callback())); },
  async 'P08-vfs-failure'() {
    const fs = new MemoryFileSystem(); await fs.writeFile('/first', encoder.encode('<p>first</p>')); await fs.writeFile('/last', encoder.encode('<p>last</p>'));
    const result = await convert('', { context: { fs, args: ['/first', '/absent', '/last'] } }); assert.equal(result.exitCode, 1); assert.equal(result.stdout, 'first\n'); assert.match(result.stderr, /html-to-markdown:.*ENOENT.*absent/u);
  },
  async 'P09-shared-input-budget'() {
    const fs = new MemoryFileSystem(); await fs.writeFile('/one', encoder.encode('12345')); await fs.writeFile('/two', encoder.encode('67890'));
    const result = await convert('', { limits: { maxInputBytes: 8 }, context: { fs, args: ['/one', '/two'] } }); assert.equal(result.exitCode, 1); assert.equal(result.stdout, '12345\n');
  },
  async 'P10-registered-cleanup'() {
    let cleanup, resolveNext, returns = 0, acquired; const ready = new Promise(resolve => { acquired = resolve; });
    const stdin = { [Symbol.asyncIterator]() { assert.equal(typeof cleanup, 'function'); return { next() { acquired(); return new Promise(resolve => { resolveNext = resolve; }); }, async return() { returns++; await pause(5); resolveNext({ done: true }); return { done: true }; } }; } };
    const pending = convert('', { context: { stdin, registerCleanup: callback => { assert.equal(cleanup, undefined); cleanup = callback; } } });
    await ready; const first = cleanup(), second = cleanup(); assert.equal(first, second); await Promise.all([first, second]); await pending; assert.equal(returns, 1);
  },
  async 'P11-shell-middleware'() {
    const fs = new MemoryFileSystem(), shell = new Shell({ fs }); const seen = [];
    shell.use(async (context, next) => { seen.push(context.command); await next(); }); shell.use(htmlToMarkdownCommands());
    try { const result = await shell.exec('html-to-markdown > /out', { stdin: '<p>shell</p>' }); actual = result; assert.equal(result.exitCode, 0); assert.equal(Buffer.from(await fs.readFile('/out')).toString(), 'shell\n'); assert.deepEqual(seen, ['html-to-markdown']); } finally { await shell.dispose(); }
  },
  async 'P12-early-pipeline'() {
    const shell = new Shell({ fs: new MemoryFileSystem() }); shell.use(htmlToMarkdownCommands());
    shell.register({ name: 'take-one', async execute(context) { for await (const bytes of context.stdin) { await context.stdout.write(bytes.subarray(0, 1)); break; } return { exitCode: 0 }; } });
    try { const result = await shell.exec('html-to-markdown | take-one', { stdin: '<p>' + 'x'.repeat(20000) + '</p>' }); actual = result; assert.equal(result.stdout, 'x'); assert.equal(result.exitCode, 0); } finally { await shell.dispose(); }
  },
  async 'P13-host-denial'() {
    const result = await convert('<img src="https://must-not-fetch.test/x" alt="safe"><script>fetch("https://must-not-fetch.test")</script>'); assert.equal(result.exitCode, 0);
    assert.throws(() => readFileSync(process.env.REVIEW_POISON), error => error.code === 'ERR_ACCESS_DENIED');
    assert.throws(() => fetch('https://must-not-fetch.test'), /HOST_IO_DENIED:fetch/u);
  },
  async 'P14-fallback-read-bound'() {
    const calls = [], controller = new AbortController();
    const fs = { async readFile(path, options) { calls.push({ path, maxBytes: options.maxBytes }); assert.equal(options.signal, controller.signal); return encoder.encode('abc'); } };
    const result = await convert('', { limits: { maxInputBytes: 10 }, context: { fs, signal: controller.signal, args: ['/one', '/two'] } }); assert.equal(result.exitCode, 0); assert.deepEqual(calls, [{ path: '/one', maxBytes: 10 }, { path: '/two', maxBytes: 7 }]); actual = { ...actual, calls };
  },
  async 'P15-config-copy'() {
    const options = { limits: { maxInputBytes: 4 } }, command = createHtmlToMarkdownCommand(options); options.limits.maxInputBytes = 500;
    assert.equal((await convert('12345', { command })).exitCode, 1);
    for (const limits of [{ maxDepth: 257 }, { maxAttributes: 1025 }, { maxTokenBytes: 1048577 }, { maxWorkUnits: Infinity }, { maxNodes: 0 }, { maxInputBytes: -1 }, { maxTokens: 1.5 }]) assert.throws(() => createHtmlToMarkdownCommand({ limits }), RangeError);
  },
  async 'P16-factory-collision'() {
    assert.equal(createHtmlToMarkdownCommands().length, 1); const commands = new CommandRegistry(); const host = { commands };
    await htmlToMarkdownCommands().setup(host); assert.equal(commands.has('html-to-markdown'), true); assert.throws(() => htmlToMarkdownCommands().setup(host), /already registered/u); await htmlToMarkdownCommands({ replace: true }).setup(host);
  },
  async 'N02-poisoned-source'() { assert.equal((await convert('<p>installed</p>')).stdout, 'installed\n'); assert.throws(() => readFileSync(process.env.REVIEW_POISON), error => error.code === 'ERR_ACCESS_DENIED'); },
  async 'N05-wrong-literal'() { assert.equal((await convert('<p>actual</p>')).stdout, 'DELIBERATELY_WRONG\n'); },
  async 'N05-tiny-budget'() { assert.equal((await convert('<p>actual</p>', { limits: { maxWorkUnits: 1 } })).exitCode, 0); },
};
try {
  if (id === 'custom') {
    const test = JSON.parse(readFileSync(process.argv[3]));
    const start = performance.now(); const result = await convert(test.input, { limits: test.limits });
    actual = { ...actual, inputBytes: Buffer.byteLength(test.input), elapsedMs: performance.now() - start };
    if (test.expected !== undefined) assert.equal(result.stdout, test.expected);
    if (test.status !== undefined) assert.equal(result.exitCode, test.status);
  } else if (protocols[id]) await protocols[id]();
  else { const test = cases.find(test => test.id === id); assert(test, 'unknown case ' + id); await frozen(test); }
  console.log(JSON.stringify({ id, outcome: 'PASS', actual }));
} catch (error) {
  console.log(JSON.stringify({ id, outcome: 'FAIL', actual, error: error.stack })); process.exitCode = 1;
}
