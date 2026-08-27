import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const isolated = path.resolve(process.argv[2] ?? '');
assert.ok(isolated.startsWith(`${directory}/isolated-`), 'explicit prepared owned snapshot required');
const provenance = JSON.parse(readFileSync(path.join(isolated, 'provenance.json')));
const frozen = JSON.parse(readFileSync(path.join(directory, 'CASES.json')));
const regressions = JSON.parse(readFileSync(path.join(directory, 'HISTORICAL-REGRESSIONS.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const checkTree = (subdirectory, manifest, includePackage = false) => {
  const root = path.join(isolated, subdirectory);
  const inventory = folder => readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(folder, entry.name);
    return entry.isDirectory() ? inventory(filename) : [{ path: path.relative(root, filename), sha256: hash(readFileSync(filename)) }];
  }).sort((left, right) => left.path.localeCompare(right.path));
  const expected = [...manifest, ...(includePackage ? [{ path: 'package.json', sha256: hash('{"type":"module"}\n') }] : [])].sort((left, right) => left.path.localeCompare(right.path));
  assert.deepEqual(inventory(root), expected, subdirectory);
};
checkTree('source', provenance.after);
checkTree('compiled', provenance.emitted, true);
const threads = createRequire(import.meta.url)('node:worker_threads');
const NativeWorker = threads.Worker;
const workers = [];
class ObservedWorker extends NativeWorker {
  closed = false;
  terminations = 0;
  constructor(filename, options) {
    super(filename, options);
    workers.push(this);
    this.once('exit', () => { this.closed = true; });
  }
  terminate() { this.terminations++; return super.terminate(); }
}
threads.Worker = ObservedWorker;
syncBuiltinESMExports();
const load = filename => import(pathToFileURL(path.join(isolated, 'compiled', filename)).href);
const protocol = await load('src/commands/regex-execution/protocol.js');
const { RegexExecutor } = await load('src/commands/regex-execution/client.js');
const { run } = await load('tests/commands/expr/helpers.js');
const errorJSON = error => ({ name: error.name, code: error.code, category: error.category, message: error.message });
const capture = { started: new Date().toISOString(), base: provenance.base, workerSha256: provenance.workerSha256, patchSha256: provenance.patchSha256, shared: provenance.shared, casesSha256: hash(readFileSync(path.join(directory, 'CASES.json'))), rows: [], controls: [], scopedTests: [] };
const control = async (id, action) => {
  try { capture.controls.push({ id, passed: true, detail: await action() }); }
  catch (error) { capture.controls.push({ id, passed: false, error: errorJSON(error) }); }
};
const signal = () => new AbortController().signal;
const descriptor = (pattern, profile = 'byte', limits = {}) => ({ kind: 'expr-match', pattern: Buffer.from(pattern), profile, limits: { ...protocol.exprMatchCeilings, ...limits } });
const cases = [...frozen.cases, ...regressions.rows.map(row => ({ id: `historical/${row.id}`, subject: row.argv[1], pattern: row.argv[3], classification: 'historical-compatibility-replay' }))];
try {
  for (const fixture of cases) {
    const row = { id: fixture.id, classification: fixture.classification, profile: fixture.profile ?? 'byte' };
    const session = new RegexExecutor().open(signal());
    try {
      const subject = Buffer.from(fixture.subject);
      const request = descriptor(fixture.pattern, row.profile);
      row.result = await session.matchExpr(request, subject);
      protocol.validateExprReply({ id: 1, operation: 'expr-match', result: row.result }, 1, request, subject, signal());
      row.validSpans = true;
      row.captureHex = row.result.capture ? subject.subarray(row.result.capture.start, row.result.capture.end).toString('hex') : null;
      if (fixture.expected) {
        const observed = { matched: row.result.matched, wholeEnd: row.result.overall?.end ?? null, captureText: row.captureHex === null ? null : Buffer.from(row.captureHex, 'hex').toString() };
        row.expected = fixture.expected;
        row.establishedExpectationPass = JSON.stringify(observed) === JSON.stringify(fixture.expected);
      }
    } catch (error) { row.matchError = errorJSON(error); }
    finally { await session.close(); }
    try {
      const command = await run(['+', fixture.subject, ':', fixture.pattern], {}, { env: { LC_ALL: row.profile === 'byte' ? 'C' : 'C.UTF-8' } });
      row.command = { status: command.exitCode, stdoutHex: command.stdoutHex, stderrHex: Buffer.from(command.stderr).toString('hex') };
      if (fixture.historicalGNU) {
        row.originalGNUUnchanged = fixture.historicalGNU;
        row.originalGNUStrictAgreement = row.command.status === fixture.historicalGNU.status && row.command.stdoutHex === Buffer.from(fixture.historicalGNU.stdoutBase64, 'base64').toString('hex') && row.command.stderrHex === Buffer.from(fixture.historicalGNU.stderrBase64, 'base64').toString('hex');
      }
    } catch (error) { row.commandError = errorJSON(error); }
    capture.rows.push(row);
  }
  for (const key of frozen.controls.limits) await control(`budget/${key}`, async () => {
    const session = new RegexExecutor().open(signal());
    try {
      await assert.rejects(session.matchExpr(descriptor(frozen.controls.limitPattern, 'byte', { [key]: 1 }), Buffer.from(frozen.controls.limitSubject)), error => {
        assert.ok(error instanceof protocol.ExprMatchError);
        assert.equal(error.category, 'limit');
        return true;
      });
      return { limit: 1, identity: 'ExprMatchError', category: 'limit', noPartialMatch: true };
    } finally { await session.close(); }
  });
  const request = descriptor('\\(a\\)');
  const subject = Buffer.from('a');
  const valid = { offsetUnit: 'byte', matched: true, hasCapture: true, overall: { start: 0, end: 1 }, capture: { start: 0, end: 1 }, steps: 1 };
  const malformed = [
    ['half-negative', { ...valid, capture: { start: 0, end: -1 } }],
    ['out-of-subject', { ...valid, capture: { start: 0, end: 2 } }],
    ['outside-whole', { ...valid, overall: { start: 0, end: 0 } }],
    ['unmatched-capture', { ...valid, matched: false, overall: null }],
    ['extra-result-key', { ...valid, leakedHistory: true }],
  ];
  for (const [id, result] of malformed) await control(`protocol/${id}`, () => {
    assert.throws(() => protocol.validateExprReply({ id: 1, operation: 'expr-match', result }, 1, request, subject, signal()), error => error instanceof protocol.RegexExecutionError && error.code === 'PROTOCOL');
    return { rejected: true, errorClass: 'RegexExecutionError', code: 'PROTOCOL' };
  });
  await control('protocol/extra-reply-key', () => {
    assert.throws(() => protocol.validateExprReply({ id: 1, operation: 'expr-match', result: valid, history: [] }, 1, request, subject, signal()), error => error instanceof protocol.RegexExecutionError && error.code === 'PROTOCOL');
  });
  await control('protocol/invalid-limits', () => {
    assert.throws(() => protocol.validateExprInput({ ...request, limits: { ...request.limits, maxStates: 0 } }, [{ bytes: subject, all: false, terminated: false }], signal()), error => error instanceof protocol.RegexExecutionError && error.code === 'PROTOCOL');
  });
  await control('cancel/pre-abort-identity', async () => {
    const controller = new AbortController();
    const reason = Object.freeze({ code: 'ENOENT', marker: 'independent-abort-reason' });
    controller.abort(reason);
    const session = new RegexExecutor().open(controller.signal);
    try { await assert.rejects(session.matchExpr(request, subject), error => error === reason); }
    finally { await session.close(); }
    return { exactReasonPreserved: true };
  });
  await control('main-thread/refusal', async () => {
    const workerModule = await load('src/commands/expr/bre-worker.js');
    assert.throws(() => workerModule.matchExpr(request, subject), /requires the regex worker/u);
  });
  await control('branch/reused-session-after-failure', async () => {
    const session = new RegexExecutor().open(signal());
    try {
      await assert.rejects(session.matchExpr(descriptor('['), subject), error => error instanceof protocol.ExprMatchError && error.category === 'syntax');
      for (const id of ['branch-isolation-reversed', 'branch-absent-reference', 'branch-isolation-forward']) {
        const fixture = cases.find(row => row.id === id);
        const result = await session.matchExpr(descriptor(fixture.pattern), Buffer.from(fixture.subject));
        assert.equal(result.matched, fixture.expected.matched);
        assert.equal(result.overall?.end ?? null, fixture.expected.wholeEnd);
      }
      return { orderedCases: ['syntax error', 'reversed branch', 'absent branch', 'forward branch'], freshWorkUsable: true };
    } finally { await session.close(); }
  });
  for (const name of ['regex-protocol', 'regex-lifecycle', 'regex-limits', 'abort-reason-regression']) {
    const filename = path.join(isolated, 'compiled/tests/commands/expr', `${name}.test.js`);
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', filename], { cwd: isolated, timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C' } });
    const log = `${name}.tap`;
    writeFileSync(path.join(isolated, log), Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]), { flag: 'wx' });
    capture.scopedTests.push({ name, sourceSha256: provenance.after.find(entry => entry.path === `tests/commands/expr/${name}.test.ts`).sha256, status: result.status, signal: result.signal, error: result.error ? errorJSON(result.error) : null, log });
  }
} catch (error) {
  capture.failure = errorJSON(error);
  process.exitCode = 1;
} finally {
  const activeBeforeSafetyCleanup = workers.filter(worker => !worker.closed).length;
  await Promise.all(workers.filter(worker => !worker.closed).map(worker => worker.terminate()));
  threads.Worker = NativeWorker;
  syncBuiltinESMExports();
  capture.cleanup = { workers: workers.length, activeBeforeSafetyCleanup, activeAfter: workers.filter(worker => !worker.closed).length, terminations: workers.reduce((total, worker) => total + worker.terminations, 0), childProcesses: 'bounded spawnSync; each scoped test process owns its worker threads', caveat: 'No claim of preemption of opaque host promises.' };
  checkTree('source', provenance.after);
  checkTree('compiled', provenance.emitted, true);
  capture.postIntegrity = { originalFilesUnchanged: true, newlyAddedEntriesDetected: true, scope: 'isolated source and compiled trees, not entire repository' };
  capture.finished = new Date().toISOString();
  capture.counts = { cases: capture.rows.length, validResults: capture.rows.filter(row => row.validSpans).length, expectationDenominator: frozen.cases.filter(row => row.expected).length, expectationsMet: capture.rows.filter(row => row.establishedExpectationPass === true).length, observationsOnly: capture.rows.filter(row => !row.expected).length, controls: capture.controls.length, controlsPassed: capture.controls.filter(row => row.passed).length, originalGNUAgreement: capture.rows.filter(row => row.originalGNUStrictAgreement === true).length, originalGNUFailures: capture.rows.filter(row => row.originalGNUStrictAgreement === false).map(row => row.id), scopedFiles: capture.scopedTests.length, scopedFilesPassed: capture.scopedTests.filter(row => row.status === 0).length };
  writeFileSync(path.join(isolated, 'capture.json'), `${JSON.stringify(capture, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ counts: capture.counts, cleanup: capture.cleanup }));
}
