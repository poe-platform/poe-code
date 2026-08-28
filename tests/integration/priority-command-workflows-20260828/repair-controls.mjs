import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, sha, inventory, requireCleanSafety, reserveWorkerStarts, settleWorkerStarts, accountTerminal, terminalReceiptBytes } from './admission.mjs';
import { safetyCheck, admitFixtureRequest, validateCaseSafety } from './future-adapter.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
const protocol = readJson(path.join(own, 'REPAIR-PROTOCOL-v3.json'));
assert.deepEqual(process.argv.slice(2), ['--out', protocol.output]);
assert.equal(process.execPath, protocol.node); assert.equal(fs.realpathSync(process.cwd()), protocol.repository);
for (const row of protocol.files) { const bytes = fs.readFileSync(path.join(own, row.path)); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256, row.path); }
assert.equal(fs.existsSync(protocol.output), false, 'FRESH_EXCLUSIVE_OUTPUT');
fs.mkdirSync(protocol.output);
const started = Date.now(), deadline = started + protocol.bounds.windowMs;
const evidence = { role: 'PREPARATION_DATA_SYNTHETIC_BENIGN_ONLY', protocolSha256: sha(fs.readFileSync(path.join(own, 'REPAIR-PROTOCOL-v3.json'))), checks: [], failures: [], children: [], productImports: 0, productDispatches: 0, acceptedWorkerDispatches: 0 };
let captured = 0, workerStarts = 0, active;
const size = () => Object.values(inventory(protocol.output)).reduce((sum, row) => sum + (row.bytes ?? 0), 0);
const logBytes = () => Object.entries(inventory(protocol.output)).filter(([name]) => name.endsWith('.jsonl')).reduce((sum, [, row]) => sum + row.bytes, 0);
const test = (name, action) => {
  assert.ok(Date.now() < deadline, 'CONTROL_WINDOW_STOP');
  assert.equal(protocol.checks[evidence.checks.length], name, 'SEALED_CHECK_ORDER');
  try { action(); evidence.checks.push({ name, pass: true }); }
  catch (error) { evidence.checks.push({ name, pass: false }); evidence.failures.push({ name, message: String(error), stack: error.stack }); }
};
const row = { argv: [['synthetic-literal-not-dispatched']], expected: { changedFiles: { result: { base64: 'YQ==' } } } };
const clean = () => ({ safetyStops: [], workerAdmissionRefusals: [], workers: [], pass: true, failures: [], created: 1, disposed: 1,
  listenersAtEnd: 0, lifecycle: { pendingOwnedAtEnd: 0, pendingFixtureAtEnd: 0 }, stdin: { pending: 0 }, fs: { pending: 0, calls: [] }, backing: { pending: 0, calls: [] },
  network: { requestAfterClose: 0, extraRequests: 0, requests: 0, authorizations: 0, responseDispose: [] }, authorizationTrace: [], requestTrace: [],
  stages: [{ argv: row.argv[0], kind: 'result', exitCode: 0 }], events: ['shell.dispose.complete'], outcome: { kind: 'result', exitCode: 0 },
  before: { '/': { type: 'directory', mode: 493 } }, after: { '/': { type: 'directory', mode: 493 } } });
