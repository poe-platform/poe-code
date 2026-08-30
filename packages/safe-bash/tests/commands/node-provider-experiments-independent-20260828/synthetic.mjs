import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const own = path.dirname(fileURLToPath(import.meta.url));
const recipePath = path.join(own, 'SYNTHETIC-RECIPE.json');
const recipeBytes = fs.readFileSync(recipePath);
const recipe = JSON.parse(recipeBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(process.argv.length, 3);
assert.equal(process.argv[2], recipe.runId);
assert.equal(process.execPath, recipe.node.path);
assert.equal(process.version, 'v22.22.2');
function fileHash(filename) {
  const descriptor = fs.openSync(filename, 'r');
  const digest = createHash('sha256');
  const buffer = Buffer.alloc(1048576);
  try {
    let length;
    while ((length = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, length));
  } finally { fs.closeSync(descriptor); }
  return digest.digest('hex');
}
function guards() {
  for (const row of [...recipe.files, ...recipe.protectedInputs]) {
    const filename = row.absolutePath ?? path.join(own, row.path);
    const info = fs.lstatSync(filename);
    assert.ok(info.isFile() && !info.isSymbolicLink());
    assert.equal(info.size, row.bytes);
    assert.equal(info.mode & 511, row.mode);
    assert.equal(fileHash(filename), row.sha256);
  }
  assert.equal(fileHash(process.execPath), recipe.node.sha256);
  assert.equal(sha(fs.readFileSync(recipePath)), sha(recipeBytes));
}
guards();
const { bindChild, assessReceipt } = await import('./subject.mjs');
const runRoot = path.join(own, 'runs', recipe.runId);
fs.mkdirSync(path.dirname(runRoot), { recursive: true });
fs.mkdirSync(runRoot);
const started = Date.now();
const known = [];
const results = [];
let unsafe = false;
let evidenceBytes = 0;
const shape = reason => ({ name: reason?.name ?? null, code: reason?.code ?? null, message: String(reason?.message ?? reason).slice(0, 1024) });
function writeRecord(name, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  assert.ok(bytes.length <= recipe.limits.recordBytes);
  assert.ok(evidenceBytes + bytes.length <= recipe.limits.evidenceBytes);
  fs.writeFileSync(path.join(runRoot, name), bytes, { flag: 'wx' });
  evidenceBytes += bytes.length;
}
function enroll(executable, args, options) {
  assert.equal(executable, recipe.node.path);
  assert.ok(known.length < recipe.limits.stubChildren);
  const processChild = spawn(executable, args, options);
  const record = { ordinal: known.length + 1, pid: processChild.pid ?? null, args, closeObserved: false, stdoutBytes: 0, stderrBytes: 0, supervisorSignals: [] };
  const resource = { processChild, record, stdout: [], stderr: [], closed: null };
  known.push(resource);
  resource.closed = new Promise(resolve => {
    processChild.on('error', reason => { record.error = shape(reason); });
    processChild.once('close', (status, signal) => { record.closeObserved = true; record.status = status; record.signal = signal; resolve(); });
  });
  processChild.stdout.on('data', chunk => {
    record.stdoutBytes += chunk.length;
    if (record.stdoutBytes <= recipe.limits.streamBytes) resource.stdout.push(Buffer.from(chunk));
    else { unsafe = true; processChild.kill('SIGTERM'); }
  });
  processChild.stderr.on('data', chunk => {
    record.stderrBytes += chunk.length;
    if (record.stderrBytes <= recipe.limits.streamBytes) resource.stderr.push(Buffer.from(chunk));
    else { unsafe = true; processChild.kill('SIGTERM'); }
  });
  return processChild;
}
async function withDeadline(promise, milliseconds, name) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(name)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}
async function retire(resource) {
  if (resource.record.closeObserved) return;
  resource.record.supervisorSignals.push('SIGTERM');
  resource.processChild.kill('SIGTERM');
  try { await withDeadline(resource.closed, 1000, 'REVIEW_TERM_REAP_TIMEOUT'); }
  catch {
    resource.record.supervisorSignals.push('SIGKILL');
    resource.processChild.kill('SIGKILL');
    await withDeadline(resource.closed, 1000, 'REVIEW_KILL_REAP_TIMEOUT');
  }
}
const outer = setTimeout(() => {
  unsafe = true;
  for (const resource of known) if (!resource.record.closeObserved) resource.processChild.kill('SIGTERM');
}, recipe.limits.overallMs);
function receiptInput() {
  const receipt = { schema: 'node-abi-child-v1', identity: 'F01', label: 'F01', sourceSha256: recipe.f01SourceSha256, classification: 'PASS', clean: true, unhandled: [], assertions: [{ name: 'synthetic-only', pass: true }], counters: { engineEntered: 1, engineSettled: 1 }, engineOutcome: { settled: true, ok: true }, finalResources: { hostPending: 0, accepting: false } };
  return receipt;
}
function assess(receipt, status = 0, wrongHash = false) {
  const receiptBytes = Buffer.from(JSON.stringify(receipt) + '\n');
  const terminal = { label: 'F01', classification: receipt.classification, receiptSha256: wrongHash ? '0'.repeat(64) : sha(receiptBytes) };
  const result = { stdout: Buffer.from(JSON.stringify(terminal) + '\n'), stderr: Buffer.alloc(0), row: { status } };
  try {
    assessReceipt({ result, label: 'F01', output: 'synthetic-receipt', limits: { receiptBytesPerChild: 65536 }, readLimited: (filename, maximum) => { assert.equal(filename, 'synthetic-receipt'); assert.ok(receiptBytes.length <= maximum); return receiptBytes; } });
    return { accepted: true, receipt, result: { status, terminal } };
  } catch (reason) { return { accepted: false, reason: shape(reason), receipt, result: { status, terminal } }; }
}
async function runControl(id, action) {
  if (unsafe) throw new Error('UNSAFE_DEPENDENT_STOP');
  let observation;
  try { observation = await action(); }
  catch (reason) { observation = { unexpectedFailure: shape(reason) }; }
  for (const resource of known) {
    try { await retire(resource); } catch (reason) { unsafe = true; observation.cleanupFailure = shape(reason); }
  }
  if (known.some(resource => !resource.record.closeObserved)) unsafe = true;
  try { guards(); } catch (reason) { unsafe = true; observation.guardFailure = shape(reason); }
  const row = { id, classifiedAs: recipe.controls.find(control => control.id === id).expected, observation, safeToContinue: !unsafe };
  results.push(row);
  writeRecord(id + '.json', row);
}
function childContext({ deadlineFault = false, writeFault = false, stdoutBytes = 65536 } = {}) {
  const evidence = { children: [] };
  const primary = new Error(deadlineFault ? 'EXECUTION_WINDOW_EXHAUSTED' : 'CAPTURE_WRITE_FAILURE');
  let remainingCalls = 0;
  const context = { assert, spawn: enroll, control: { maximumSpawnedChildren: 1 }, limits: { containmentGraceMs: 250, stdoutBytesPerChild: stdoutBytes, stderrBytesPerChild: 65536 }, evidence, sha, errorData: shape, created: writeFault, remaining: () => { remainingCalls++; if (deadlineFault && remainingCalls === 2) throw primary; return 10000; }, write: () => { throw primary; } };
  return { evidence, primary, subject: bindChild(context), remainingCalls: () => remainingCalls };
}
async function actualStub(settings, mode) {
  const context = childContext(settings);
  let output, rejected = false, reason;
  try {
    output = await withDeadline(context.subject.child(recipe.node.path, ['--permission', '--allow-fs-read=' + own, '--disallow-code-generation-from-strings', '--unhandled-rejections=strict', '--max-old-space-size=64', path.join(own, 'stub.mjs'), mode], { role: 'workflow', label: mode, cwd: own, timeoutMs: 1500, env: { PATH: path.dirname(recipe.node.path), LC_ALL: 'C', TZ: 'UTC', NODE_DISABLE_COMPILE_CACHE: '1' } }), 3000, 'SUBJECT_CALL_TIMEOUT');
  } catch (failure) { rejected = true; reason = failure; }
  return { context, output, rejected, reason, resource: known.at(-1) };
}
try {
  await runControl('D01', async () => { const outcome = assess(receiptInput()); assert.equal(outcome.accepted, true); return outcome; });
  await runControl('D02', async () => {
    const receipt = receiptInput(); receipt.sourceSha256 = '0'.repeat(64); receipt.assertions = []; receipt.engineOutcome = { settled: false, ok: false }; receipt.finalResources = { hostPending: 1, accepting: true };
    const outcome = assess(receipt); assert.equal(outcome.accepted, true); return { ...outcome, counterexample: true, qualification: 'Standalone exact receipt-acceptor counterexample, not proof that the sealed complete driver can emit this receipt.' };
  });
  await runControl('D03', async () => { const receipt = receiptInput(); receipt.clean = false; const outcome = assess(receipt); assert.equal(outcome.accepted, false); return outcome; });
  await runControl('D04', async () => { const outcome = assess(receiptInput(), 1); assert.equal(outcome.accepted, false); return outcome; });
  await runControl('D05', async () => { const outcome = assess(receiptInput(), 0, true); assert.equal(outcome.accepted, false); return outcome; });
  await runControl('L01', async () => {
    const state = await actualStub({}, 'normal'); assert.equal(state.rejected, false); assert.equal(state.output.row.status, 0); assert.equal(state.output.row.naturallyReaped, true); assert.equal(state.context.subject.active(), undefined); assert.equal(state.output.stdout.toString(), 'OK\n');
    return { subjectRow: state.context.evidence.children[0], activeAfterSettlement: false };
  });
  await runControl('L02', async () => {
    const state = await actualStub({ deadlineFault: true }, 'hold');
    assert.equal(state.rejected, true); assert.equal(state.reason, state.context.primary); assert.equal(state.context.remainingCalls(), 2); assert.equal(state.context.subject.active(), state.resource.processChild); assert.equal(state.context.evidence.children[0].closeObserved, undefined);
    if (!Buffer.concat(state.resource.stdout).includes(Buffer.from('READY\n'))) await withDeadline(new Promise(resolve => {
      const listener = () => { if (Buffer.concat(state.resource.stdout).includes(Buffer.from('READY\n'))) { state.resource.processChild.stdout.removeListener('data', listener); resolve(); } };
      state.resource.processChild.stdout.on('data', listener);
    }), 1500, 'STUB_READINESS_FAILURE');
    assert.equal(state.resource.record.closeObserved, false);
    return { rejected: true, exactPrimary: true, primary: shape(state.reason), remainingCalls: state.context.remainingCalls(), actualStubReady: true, subjectStillOwnsActiveChild: true, subjectRowBeforeReviewerCleanup: { ...state.context.evidence.children[0] }, counterexample: true, qualification: 'Exact child function under a deterministic outgoing-deadline fault; reviewer cleanup follows and is not credited to the subject.' };
  });
  await runControl('L03', async () => {
    const state = await actualStub({ writeFault: true }, 'normal'); assert.equal(state.rejected, true); assert.equal(state.reason, state.context.primary); assert.equal(state.context.evidence.children[0].closeObserved, true); assert.equal(state.context.subject.active(), undefined);
    return { exactPrimary: true, primary: shape(state.reason), subjectRow: state.context.evidence.children[0], activeAfterSettlement: false };
  });
  await runControl('L04', async () => {
    const state = await actualStub({ stdoutBytes: 32 }, 'output-bound'); assert.equal(state.rejected, true); assert.equal(state.context.evidence.children[0].containment, 'STDOUT_BOUND'); assert.equal(state.context.evidence.children[0].naturallyReaped, false); assert.equal(state.context.evidence.children[0].closeObserved, true); assert.equal(state.context.subject.active(), undefined);
    return { primary: shape(state.reason), subjectRow: state.context.evidence.children[0], activeAfterSettlement: false };
  });
} catch (reason) { unsafe = true; writeRecord('STOP.json', { reason: shape(reason) }); }
finally {
  clearTimeout(outer);
  for (const resource of known) {
    try { await retire(resource); } catch (reason) { unsafe = true; resource.record.finalCleanupError = shape(reason); }
  }
  try { guards(); } catch (reason) { unsafe = true; writeRecord('FINAL-GUARD-FAILURE.json', { reason: shape(reason) }); }
  for (const resource of known) {
    resource.record.stdoutUtf8 = Buffer.concat(resource.stdout).toString();
    resource.record.stderrUtf8 = Buffer.concat(resource.stderr).toString();
  }
  const report = { schema: 'node-abi-independent-synthetic-results-v1', recipeSha256: sha(recipeBytes), runId: recipe.runId, controlsPlanned: recipe.controls.length, controlsObserved: results.length, unexpectedFailures: results.filter(row => row.observation.unexpectedFailure).length, counterexamples: results.filter(row => row.observation.counterexample).map(row => row.id), unsafe, allKnownChildrenClosed: known.every(resource => resource.record.closeObserved), children: known.map(resource => resource.record), engineEvaluations: 0, compilerLoads: 0, realAuthorDriverActivations: 0, authorLoaderActivations: 0, elapsedMs: Date.now() - started, results };
  writeRecord('REPORT.json', report);
  process.stdout.write(JSON.stringify({ runId: recipe.runId, controlsObserved: report.controlsObserved, unexpectedFailures: report.unexpectedFailures, counterexamples: report.counterexamples, children: known.length, allKnownChildrenClosed: report.allKnownChildrenClosed, unsafe, engineEvaluations: 0 }) + '\n');
  process.exitCode = unsafe || report.unexpectedFailures || results.length !== recipe.controls.length ? 1 : 0;
}
