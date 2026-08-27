import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.env.REVIEW_PACKAGE;
const load = path => import(pathToFileURL(root + '/dist/' + path + '.js').href);
const { createHtmlToMarkdownCommand } = await load('commands/html-to-markdown/index');
const { MemoryFileSystem } = await load('fs/memory/index');
const { toByteSource } = await load('contracts/index');
const specification = JSON.parse(readFileSync(process.argv[2]));
let actual;
async function convert(test, supplied = {}) {
  const stdout = [], stderr = [], cleanups = [];
  const context = { command: 'html-to-markdown', args: [], cwd: '/', env: {}, fs: new MemoryFileSystem(), signal: new AbortController().signal, stdin: toByteSource(test.input ?? ''), stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } }, registerCleanup: callback => cleanups.push(callback), ...supplied };
  let result, failure;
  try { result = await createHtmlToMarkdownCommand({ limits: test.limits }).execute(context); } catch (error) { failure = error; }
  await Promise.all(cleanups.map(cleanup => cleanup()));
  actual = { exitCode: result?.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), cleanupCount: cleanups.length, failed: Boolean(failure) };
  if (failure) throw failure;
  return actual;
}
function check(test, result) {
  assert.equal(result.exitCode, test.status ?? 0);
  if (test.stdout !== undefined) assert.equal(result.stdout, test.stdout);
  assert.equal(result.stderr, test.stderr ?? '');
}
try {
  if (specification.action === 'abort') {
    const { Budget } = await load('commands/html-to-markdown/budget');
    const { Renderer } = await load('commands/html-to-markdown/render');
    const controller = new AbortController(), reason = Object.freeze({ tag: 'INDEPENDENT_RENDER_ABORT', id: specification.id });
    const events = [], start = performance.now(); let eof = false, finalized = 0, admitted = 0, renderStarted = false, startWork = 0, scheduled = false, triggerAt, settled = false, caught, timer;
    const event = (type, fields = {}) => events.push({ type, atMs: performance.now() - start, ...fields });
    const originalDocument = Renderer.prototype.document, originalCheckpoint = Budget.prototype.checkpoint;
    Renderer.prototype.document = function (...args) { renderStarted = true; startWork = this.budget.workUsed; event('render-start', { eof, admitted, work: startWork, aborted: controller.signal.aborted }); return originalDocument.apply(this, args); };
    Budget.prototype.checkpoint = function (...args) {
      if (specification.mode === 'in-flight' && renderStarted && !scheduled && this.workUsed > startWork && this.sinceYield >= 4096) {
        scheduled = true; event('checkpoint-admission', { renderWork: this.workUsed - startWork, sinceYield: this.sinceYield, aborted: controller.signal.aborted, settled });
        setImmediate(() => { triggerAt = performance.now(); event('trigger', { eof, admitted, renderStarted, settled }); controller.abort(reason); });
      }
      return originalCheckpoint.apply(this, args);
    };
    const stdin = (async function* () {
      try { admitted++; event('input-admission'); yield Buffer.from(specification.input); eof = true; event('input-eof');
        if (specification.mode === 'old-timer-observation') timer = setTimeout(() => { triggerAt = performance.now(); event('old-timer-trigger'); controller.abort(reason); }, 100);
      } finally { finalized++; event('input-finally'); }
    })();
    if (specification.mode === 'pre-abort') { triggerAt = performance.now(); controller.abort(reason); }
    try { await convert(specification, { stdin, signal: controller.signal }); } catch (error) { caught = error; }
    finally { settled = true; event('settled'); clearTimeout(timer); Renderer.prototype.document = originalDocument; Budget.prototype.checkpoint = originalCheckpoint; }
    const settlementMs = triggerAt === undefined ? null : performance.now() - triggerAt;
    const observation = { ...actual, mode: specification.mode, events, admitted, eof, finalized, renderStarted, triggerFired: triggerAt !== undefined, reasonIdentity: caught === reason, settlementMs, natural: true };
    actual = observation;
    if (specification.mode === 'in-flight') {
      assert.equal(caught, reason); assert(renderStarted && eof && scheduled && admitted === 1); assert.equal(finalized, 1);
      assert(settlementMs < 1000); assert.equal(actual.stdout, ''); assert.equal(actual.stderr, '');
      const trigger = events.find(row => row.type === 'trigger'); assert.equal(trigger.settled, false);
      const checkpoint = events.find(row => row.type === 'checkpoint-admission'); assert.equal(checkpoint.aborted, false); assert(checkpoint.renderWork > 0);
    } else if (specification.mode === 'pre-abort') { assert.equal(caught, reason); assert.equal(admitted, 0); assert.equal(renderStarted, false); }
    else if (specification.mode === 'no-trigger') { assert.equal(caught, undefined); check(specification, actual); assert.equal(finalized, 1); }
    else { assert(!caught || caught === reason); actual.classification = caught ? 'timer-abort-observed-not-guaranteed' : 'natural-fast-completion-NOT-abort-coverage'; }
  } else if (specification.action === 'direct-work') {
    const { Budget } = await load('commands/html-to-markdown/budget');
    const { settings } = await load('commands/html-to-markdown/options');
    const { trimText, normalizeText } = await load('commands/html-to-markdown/text');
    const { entities, destination, escapeText } = await load('commands/html-to-markdown/entities');
    const { Renderer } = await load('commands/html-to-markdown/render');
    const { Parser } = await load('commands/html-to-markdown/parser');
    const budget = new Budget({ signal: new AbortController().signal }, settings({ limits: { maxWorkUnits: specification.work, maxTokenBytes: 1048576 } }));
    const renderer = new Renderer(budget), parser = new Parser(budget);
    const operations = { trim: () => trimText(specification.input, budget), normalize: () => normalizeText(specification.input, budget, 'space'), entities: () => entities(specification.input, budget), destination: () => destination(specification.input, false, budget), escape: () => escapeText(specification.input, budget), language: () => renderer.language(specification.input), fence: () => renderer.fence(specification.input, 3), tag: () => parser.tag(specification.input) };
    let caught; try { await operations[specification.operation](); } catch (error) { caught = error; }
    actual = { code: caught?.code, message: caught?.message, workUsed: budget.workUsed };
    assert.equal(caught?.code, 'EFBIG'); assert.match(caught.message, /work limit exceeded/);
  } else if (specification.action === 'host-negative') {
    if (specification.operation === 'filesystem') assert.throws(() => readFileSync(process.env.REVIEW_POISON), { code: 'ERR_ACCESS_DENIED' });
    if (specification.operation === 'fetch') assert.throws(() => fetch('https://example.invalid'), /HOST_IO_DENIED:fetch/);
    if (specification.operation === 'child') { const { spawnSync } = await import('node:child_process'); assert.throws(() => spawnSync('true'), /HOST_IO_DENIED/); }
    if (specification.operation === 'net') { const { connect } = await import('node:net'); assert.throws(() => connect(9), /HOST_IO_DENIED/); }
    actual = { denial: specification.operation };
  } else {
    const results = [];
    check(specification, await convert(specification));
    if (specification.everyByteSplit) {
      const bytes = Buffer.from(specification.input);
      for (let boundary = 0; boundary <= bytes.length; boundary++) {
        const stdin = (async function* () { yield bytes.subarray(0, boundary); yield bytes.subarray(boundary); })();
        const result = await convert(specification, { stdin }); results.push({ boundary, ...result }); check(specification, result);
      }
      actual = { ...actual, splits: results };
    }
  }
  console.log(JSON.stringify({ id: specification.id, outcome: 'PASS', actual }));
} catch (error) { console.log(JSON.stringify({ id: specification.id, outcome: 'FAIL', actual, error: error.stack })); process.exitCode = 1; }
