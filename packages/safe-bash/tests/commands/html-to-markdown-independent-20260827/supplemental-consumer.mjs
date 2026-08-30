import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { cases } from './frozen-cases.mjs';

const entry = process.env.REVIEW_PACKAGE;
const { createHtmlToMarkdownCommand, htmlToMarkdownCommands } = await import(pathToFileURL(entry + '/dist/commands/html-to-markdown/index.js').href);
const { toByteSource } = await import(pathToFileURL(entry + '/dist/contracts/index.js').href);
const { MemoryFileSystem } = await import(pathToFileURL(entry + '/dist/fs/memory/index.js').href);
const { Shell } = await import(pathToFileURL(entry + '/dist/shell/index.js').href);
const id = process.argv[2];
let actual;
async function convert(test, context = {}) {
  const stdout = [], stderr = [];
  const result = await createHtmlToMarkdownCommand({ limits: test.limits }).execute({ command: 'html-to-markdown', cwd: '/', env: {}, fs: new MemoryFileSystem(), args: test.args ?? [], signal: new AbortController().signal, stdin: toByteSource(test.input ?? ''), stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } }, ...context });
  actual = { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }; return actual;
}
try {
  if (id.endsWith('-v2') && id !== 'P11-shell-middleware-v2') {
    const test = cases.find(test => test.id === id.slice(0, -3)); assert(test);
    const result = await convert(test);
    if (id === 'L02-heading-paragraph-v2') { assert.equal(result.exitCode, 0); assert([test.expected, '## Title\n\nHello **world**.\n'].includes(result.stdout)); }
    if (id === 'L06-raw-ordinary-text-v2') { assert.equal(result.exitCode, 0); assert([test.expected, '\\<script\\>\\*x\\* \\[y\\](z)\n'].includes(result.stdout)); }
    if (id === 'B10-files-v2') { assert.equal(result.exitCode, 2); assert.equal(result.stderr, 'html-to-markdown: file limit exceeded\n'); }
    if (id === 'B11-args-v2') { assert.equal(result.exitCode, 2); assert.equal(result.stderr, 'html-to-markdown: argument limit exceeded\n'); }
    if (id === 'U-title-alt-injection-v2') { assert.equal(result.exitCode, 0); assert.equal(result.stdout, '[safe](<https://safe.test>)![\\] \\[evil\\](javascript:bad) \\<img src=x onerror=evil\\>](<https://safe.test/i>)\n'); }
  } else if (id === 'P11-shell-middleware-v2') {
    const fs = new MemoryFileSystem(), shell = new Shell({ fs }), seen = [];
    shell.use(async (context, next) => { seen.push(context.command); return await next(); }); shell.use(htmlToMarkdownCommands());
    try { const result = await shell.exec('html-to-markdown > /out', { stdin: '<p>shell</p>' }); assert.equal(result.exitCode, 0); const bytes = await fs.readFile('/out'); assert.equal(Buffer.from(bytes).toString(), 'shell\n'); assert.deepEqual(seen, ['html-to-markdown']); actual = { exitCode: result.exitCode, file: Buffer.from(bytes).toString(), seen }; } finally { await shell.dispose(); }
  } else if (id === 'shared-counters') {
    const outcomes = [];
    for (const [limit, maximum, input] of [['maxOutputBytes', 2, 'x'], ['maxTokens', 3, '<p>x</p>'], ['maxNodes', 2, '<p>x</p>'], ['maxTableCells', 2, '<table><tr><td>x</td></tr></table>'], ['maxWorkUnits', 20, 'x']]) {
      const limits = { [limit]: maximum };
      const one = await convert({ input, limits }); assert.equal(one.exitCode, 0, limit + ' individual');
      const fs = new MemoryFileSystem(); await fs.writeFile('/one', Buffer.from(input)); await fs.writeFile('/two', Buffer.from(input));
      const two = await convert({ args: ['/one', '/two'], limits }, { fs }); assert.equal(two.exitCode, 1, limit + ' shared');
      outcomes.push({ limit, maximum, one, two });
    }
    actual = { outcomes };
  } else if (id === 'primary-cleanup-error') {
    let returns = 0;
    const stdin = { [Symbol.asyncIterator]() { return { async next() { throw new Error('PRIMARY_READER'); }, async return() { returns++; throw new Error('SECONDARY_CLOSE'); } }; } };
    const result = await convert({}, { stdin }); assert.equal(result.exitCode, 1); assert.match(result.stderr, /PRIMARY_READER/u); assert(!result.stderr.includes('SECONDARY_CLOSE')); assert.equal(returns, 1);
  } else if (id === 'vfs-stream-signal-and-boundary') {
    let options, acquired = 0; const controller = new AbortController();
    const fs = { readStream(path, supplied) { assert.equal(path, '/input'); options = supplied; acquired++; return toByteSource('<p>vfs</p>'); }, readFile() { throw new Error('UNEXPECTED_FALLBACK'); } };
    const result = await convert({ args: ['/input'] }, { fs, signal: controller.signal }); assert.equal(result.stdout, 'vfs\n'); assert.equal(options.signal, controller.signal); assert.equal(acquired, 1);
  } else if (id === 'literal-file-cli-and-no-host') {
    const fs = new MemoryFileSystem(); await fs.writeFile('/-name', Buffer.from('<p>literal</p>'));
    assert.equal((await convert({ args: ['--', '-name'] }, { fs })).stdout, 'literal\n');
    const missing = await convert({ args: [process.env.REVIEW_POISON] }); assert.equal(missing.exitCode, 1); assert.match(missing.stderr, /ENOENT/u); assert(!missing.stderr.includes('POISONED_RETIRED_SOURCE_MUST_NOT_LOAD'));
    let reads = 0; const stdin = { [Symbol.asyncIterator]() { reads++; throw new Error('UNSOLICITED'); } };
    for (const args of [['--bogus'], ['-o', 'output']]) assert.equal((await convert({ args }, { stdin })).exitCode, 2);
    assert.equal(reads, 0);
  } else if (id === 'abort-during-trim') {
    const controller = new AbortController(), reason = new Error('ABORT_DURING_TRIM'); let timer;
    const stdin = (async function* () { yield Buffer.from('<pre>x' + ' '.repeat(131072) + 'x</pre>'); timer = setTimeout(() => { process.stderr.write('ABORT_CALLBACK_FIRED\n'); controller.abort(reason); }, 100); process.stderr.write('ABORT_SCHEDULED_AT_EOF\n'); })();
    try { await assert.rejects(convert({}, { stdin, signal: controller.signal }), error => error === reason); } finally { clearTimeout(timer); }
  } else if (id === 'custom') {
    const test = JSON.parse(readFileSync(process.argv[3])); const start = performance.now(); const result = await convert(test);
    actual = { ...result, elapsedMs: performance.now() - start };
    if (test.status !== undefined) assert.equal(result.exitCode, test.status);
    if (test.expected !== undefined) assert.equal(result.stdout, test.expected);
  } else throw new Error('unknown supplemental case ' + id);
  console.log(JSON.stringify({ id, outcome: 'PASS', actual }));
} catch (error) { console.log(JSON.stringify({ id, outcome: 'FAIL', actual, error: error.stack })); process.exitCode = 1; }
