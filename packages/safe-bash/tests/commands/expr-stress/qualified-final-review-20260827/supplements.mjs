import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import threads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { owned, save } from './prepare.mjs';
const { installed } = JSON.parse(readFileSync(join(owned, 'provenance.json')));
const base = pathToFileURL(installed + '/').href;
const workers = new Set(); let trace;
const NativeWorker = threads.Worker;
threads.Worker = class extends NativeWorker {
  constructor(url, options) { assert(url.href.startsWith(base)); trace.push({ type: 'acquire' }); super(url, options); workers.add(this); this.on('exit', () => workers.delete(this)); }
};
syncBuiltinESMExports();
const { createExprCommand } = await import(`${base}dist/commands/expr/index.js`);
const { Budget, settings, screenMatch } = await import(`${base}dist/commands/expr/internal.js`);
const { RegexSession } = await import(`${base}dist/commands/regex-execution/client.js`);
const originalCharge = Budget.prototype.charge, originalMatch = RegexSession.prototype.matchExpr;
let budget;
Budget.prototype.charge = function(amount = 1) { budget = this; const before = this.remaining(); try { return originalCharge.call(this, amount); } finally { trace.push({ type: 'charge', amount, before, after: this.remaining() }); } };
RegexSession.prototype.matchExpr = async function(descriptor, subject) { trace.push({ type: 'job', allowance: descriptor.limits.maxSteps, remaining: budget.remaining() }); const result = await originalMatch.call(this, descriptor, subject); trace.push({ type: 'result', steps: result.steps }); return result; };
const rows = [];
async function check(id, action) { try { await action(); rows.push({ id, passed: true }); } catch (error) { rows.push({ id, passed: false, error: error.stack }); } }
async function execute(argv, options = {}, env = { LC_ALL: 'en_US.UTF-8' }, reason) {
  trace = []; const stdout = [], stderr = [], cleanups = [], controller = new AbortController();
  if (arguments.length === 4) controller.abort(reason);
  let status, error;
  try { status = (await createExprCommand(options).execute({ command: 'expr', args: argv, env, cwd: '/', signal: controller.signal,
    get stdin() { throw Error('stdin acquired'); }, get fs() { throw Error('fs acquired'); },
    registerCleanup(cleanup) { trace.push({ type: 'register' }); cleanups.push(cleanup); },
    stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } } })).exitCode;
  } catch (caught) { error = caught; }
  const activeAtSettlement = workers.size;
  await Promise.all(cleanups.flatMap(cleanup => [cleanup(), cleanup()]));
  return { status, error, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), trace: [...trace], activeAtSettlement, activeAfterCleanup: workers.size, sameReason: error === reason };
}
try {
  for (const [id, subject, pattern, limits] of [
    ['pattern-byte-before-scan', 'a', '[é]', { maxRegexPatternBytes: 3 }],
    ['subject-byte-before-scan', 'éé', '[a]', { maxStringBytes: 3 }],
    ['both-byte-before-scan', 'éé', '[é]', { maxStringBytes: 3, maxRegexPatternBytes: 3 }],
  ]) await check(id, () => {
    trace = []; let indexReads = 0;
    const patternBytes = new Proxy(Buffer.from(pattern), { get(target, key) { if (/^\d+$/.test(String(key))) indexReads++; return Reflect.get(target, key, target); } });
    const screening = new Budget({ env: { LC_ALL: 'en_US.UTF-8' }, signal: new AbortController().signal }, settings({ limits }));
    assert.throws(() => screenMatch(Buffer.from(subject), patternBytes, screening), /regex input bytes limit exceeded/);
    assert.equal(indexReads, 0); assert.equal(trace.length, 0);
  });
  await check('byte-boundary-equal-scans-and-charges', () => {
    trace = []; const screening = new Budget({ env: { LC_ALL: 'en_US.UTF-8' }, signal: new AbortController().signal }, settings({ limits: { maxRegexPatternBytes: 3, maxStringBytes: 4 } }));
    assert.throws(() => screenMatch(Buffer.from('éé'), Buffer.from('[a]'), screening), /bracket expressions require/);
    assert.equal(trace[0].amount, 3);
  });
  for (const count of [1, 2, 3, 4, 5, 6]) await check(`escape-parity-${count}`, async () => {
    const actual = await execute(['\\'.repeat(Math.floor(count / 2)) + '[', ':', '\\'.repeat(count) + '[']);
    if (count % 2) { assert.equal(actual.status, 0); assert.equal(actual.stdout, `${Math.floor(count / 2) + 1}\n`); assert.equal(actual.trace.filter(event => event.type === 'job').length, 1); }
    else { assert.equal(actual.status, 2); assert.match(actual.stderr, /bracket expressions require/); assert.equal(actual.trace.filter(event => event.type === 'job').length, 0); }
    assert.equal(actual.activeAtSettlement, 0);
  });
  const allowances = [];
  for (const locale of ['C.UTF-8', 'en_US.UTF-8']) await check(`remaining-work-and-cleanup-${locale}`, async () => {
    const actual = await execute(['a', ':', 'a'], { limits: { maxSteps: 10000 } }, { LC_ALL: locale });
    const job = actual.trace.find(event => event.type === 'job');
    assert.equal(actual.status, 0); assert.equal(actual.stdout, '1\n'); assert.equal(job.allowance, job.remaining);
    const resultIndex = actual.trace.findIndex(event => event.type === 'result');
    assert.equal(actual.trace[resultIndex + 1].amount, actual.trace[resultIndex].steps);
    assert.equal(actual.trace[0].type, 'register'); assert(actual.trace.findIndex(event => event.type === 'acquire') > 0);
    assert.equal(actual.activeAtSettlement, 0); assert.equal(actual.activeAfterCleanup, 0);
    allowances.push({ locale, actual });
  });
  await check('named-scan-deducted-from-worker-allowance', () => assert.equal(allowances[0].actual.trace.find(event => event.type === 'job').allowance - allowances[1].actual.trace.find(event => event.type === 'job').allowance, 1));
  for (const [index, reason] of [0, false, '', null, Object.assign(new Error('cancelled'), { code: 'ENOENT' }), Symbol('cancelled')].entries()) await check(`cancel-identity-${index}`, async () => {
    const actual = await execute(['a', ':', '['], {}, { LC_ALL: 'en_US.UTF-8' }, reason);
    assert(actual.sameReason); assert.equal(actual.stdout, ''); assert.equal(actual.stderr, ''); assert.equal(actual.trace[0].type, 'register');
    assert(!actual.trace.some(event => event.type === 'acquire')); assert.equal(actual.activeAfterCleanup, 0);
  });
  for (const [index, argv] of [['1', '|', 'match', 'a', '[a]'], ['0', '&', 'match', 'a', '[a]'], ['1', '|', 'length', 'abc'], ['0', '&', 'substr', 'abc', '999', '1']].entries()) await check(`short-circuit-zero-jobs-${index}`, async () => {
    const actual = await execute(argv, { limits: { maxNumericDigits: 1 } }, { LC_ALL: 'unsupported-profile' });
    assert.equal(actual.stdout, index % 2 ? '0\n' : '1\n'); assert.equal(actual.stderr, ''); assert(!actual.trace.some(event => event.type === 'job' || event.type === 'acquire'));
  });
  save('postcandidate-supplements.json', { classification: 'Independent POSTCANDIDATE supplements, not prefreeze holdouts. Direct screenMatch byte-limit checks exercise production gate; Proxy only observes scan indexing. Cancellation/cleanup qualification is cooperative, not opaque-host waiting.', rows, allowances, total: rows.length, passed: rows.filter(row => row.passed).length, activeWorkers: workers.size });
  console.log(JSON.stringify({ total: rows.length, failed: rows.filter(row => !row.passed) }));
} finally { await Promise.all([...workers].map(worker => worker.terminate())); Budget.prototype.charge = originalCharge; RegexSession.prototype.matchExpr = originalMatch; threads.Worker = NativeWorker; syncBuiltinESMExports(); }
