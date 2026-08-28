import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';

const own = path.dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const planBytes = fs.readFileSync(path.join(own, 'PRESEAL.json'));
assert.equal(sha(planBytes), process.argv[2]);
const plan = JSON.parse(planBytes), inputs = JSON.parse(fs.readFileSync(path.join(own, 'INPUTS.json')));
const started = Date.now(), root = path.join(own, 'inert-01'), scratch = path.join(root, 'scratch');
const outcomes = [], known = [], guardReceipts = [];
let unsafe = false, totalEvidence = 0, written = 0;
const shape = reason => ({ type: reason === null ? 'null' : typeof reason, name: reason?.name ?? null, code: reason?.code ?? null, message: String(reason?.message ?? reason).slice(0, 4096), stack: reason?.stack?.slice(0, 8192) ?? null });
function time() { assert.ok(Date.now() - started < 600000, 'TEN_MINUTE_BOUND'); }
function hashFile(filename) {
  const descriptor = fs.openSync(filename, 'r'), buffer = Buffer.alloc(65536), digest = createHash('sha256');
  try { let count; while ((count = fs.readSync(descriptor, buffer)) > 0) { digest.update(buffer.subarray(0, count)); time(); } }
  finally { fs.closeSync(descriptor); }
  return digest.digest('hex');
}
function guards() {
  for (const entry of [...inputs.entries, ...plan.files]) {
    const stat = fs.lstatSync(entry.path); assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(stat.size, entry.bytes); assert.equal(stat.mode & 511, entry.mode); assert.equal(hashFile(entry.path), entry.sha256);
  }
  assert.equal(sha(fs.readFileSync(path.join(own, 'PRESEAL.json'))), sha(planBytes));
  guardReceipts.push({ ordinal: guardReceipts.length + 1, entries: inputs.entries.length + plan.files.length });
}
function readLimited(filename, maximum) {
  const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
  const bytes = fs.readFileSync(filename); assert.equal(bytes.length, stat.size); return bytes;
}
function put(filename, bytes, evidence = false) {
  time();
  if (evidence) { totalEvidence += bytes.length; assert.ok(totalEvidence <= 33554432); }
  else { written += bytes.length; assert.ok(written <= 134217728); }
  fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o600 });
}
function record(name, value) { const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n'); assert.ok(bytes.length <= 262144); put(path.join(root, name), bytes, true); }
function waitBound(promise, milliseconds, label) {
  let timer;
  return Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); })]).finally(() => clearTimeout(timer));
}
function enroll(executable, args, options) {
  assert.equal(executable, plan.node); assert.ok(known.length < 11); assert.ok(known.every(resource => resource.row.closeObserved));
  const handle = spawn(executable, args, options);
  const row = { ordinal: known.length + 1, pid: handle.pid ?? null, args, closeObserved: false, status: null, signal: null, stdoutBytes: 0, stderrBytes: 0, rescueSignals: [] };
  let closeResolve, readyResolve;
  const resource = { row, handle, stdout: [], stderr: [], closed: new Promise(resolve => { closeResolve = resolve; }), ready: new Promise(resolve => { readyResolve = resolve; }) };
  known.push(resource);
  handle.once('close', (status, signal) => { row.status = status; row.signal = signal; row.closeObserved = true; closeResolve(); });
  handle.on('error', reason => { row.error = shape(reason); });
  for (const channel of ['stdout', 'stderr']) handle[channel].on('data', bytes => {
    row[channel + 'Bytes'] += bytes.length;
    if (row.stdoutBytes + row.stderrBytes > 1048576) { unsafe = true; handle.kill('SIGTERM'); return; }
    resource[channel].push(Buffer.from(bytes));
    if (channel === 'stdout' && Buffer.concat(resource.stdout).includes(Buffer.from('READY\n'))) readyResolve();
  });
  return handle;
}
async function closeKnown() {
  for (const resource of known) if (!resource.row.closeObserved) {
    unsafe = true; resource.row.rescueSignals.push('SIGTERM'); resource.handle.kill('SIGTERM');
    try { await waitBound(resource.closed, 2000, 'REVIEWER_TERM_UNCLOSED'); }
    catch { resource.row.rescueSignals.push('SIGKILL'); resource.handle.kill('SIGKILL'); await waitBound(resource.closed, 1000, 'REVIEWER_KILL_UNCLOSED'); }
  }
}
function tree(directory) {
  const entries = {}; let bytes = 0;
  function visit(relative) {
    for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
      assert.notEqual(name, 'AGENTS.md'); const key = relative ? relative + '/' + name : name, filename = path.join(directory, key), stat = fs.lstatSync(filename);
      assert.ok(!stat.isSymbolicLink()); assert.ok(Object.keys(entries).length < 512);
      if (stat.isDirectory()) visit(key);
      else { assert.ok(stat.isFile()); bytes += stat.size; assert.ok(bytes <= 134217728); entries[key] = { bytes: stat.size, sha256: hashFile(filename) }; }
    }
  }
  visit(''); return { entries, bytes };
}
assert.equal(process.execPath, plan.node);
guards(); assert.equal(fs.existsSync(root), false); fs.mkdirSync(root); fs.mkdirSync(scratch);
const { bindSubject } = await import(pathToFileURL(path.join(own, 'subject.mjs')).href);
const mainControl = JSON.parse(fs.readFileSync(path.join(own, 'CONTROL.json')));
const fixture = JSON.parse(fs.readFileSync(path.join(own, 'F01-INERT-FIXTURE.json')));
const cacheFixture = JSON.parse(fs.readFileSync(path.join(own, 'F05-INERT-FIXTURE.json')));
const stubHash = sha(fs.readFileSync(path.join(own, 'stub.mjs')));
const loadTemplate = { actualEnginePaths: ['consumer/engine/src/run.ts', 'consumer/engine/src/interp/values.ts', 'consumer/engine/src/interp/budget.ts', 'consumer/engine/src/interp/host-bridge.ts'].sort(), sourceAndEmissionHashesVerified: true, unknownLoads: 0 };
let saved;
function context(id) {
  const label = id === 'P06' ? 'F05' : 'F01';
  const folder = path.join(scratch, id); fs.mkdirSync(folder); fs.mkdirSync(path.join(folder, 'logs')); fs.mkdirSync(path.join(folder, 'logs', label));
  const primary = id === 'L03' ? undefined : new Error('POSTSPAWN_CLOCK');
  const secondary = new Error('LATER_DIAGNOSTIC_FAILURE'), portCalls = [], enrollment = [];
  let subject, remainingCalls = 0;
  const ports = {
    scratch: folder, control: mainControl, limits: mainControl.limits, spawn: enroll,
    remaining() {
      remainingCalls++;
      if (remainingCalls === 2) {
        const owner = subject.state().activeChild;
        assert.ok(owner && owner.handle.listenerCount('close') >= 2 && owner.handle.listenerCount('error') >= 2, 'LISTENERS_BEFORE_CLOCK');
        enrollment.push('clock-after-enrollment-and-listeners');
        if (id === 'L02') throw primary;
      }
      return 4500;
    },
    write(relative, bytes) {
      if (relative.endsWith('.child.json')) {
        const owner = subject.state().activeChild;
        assert.ok(owner && owner.handle.pid === owner.row.pid && owner.handle.listenerCount('close') >= 2 && owner.handle.listenerCount('error') >= 2, 'LISTENERS_BEFORE_PUBLICATION');
        enrollment.push('publication-after-enrollment-and-listeners');
        if (id === 'L03') throw primary;
      }
      const filename = path.join(folder, relative); assert.ok(filename.startsWith(folder + '/')); put(filename, bytes);
    },
    errorData(reason) { if (id === 'L03' && reason === undefined) throw secondary; return shape(reason); },
    guard(label) { portCalls.push('guard:' + label); guards(); },
    immutable(label) { portCalls.push('immutable:' + label); guards(); tree(scratch); },
    auditLoads(label, admitted) {
      portCalls.push('auditLoads:' + label); assert.deepEqual(admitted, { kind: 'INERT_ONLY', label });
      const bytes = readLimited(path.join(folder, 'logs', label, 'stub-load.json'), 4096);
      assert.deepEqual(JSON.parse(bytes), { kind: 'INERT_COMPOSED_LOAD_PORT_FIXTURE', stubSha256: stubHash });
      return { ...loadTemplate, sha256: sha(bytes) };
    },
    readLimited
  };
  subject = bindSubject(ports);
  return { subject, folder, label, primary, secondary, portCalls, enrollment, calls: () => remainingCalls };
}
try {
  for (const id of ['L01','L02','L03','L04','L05','P01','P02','P03','P04','P05','P06']) {
    if (unsafe) break;
    const observed = { id };
    const current = context(id);
    try {
      const raw = structuredClone(id === 'P06' ? cacheFixture : fixture);
      if (id === 'P02') raw.finalResources.hostPending = 1;
      if (id === 'P03') raw.counters.engineEntered = 0;
      if (id === 'P04') raw.engineOutcome.settled = false;
      if (id === 'P05') raw.sourceSha256 = '0'.repeat(64);
      const args = ['--permission', '--allow-fs-read=' + own, '--allow-fs-write=' + current.folder, '--disallow-code-generation-from-strings', '--unhandled-rejections=strict', '--max-old-space-size=64'];
      if (id === 'L05') args.push(path.join(own, 'overflow.mjs'));
      else args.push(path.join(own, 'stub.mjs'), id.startsWith('P') ? 'receipt' : id === 'L01' ? 'natural' : 'hold');
      if (id.startsWith('P')) { const input = path.join(current.folder, 'fixture.json'); put(input, Buffer.from(JSON.stringify(raw) + '\n')); args.push(input, path.join(current.folder, 'logs', current.label, 'receipt.json')); }
      const pending = current.subject.child(plan.node, args, { role: 'workflow', label: current.label, cwd: current.folder, timeoutMs: 4500, env: plan.environment }).then(result => ({ fulfilled: true, result }), reason => ({ fulfilled: false, reason }));
      if (id === 'L04') { await waitBound(known.at(-1).ready, 2000, 'READY_REQUIRED'); await waitBound(current.subject.retireActiveChild(null), 3000, 'OUTER_RETIRE_BOUND'); }
      const settlement = await waitBound(pending, 7500, 'SUBJECT_SETTLEMENT_BOUND');
      await waitBound(known.at(-1).closed, 1000, 'CLOSE_REQUIRED');
      const state = current.subject.state(); assert.equal(state.activeChild, undefined);
      observed.subjectRow = state.evidence.children[0]; observed.enrollment = current.enrollment; observed.remainingCalls = current.calls();
      observed.fulfilled = settlement.fulfilled; if (!settlement.fulfilled) observed.reason = shape(settlement.reason);
      if (id === 'L01') { assert.equal(settlement.fulfilled, true); assert.equal(settlement.result.stdout.toString(), 'NATURAL\n'); assert.equal(state.evidence.children[0].naturallyReaped, true); }
      else if (id.startsWith('L')) {
        assert.equal(settlement.fulfilled, false); assert.equal(state.lastChildFailure.present, true); assert.equal(state.evidence.children[0].naturallyReaped, false); assert.equal(known.at(-1).row.signal, 'SIGTERM');
        if (id === 'L02' || id === 'L03') { assert.equal(settlement.reason, current.primary); assert.equal(state.lastChildFailure.reason, current.primary); observed.exactPrimaryIdentity = true; }
        if (id === 'L03') { assert.ok(state.lastChildFailure.secondary.includes(current.secondary)); observed.laterDiagnosticPreserved = true; }
        if (id === 'L04') { assert.equal(settlement.reason, null); assert.equal(state.lastChildFailure.reason, null); observed.exactNullIdentity = true; }
        if (id === 'L05') assert.equal(settlement.reason.message, 'STDOUTBYTES_BOUND');
      } else {
        assert.equal(settlement.fulfilled, true); const result = settlement.result;
        let value, reason, caught = false;
        try { value = current.subject.acceptEvaluation(current.label, { kind: 'INERT_ONLY', label: current.label }, result); } catch (error) { caught = true; reason = error; }
        observed.caught = caught; observed.acceptanceReason = caught ? shape(reason) : null; observed.portCalls = current.portCalls;
        assert.deepEqual(current.portCalls, ['guard:after-' + current.label,'immutable:after-' + current.label,'auditLoads:' + current.label]);
        if (id === 'P06') observed.scope = 'valid synchronous F05 source-conformant inert record; refusal is a verifier finding, not real-engine failure';
        assert.equal(caught, id !== 'P01' && id !== 'P06');
        if (caught) assert.equal(reason.code, 'ERR_ASSERTION');
        else { assert.equal(value.classification, 'PASS'); if (id === 'P01') saved = { current, result, bytes: readLimited(path.join(current.folder, 'logs/F01/receipt.json'), 65536), loads: value.loads }; }
      }
      observed.status = 'PASS';
    } catch (reason) { observed.status = 'FAIL'; observed.failure = shape(reason); }
    finally {
      try { await closeKnown(); guards(); tree(scratch); } catch (reason) { unsafe = true; observed.safetyFailure = shape(reason); }
      outcomes.push(observed); record(id + '.json', observed);
    }
  }
  assert.ok(saved && !unsafe, 'POSITIVE_AND_REAP_PREREQUISITES');
  const sourceReceipt = JSON.parse(saved.bytes), terminal = JSON.parse(saved.result.stdout);
  let getterCalls = 0;
  for (const id of ['D01','D02','D03','D04','D05','D06','D07','D08','D09','D10']) {
    const receipt = structuredClone(sourceReceipt), result = { ...saved.result, row: { ...saved.result.row } };
    if (id === 'D01') Object.defineProperty(receipt, 'sourceSha256', { get() { getterCalls++; return fixture.sourceSha256; } });
    if (id === 'D02') delete receipt.events[3];
    if (id === 'D03') receipt.finalResources.readPending = 1;
    if (id === 'D04') receipt.finalResources.intrinsicPending = 1;
    if (id === 'D05') receipt.finalResources.trackedOperations = 1;
    if (id === 'D06') receipt.publicOutcome.settled = false;
    if (id === 'D07') receipt.assertions = [];
    if (id === 'D08') result.row.naturallyReaped = false;
    if (id === 'D09') result.row.status = 1;
    let caught = false, reason;
    try {
      if (id === 'D10') {
        const current = context(id);
        for (const name of ['receipt.json','stub-load.json']) put(path.join(current.folder, 'logs/F01', name), readLimited(path.join(saved.current.folder, 'logs/F01', name), 65536));
        const changed = JSON.parse(readLimited(path.join(saved.current.folder, 'logs/F01/receipt.json.raw'), 65536)); changed.clean = false;
        put(path.join(current.folder, 'logs/F01/receipt.json.raw'), Buffer.from(JSON.stringify(changed) + '\n'));
        current.subject.acceptEvaluation('F01', { kind: 'INERT_ONLY', label: 'F01' }, result);
      } else saved.current.subject.reconcileReceipt('F01', receipt, terminal, result, saved.loads, saved.bytes);
    } catch (error) { caught = true; reason = error; }
    const row = { id, scope: id === 'D10' ? 'composed artifact tamper using prior natural inert result' : 'standalone exact reconciler DATA', caught, reason: caught ? shape(reason) : null, getterCalls, status: caught && reason.code === 'ERR_ASSERTION' && getterCalls === 0 && (id !== 'D10' || reason.message.includes('RAW_RECEIPT_BINDING')) ? 'PASS' : 'FAIL' };
    outcomes.push(row); record(id + '.json', row);
  }
  const reordered = structuredClone(sourceReceipt);
  const settled = reordered.events.splice(reordered.events.findIndex(event => event.event === 'engine-settle'), 1)[0]; reordered.events.splice(2, 0, settled); reordered.events.forEach((event, index) => { event.ordinal = index + 1; });
  const bytes = Buffer.from(JSON.stringify(reordered) + '\n'), diagnosticTerminal = { ...terminal, receiptSha256: sha(bytes) };
  let accepted = false, diagnosticReason;
  try { saved.current.subject.reconcileReceipt('F01', reordered, diagnosticTerminal, { ...saved.result, stdout: Buffer.from(JSON.stringify(diagnosticTerminal) + '\n') }, saved.loads, bytes); accepted = true; } catch (reason) { diagnosticReason = shape(reason); }
  const diagnostic = { id: 'N01', status: 'UNSCORED_DIAGNOSTIC', accepted, reason: diagnosticReason, scope: 'standalone reordered ledger, synthetic terminal; not an actual child emission or composed driver bypass', changed: 'engine-settle before engine-enter, exact counts retained' };
  outcomes.push(diagnostic); record('N01.json', diagnostic);
  const cacheRaw = readLimited(path.join(scratch, 'P06/logs/F05/receipt.json'), 65536);
  for (const [id, nativePromise] of [['N02', true], ['N03', 'false']]) {
    const receipt = JSON.parse(cacheRaw);
    for (const event of receipt.events) if (event.event === 'intrinsic-settle') event.nativePromise = nativePromise;
    const bytes = Buffer.from(JSON.stringify(receipt) + '\n'), terminal = { label: 'F05', classification: receipt.classification, receiptSha256: sha(bytes) };
    let accepted = false, reason;
    try { saved.current.subject.reconcileReceipt('F05', receipt, terminal, { ...saved.result, stdout: Buffer.from(JSON.stringify(terminal) + '\n') }, saved.loads, bytes); accepted = true; } catch (error) { reason = shape(error); }
    const row = { id, status: 'UNSCORED_DIAGNOSTIC', accepted, reason, scope: 'standalone F05 nativePromise-only counterfactual, not real child output', nativePromise };
    outcomes.push(row); record(id + '.json', row);
  }
} catch (reason) { unsafe = true; outcomes.push({ id: 'OUTER', failure: shape(reason) }); }
finally {
  try { await closeKnown(); guards(); } catch (reason) { unsafe = true; outcomes.push({ id: 'FINAL_GUARD', failure: shape(reason) }); }
  let cleanup = { scratchAbsent: false }, archive;
  try {
    assert.ok(known.every(resource => resource.row.closeObserved));
    const snapshot = tree(scratch), files = {};
    for (const name of Object.keys(snapshot.entries)) files[name] = readLimited(path.join(scratch, name), 134217728).toString('base64');
    const raw = Buffer.from(JSON.stringify({ classification: 'INERT_ONLY_NO_ENGINE', snapshot, files })); assert.ok(raw.length <= 134217728);
    const compressed = gzipSync(raw), encoded = Buffer.from(compressed.toString('base64') + '\n'); assert.ok(encoded.length <= 8388608);
    assert.equal(sha(gunzipSync(compressed, { maxOutputLength: 134217728 })), sha(raw)); put(path.join(root, 'CAPTURE.json.gz.base64'), encoded, true); archive = { rawSha256: sha(raw), compressedSha256: sha(compressed), encodedSha256: sha(encoded), bytes: encoded.length };
    if (!unsafe) { assert.equal(fs.realpathSync(scratch), scratch); fs.rmSync(scratch, { recursive: true }); cleanup = { scratchAbsent: !fs.existsSync(scratch), knownChildrenClosed: true }; }
  } catch (reason) { unsafe = true; outcomes.push({ id: 'CLEANUP', failure: shape(reason) }); }
  const children = known.map(resource => ({ ...resource.row, stdoutBase64: Buffer.concat(resource.stdout).toString('base64'), stderrBase64: Buffer.concat(resource.stderr).toString('base64') }));
  const report = { schema: 'independent-bridge-repair-review-v1', started: new Date(started).toISOString(), finished: new Date().toISOString(), elapsedMs: Date.now() - started, planSha256: sha(planBytes), subjectSha256: hashFile(path.join(own, 'subject.mjs')), outcomes, children, expectedPassed: outcomes.filter(row => row.status === 'PASS').length, unexpected: outcomes.filter(row => row.status === 'FAIL' || row.failure).length, diagnostic: outcomes.find(row => row.id === 'N01'), unsafe, cleanup, archive, guardReceipts, writtenBytes: written, captureBytesBeforeReport: totalEvidence, engineEvaluations: 0, compilerImports: 0, mainSupervisorActivations: 0, mockLoadPorts: true };
  report.passed = !unsafe && report.expectedPassed === 21 && report.unexpected === 0 && children.length === 11 && children.every(row => row.closeObserved && row.rescueSignals.length === 0) && cleanup.scratchAbsent;
  record('REPORT.json', report);
  console.log(JSON.stringify({ passed: report.passed, expectedPassed: report.expectedPassed, unexpected: report.unexpected, children: children.length, diagnostic: report.diagnostic, unsafe, cleanup, root }));
  process.exitCode = report.passed ? 0 : unsafe ? 2 : 1;
}