const stoppedBeforeNext = trace => {
  let next = 0; const persisted = [];
  assert.throws(() => { for (const candidate of [trace, clean()]) { persisted.push(structuredClone(candidate)); requireCleanSafety(candidate); next++; } }, /(?:ADAPTER_SAFETY_STOP|CHILD_LOAD_ADMISSION_STOP|WORKER_ADMISSION_STOP|WORKER_UNREAPED_STOP)/u);
  assert.equal(next, 0); assert.equal(persisted.length, 1); return persisted[0];
};
try {
  for (const filename of protocol.parseFiles) test('parse:' + filename, () => { new vm.SourceTextModule(fs.readFileSync(path.join(own, filename), 'utf8'), { identifier: filename }); });
  test('clean-safety', () => { const trace = clean(); validateCaseSafety(row, {}, trace); requireCleanSafety(trace); });
  for (const [name, mutate] of [
    ['cleanup-failure', trace => { try { safetyCheck(trace, 'SHELL_CLEANUP_STOP', () => { throw new Error('synthetic-cleanup'); }); } catch {} }],
    ['pending-owned', trace => { trace.lifecycle.pendingOwnedAtEnd = 1; }],
    ['pending-fixture', trace => { trace.lifecycle.pendingFixtureAtEnd = 1; }],
    ['pending-stdin', trace => { trace.stdin.pending = 1; }],
    ['pending-fs', trace => { trace.fs.pending = 1; }],
    ['pending-cursor', trace => { trace.fs.calls.push({ stream: { pending: 1 } }); }],
    ['pending-response', trace => { trace.responses = [{ pending: 1 }]; }],
    ['listener-leak', trace => { trace.listenersAtEnd = 1; }],
    ['missing-stage', trace => { trace.stages = []; }],
    ['pending-stage', trace => { trace.stages[0].kind = 'pending'; }],
    ['missing-dispose-trace', trace => { trace.events = []; }],
    ['unexpected-namespace', trace => { trace.after['/unexpected'] = { type: 'file', base64: '' }; }],
    ['unchanged-path-mutation', trace => { trace.after['/'].mode = 0; }],
    ['postclose-count', trace => { trace.network.requestAfterClose = 1; }],
  ]) test(name, () => { const trace = clean(); mutate(trace); validateCaseSafety(row, {}, trace); assert.ok(stoppedBeforeNext(trace).safetyStops.length); });
  for (const [name, kind, actual, expected, closed] of [
    ['caught-extra-auth', 'authorize', { url: 'data-only' }, undefined, false],
    ['caught-extra-request', 'request', { url: 'data-only' }, undefined, false],
    ['caught-refused-request', 'request', { url: 'wrong' }, { url: 'expected' }, false],
    ['caught-postclose-request', 'request', { url: 'same' }, { url: 'same' }, true],
  ]) test(name, () => { const trace = clean(); try { admitFixtureRequest(trace, kind, actual, expected, closed); } catch {} trace.pass = true; validateCaseSafety(row, {}, trace); stoppedBeforeNext(trace); });
  test('ordinary-byte-status-mismatch-aggregates', () => { const trace = clean(); trace.pass = false; trace.failures.push({ kind: 'assertion', message: 'synthetic output/status mismatch' }); trace.outcome.exitCode = 1; let continued = 0, failures = 0; for (const candidate of [trace, clean()]) { validateCaseSafety(row, {}, candidate); requireCleanSafety(candidate); if (!candidate.pass) failures++; continued++; } assert.equal(continued, 2); assert.equal(failures, 1); });
  test('ordinary-typeerror-fsfault-semantics', () => { const trace = clean(); trace.outcome = { kind: 'throw', message: 'TypeError instead of declared FsError' }; trace.stages[0].kind = 'throw'; trace.pass = false; validateCaseSafety(row, {}, trace); requireCleanSafety(trace); });
  test('child-refusal-receipt-even-mapped-pass', () => { const trace = clean(); assert.throws(() => requireCleanSafety(trace, [{ event: 'admission-refused', url: 'file:///synthetic', reason: 'LOAD_HASH_REFUSED' }]), /CHILD_LOAD_ADMISSION_STOP/u); });
  test('unknown-worker-reap-stops', () => { const trace = clean(); trace.workers = [{ childAdmissionRefused: false, exited: false }]; stoppedBeforeNext(trace); });
  test('reservation-withheld-before-abnormal-settlement', () => { const remaining = { workerStarts: 372 }; const reservation = reserveWorkerStarts(remaining, 'synthetic-killed-child'); assert.equal(remaining.workerStarts, 368); assert.equal(reservation.starts, null); assert.equal(reservation.accounting, 'unknown'); });
  test('reservation-withheld-incomplete-start-log', () => { const remaining = { workerStarts: 372 }, reservation = reserveWorkerStarts(remaining, 'synthetic-missing-log'); assert.throws(() => settleWorkerStarts(remaining, reservation, [{ action: 'constructor-attempt', token: 'one' }], [])); assert.equal(remaining.workerStarts, 368); assert.equal(reservation.accounting, 'unknown'); });
  test('reservation-refund-only-complete', () => { const remaining = { workerStarts: 372 }, reservation = reserveWorkerStarts(remaining, 'synthetic-complete'); const worker = { token: 'one', exited: true, exitCode: 0, terminatePending: 0, terminateErrors: [], emergency: false }; settleWorkerStarts(remaining, reservation, [{ action: 'constructor-attempt', token: 'one' }, { action: 'start', token: 'one' }, { action: 'exit', token: 'one', code: 0 }], [worker]); assert.equal(remaining.workerStarts, 371); assert.equal(reservation.starts, 1); assert.throws(() => settleWorkerStarts(remaining, reservation, [], []), /DUPLICATE_WORKER_SETTLEMENT_STOP/u); });
  for (const [name, retained, limit, now, expected] of [
    ['terminal-retained-storage-debit', terminalReceiptBytes + 1024, terminalReceiptBytes + 2048, 99, 'PASS'],
    ['terminal-final-write-storage-stop', terminalReceiptBytes + 2049, terminalReceiptBytes + 2048, 99, 'STOP'],
    ['terminal-postprocessing-deadline-stop', terminalReceiptBytes, terminalReceiptBytes + 2048, 100, 'STOP'],
  ]) test(name, () => { const remaining = { scratchBytes: limit }, terminal = { parentBudget: { remaining: { scratchBytes: limit } }, safetyStops: [], failures: [] }; accountTerminal(terminal, remaining, retained, limit, 100, now); assert.equal(terminal.status, expected); assert.equal(remaining.scratchBytes, Math.max(0, limit - retained)); });
  for (const mode of protocol.stubModes) {
    assert.equal(active, undefined); assert.ok(evidence.children.length < protocol.bounds.children); assert.ok(Date.now() < deadline); assert.ok(size() < protocol.bounds.storageBytes / 2);
    const child = spawn(protocol.node, [path.join(own, 'repair-child.mjs'), mode, protocol.output], { cwd: protocol.repository, env: { PATH: path.dirname(protocol.node), NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    active = child;
    const receipt = { mode, pid: child.pid, exitObserved: false, closeObserved: false, errors: [], stdout: '', stderr: '' };
    const timer = setTimeout(() => { receipt.errors.push('WALL_STOP'); child.kill('SIGKILL'); }, Math.min(protocol.bounds.childWallMs, deadline - Date.now()));
    const monitor = setInterval(() => { if (size() > protocol.bounds.storageBytes / 2 || captured + logBytes() > protocol.bounds.captureBytes) { receipt.errors.push('STORAGE_OR_CAPTURE_STOP'); child.kill('SIGKILL'); } }, 50);
    for (const name of ['stdout', 'stderr']) child[name].on('data', bytes => { const room = Math.max(0, protocol.bounds.captureBytes - captured); receipt[name] += bytes.subarray(0, room).toString(); captured += bytes.length; if (captured > protocol.bounds.captureBytes) { receipt.errors.push('CAPTURE_STOP'); child.kill('SIGKILL'); } });
    child.on('error', error => receipt.errors.push(String(error)));
    child.once('exit', () => { receipt.exitObserved = true; });
    await new Promise(resolve => child.once('close', (status, signal) => { receipt.closeObserved = true; receipt.status = status; receipt.signal = signal; resolve(); }));
    clearTimeout(timer); clearInterval(monitor); active = undefined;
    receipt.reaped = receipt.exitObserved && receipt.closeObserved;
    evidence.children.push(receipt); writeJson(path.join(protocol.output, mode + '.child.json'), receipt);
    assert.equal(receipt.reaped, true, 'UNKNOWN_REAP_STOP'); assert.equal(receipt.signal, null); assert.deepEqual(receipt.errors, []); assert.ok(captured + logBytes() <= protocol.bounds.captureBytes);
    const result = JSON.parse(receipt.stdout.trim());
    workerStarts += result.rows.length; assert.ok(workerStarts <= protocol.bounds.workerStarts);
    test('stub:' + mode, () => { assert.equal(receipt.status, 0, receipt.stderr); assert.equal(result.pass, true, JSON.stringify(result.failure)); assert.equal(result.productImports, 0); assert.equal(result.productDispatches, 0); assert.ok(result.rows.every(worker => worker.exited && worker.terminatePending === 0)); });
    if (!result.pass) break;
  }
  assert.equal(evidence.checks.length, protocol.checks.length);
  for (const row of protocol.files) assert.equal(sha(fs.readFileSync(path.join(own, row.path))), row.sha256, row.path);
} catch (error) { evidence.failures.push({ name: 'driver-stop', message: String(error), stack: error.stack }); }
finally {
  assert.equal(active, undefined, 'OWNED_CHILD_UNREAPED');
  evidence.capturedBytes = captured + logBytes(); evidence.workerStarts = workerStarts; evidence.allOwnedChildrenReaped = evidence.children.every(row => row.reaped); evidence.finished = Date.now();
  if (Date.now() >= deadline || size() > protocol.bounds.storageBytes / 2) evidence.failures.push({ name: 'final-budget-stop' });
  evidence.status = evidence.failures.length ? 'FAIL' : 'PASS';
  writeJson(path.join(protocol.output, 'RESULTS.json'), evidence);
  assert.ok(size() <= protocol.bounds.storageBytes);
  console.log(JSON.stringify({ status: evidence.status, checks: evidence.checks.length, children: evidence.children.length, workerStarts, failures: evidence.failures }));
  if (evidence.status !== 'PASS') process.exitCode = 1;
}
