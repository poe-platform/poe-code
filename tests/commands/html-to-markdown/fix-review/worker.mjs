import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [build, encoded] = process.argv.slice(2), job = JSON.parse(encoded);
const { createHtmlToMarkdownCommand } = await import(pathToFileURL(build + '/commands/html-to-markdown/index.js'));
const { MemoryFileSystem } = await import(pathToFileURL(build + '/fs/memory/index.js'));
const { toByteSource } = await import(pathToFileURL(build + '/contracts/index.js'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const controller = new AbortController(), reason = Object.freeze({ reason: 'repair-caller-abort' });
let timer, fired = false, eof = false, returns = 0;
const output = [], diagnostic = [], cleanups = [];
let input = job.input ?? '', expected;
const size = job.size;
if (job.form === 'unterminated-quoted-attribute') input = '<a title="' + 'x'.repeat(size);
if (job.form === 'repeated-less-than') input = '<'.repeat(size);
if (job.form === 'rawtext-close-near-miss') input = '<script>' + '</scripX>'.repeat(Math.ceil(size / 9));
if (job.form === 'long-entity') input = '&' + 'x'.repeat(size) + ';';
if (job.form === 'alternating-backticks') input = '<pre>' + '` '.repeat(size / 2) + '</pre>';
if (job.form === 'trim-internal-space') { input = '<pre>x' + ' '.repeat(size) + 'x</pre>'; expected = '```\nx' + ' '.repeat(size) + 'x\n```\n'; }
if (job.form === 'unresolved-entity-regex') { input = '<a href="' + '&#'.repeat(size / 2) + '">label</a>'; expected = '[label](<' + '&#'.repeat(size / 2) + '>)\n'; }
if (job.form === 'slash-attribute-neighbor') input = '<a ' + '/ '.repeat(size / 2) + '>label</a>';
const stdin = job.abort === undefined ? toByteSource(input) : (async function* () {
  try {
    yield Buffer.from(input); eof = true;
    const abort = () => { fired = true; controller.abort(reason); };
    timer = job.abort === 'immediate' ? setImmediate(abort) : setTimeout(abort, job.abort);
  } finally { returns++; }
})();
const started = performance.now();
let result, rejection;
try {
  result = await createHtmlToMarkdownCommand({ limits: job.limits ?? { maxTokenBytes: 1048576, maxTokens: 1000000, maxNodes: 1000000 } }).execute({
    command: 'html-to-markdown', args: [], stdin,
    stdout: { async write(bytes) { output.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { diagnostic.push(new Uint8Array(bytes)); } },
    cwd: '/', env: Object.create(null), fs: new MemoryFileSystem(), signal: controller.signal,
    registerCleanup(cleanup) { cleanups.push(cleanup); },
  });
} catch (error) { rejection = error; }
finally {
  if (job.abort === 'immediate') clearImmediate(timer); else clearTimeout(timer);
  for (const cleanup of cleanups) await cleanup();
}
const stdout = Buffer.concat(output), stderr = Buffer.concat(diagnostic).toString();
if (job.abort !== undefined) {
  assert.equal(eof, true); assert.equal(returns, 1);
  if (fired) { assert.equal(rejection, reason); assert.equal(stdout.length, 0); }
  else { assert.equal(rejection, undefined); assert.equal(result.exitCode, 0); assert.equal(stdout.toString(), expected); }
  if (job.abort === 'immediate') assert.equal(fired, true);
} else {
  assert.equal(rejection, undefined);
  if (expected !== undefined) { assert.equal(result.exitCode, 0); assert.equal(stdout.toString(), expected); assert.equal(stderr, ''); }
  if (job.expected !== undefined) { assert.equal(result.exitCode, 0); assert.equal(stdout.toString(), job.expected); }
}
console.log(JSON.stringify({ id: job.id, form: job.form, size, inputSHA256: hash(input), exitCode: result?.exitCode, outputBytes: stdout.length, outputSHA256: hash(stdout), stderr, elapsedMs: performance.now() - started, aborted: fired, eof, returns, exactOutputChecked: expected !== undefined || job.expected !== undefined, output: job.returnOutput ? stdout.toString() : undefined, loadedEntrySHA256: hash(readFileSync(build + '/commands/html-to-markdown/index.js')), runtime: process.version }));
