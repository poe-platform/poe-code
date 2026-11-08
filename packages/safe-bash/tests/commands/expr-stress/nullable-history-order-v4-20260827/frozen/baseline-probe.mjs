import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { addFile, directory, errorJSON, hash, json } from './common.mjs';

const compiled = path.resolve(process.argv[2]);
const provenance = JSON.parse(readFileSync(process.argv[3]));
const inputs = json('INPUTS.json');
const native = json('native-01.json');
const manifest = json('FREEZE-MANIFEST.json');
assert.equal(provenance.baseline, inputs.baseline);
assert.equal(hash(readFileSync(path.join(compiled, 'commands/expr/bre-worker.js'))), provenance.workerCompiledSha256);
const threads = createRequire(import.meta.url)('node:worker_threads');
const NativeWorker = threads.Worker;
const workers = [];
let admission;
class ObservedWorker extends NativeWorker {
  closed = false;
  terminations = 0;
  constructor(filename, options) {
    assert.ok(admission?.registered, 'cleanup owner must be enrolled before worker acquisition');
    super(filename, options);
    this.owner = admission.kind;
    workers.push(this);
    this.once('exit', () => { this.closed = true; });
  }
  terminate() { this.terminations++; return super.terminate(); }
}
threads.Worker = ObservedWorker;
syncBuiltinESMExports();
const load = filename => import(pathToFileURL(path.join(compiled, filename)).href);
const { RegexExecutor } = await load('commands/regex-execution/client.js');
const protocol = await load('commands/regex-execution/protocol.js');
const { createExprCommand } = await load('commands/expr/index.js');
const { createMemoryFileSystem } = await load('fs/memory/index.js');
const { settings } = await load('commands/expr/internal.js');
const capture = { started: new Date().toISOString(), baseline: inputs.baseline, freezeCommit: provenance.freezeCommit, workerSourceSha256: provenance.workerSourceSha256, workerCompiledSha256: provenance.workerCompiledSha256, hostEnvironment: process.env, inputSha256: native.inputSha256, commandLimits: settings({}), directLimits: protocol.exprMatchCeilings, executorOptions: protocol.defaults, commandAPI: 'createExprCommand().execute with real memory FS; not Shell.exec; portable and + argv are separate actual invocations', rows: [], controls: [], issues: [] };
const match = async (fixture, overrides = {}) => {
  const controller = new AbortController();
  const executor = new RegexExecutor();
  let session;
  let closing;
  const close = () => closing ??= (async () => { await session?.close(); await executor.dispose(); })();
  admission = { kind: `direct/${fixture.id}`, registered: true };
  const descriptor = { kind: 'expr-match', pattern: Buffer.from(fixture.pattern), profile: 'byte', limits: { ...protocol.exprMatchCeilings, ...overrides } };
  const subject = Buffer.from(fixture.subject);
  try {
    session = executor.open(controller.signal);
    const result = await session.matchExpr(descriptor, subject);
    protocol.validateExprReply({ id: 1, operation: 'expr-match', result }, 1, descriptor, subject, controller.signal);
    return { descriptor: { ...descriptor, pattern: descriptor.pattern.toString('hex') }, result, captureHex: result.capture ? subject.subarray(result.capture.start, result.capture.end).toString('hex') : null, validated: true };
  } catch (error) { return { error: errorJSON(error) }; }
  finally { await Promise.all([close(), close()]); admission = undefined; }
};
async function runCommand(fixture, form, behavior = {}) {
  const controller = behavior.controller ?? new AbortController();
  const registered = [];
  const stdout = [];
  const stderr = [];
  const bytes = { stdout: 0, stderr: 0 };
  const args = [...(form === 'plus' ? ['+'] : []), fixture.subject, ':', fixture.pattern];
  admission = { kind: `command/${fixture.id}/${form}`, registered: false };
  const sink = (name, chunks) => ({ async write(chunk) {
    bytes[name] += chunk.byteLength;
    assert.ok(bytes[name] <= 65536, 'bounded collected output');
    chunks.push(new Uint8Array(chunk));
  } });
  const context = {
    command: 'expr', args, cwd: '/', env: { LC_ALL: 'C' }, fs: createMemoryFileSystem(), signal: controller.signal,
    stdinIsDefault: true,
    stdin: { [Symbol.asyncIterator]() { throw new Error('argv-only expr acquired stdin'); } },
    stdout: sink('stdout', stdout), stderr: sink('stderr', stderr),
    registerCleanup(cleanup) { registered.push(cleanup); admission.registered = true; if (behavior.closeAtRegistration) void cleanup(); },
  };
  const workerStart = workers.length;
  let outcome;
  try { const result = await createExprCommand().execute(context); outcome = { status: result.exitCode }; }
  catch (error) { outcome = { error: errorJSON(error), exactAbortReason: error === controller.signal.reason }; }
  finally {
    await Promise.all(registered.flatMap(cleanup => [cleanup(), cleanup()]));
    assert.ok(workers.slice(workerStart).every(worker => worker.closed), 'command cleanup drains its workers');
    admission = undefined;
  }
  return { argv0: 'expr (virtual CommandContext.command; not OS argv0)', argv: args, environment: context.env, cwd: '/', ...outcome, stdoutHex: Buffer.concat(stdout).toString('hex'), stderrHex: Buffer.concat(stderr).toString('hex'), registeredCleanups: registered.length, workers: workers.length - workerStart, allWorkersClosed: true };
}
const semanticEqual = (command, observed) => command.status === observed.status && command.stdoutHex === observed.stdoutHex && command.stderrHex === observed.stderrHex;
try {
  for (const fixture of inputs.cases) {
    const row = { id: fixture.id, subject: fixture.subject, pattern: fixture.pattern, match: await match(fixture), commands: {} };
    for (const form of ['portable', 'plus']) row.commands[form] = await runCommand(fixture, form);
    const observations = native.rows.find(item => item.id === fixture.id).observations;
    row.profileAgreement = { gnuPortable: semanticEqual(row.commands.portable, observations['gnu-portable']), gnuPlus: semanticEqual(row.commands.plus, observations['gnu-plus']), applePortable: semanticEqual(row.commands.portable, observations['apple-portable']) };
    row.classification = row.match.error?.category === 'unsupported' ? 'guarded-unsupported-not-pass' : row.match.error ? 'error-not-semantic-pass' : 'supported-observation';
    if (fixture.id === 'P-aaa') row.rootNarrowPass = semanticEqual(row.commands.plus, inputs.projectRules['P-aaa'].command);
    capture.rows.push(row);
    const newPair = manifest.origins.find(item => item.id === fixture.id).classification.startsWith('new-pair');
    if (newPair && row.classification === 'supported-observation' && !row.profileAgreement.gnuPlus && observations['gnu-plus'].status < 2) {
      const issue = { id: fixture.id, qualification: 'Newly demonstrated supported-profile discrepancy on this frozen pair relative to listed historical catalogs; not universal POSIX bug, not invalidation of historical scoped acceptance, not a source fix.', baseline: inputs.baseline, sourceSha256: provenance.workerSourceSha256, commandSourceSha256: provenance.commandSourceSha256, freezeCommit: provenance.freezeCommit, input: fixture, command: row.commands.plus, directWorker: row.match, native: { profile: native.profiles.gnu, observation: observations['gnu-plus'], otherProfile: observations['apple-portable'] } };
      capture.issues.push(issue);
      if (capture.issues.length === 1) addFile('/tmp/expr-history-freeze-v4-20260827-issue.txt', `${JSON.stringify(issue, null, 2)}\n`);
    }
  }
  const control = async (id, action) => {
    try { capture.controls.push({ id, passed: true, detail: await action() }); }
    catch (error) { capture.controls.push({ id, passed: false, error: errorJSON(error) }); }
  };
  const fixture = inputs.cases.find(row => row.id === 'prefix-star');
  await control('pre-aborted-command-no-worker', async () => {
    const controller = new AbortController();
    controller.abort(new Error('owned baseline abort reason'));
    const result = await runCommand(fixture, 'plus', { controller });
    assert.equal(result.exactAbortReason, true);
    assert.equal(result.workers, 0);
    return result;
  });
  await control('cleanup-closes-before-acquisition', async () => {
    const result = await runCommand(fixture, 'plus', { closeAtRegistration: true });
    assert.equal(result.error?.code, 'CLOSED');
    assert.equal(result.workers, 0);
    return result;
  });
  await control('one-work-unit-refuses-not-best-so-far', async () => {
    const result = await match(fixture, { maxSteps: 1 });
    assert.equal(result.error?.category, 'limit');
    return result;
  });
  await control('main-thread-execution-refused', async () => {
    const workerModule = await load('commands/expr/bre-worker.js');
    assert.throws(() => workerModule.matchExpr({ kind: 'expr-match', pattern: Buffer.from(fixture.pattern), profile: 'byte', limits: protocol.exprMatchCeilings }, Buffer.from(fixture.subject)), /requires the regex worker/u);
    return { executionRefusedBeforeCompilation: true };
  });
} catch (error) { capture.failure = errorJSON(error); }
finally {
  const activeBeforeSafetyCleanup = workers.filter(worker => !worker.closed).length;
  await Promise.all(workers.filter(worker => !worker.closed).map(worker => worker.terminate()));
  threads.Worker = NativeWorker;
  syncBuiltinESMExports();
  capture.cleanup = { workers: workers.length, activeBeforeSafetyCleanup, activeAfterSafetyCleanup: workers.filter(worker => !worker.closed).length, terminationCalls: workers.reduce((total, worker) => total + worker.terminations, 0), admissionCheckedOnEveryWorker: true, opaqueHostPreemptionClaim: false };
  capture.finished = new Date().toISOString();
  capture.counts = { focusedInputs: capture.rows.length, commandInvocations: capture.rows.length * 2, supportedObservations: capture.rows.filter(row => row.classification === 'supported-observation').length, guardedUnsupported: capture.rows.filter(row => row.classification === 'guarded-unsupported-not-pass').length, errors: capture.rows.filter(row => row.classification === 'error-not-semantic-pass').length, newGNUProfileIssues: capture.issues.length, newSafetyControls: capture.controls.length, newSafetyControlsPassed: capture.controls.filter(row => row.passed).length, historicalControlsRerun: 0 };
  process.stdout.write(`${JSON.stringify(capture)}\n`);
  if (capture.failure || capture.controls.some(row => !row.passed) || activeBeforeSafetyCleanup) process.exitCode = 1;
}
