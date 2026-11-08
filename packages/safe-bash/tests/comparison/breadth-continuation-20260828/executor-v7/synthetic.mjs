import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authenticatePacket, readAuthorization } from './authorization.mjs';
import { authenticateBootstrap, createQueryWindow, importWithWindow, closeQueryWindow } from './bootstrap.mjs';
import { createEvidenceBudget } from './evidence.mjs';
import { createStore, readDocument, encode, digest } from './records.mjs';
import { observeCoordinator } from './outer.mjs';
import { assessTerminal, publish, reason } from './report.mjs';
import { createLedger } from './launch-ledger.mjs';
import { runCoordinator } from './body.mjs';
import { boundFile } from './projection.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(fs.readFileSync(path.join(root, 'SYNTHETIC-PLAN.json')));
const recipe = authenticatePacket(root);
const projection = JSON.parse(fs.readFileSync(path.join(root, '../executor-v3/PROJECTION.json')));
const tools = () => { for (const entry of projection.tools) boundFile(entry.path, entry); assert.equal(authenticatePacket(root), recipe); };
tools();
assert.equal(process.execPath, projection.tools.find(tool => tool.role === 'node').path);
assert(process.execArgv.includes('--unhandled-rejections=strict') && process.execArgv.includes('--max-old-space-size=256'));
const work = path.join(root, 'runs', plan.runId);
fs.mkdirSync(work, { mode: 0o755 });
const evidenceRoot = path.join(work, 'receipts');
fs.mkdirSync(evidenceRoot);
const evidenceBudget = createEvidenceBudget(evidenceRoot);
const evidence = createStore(evidenceRoot, { budget: evidenceBudget });
evidence.save('PRE.json', { recipe, planSha256: digest(fs.readFileSync(path.join(root, 'SYNTHETIC-PLAN.json'))), tools: projection.tools, permission: plan.permission, date: new Date().toISOString() });
const rows = [];
const outerChildren = [];
const nestedChildren = [];
let unsafe = false;
let positive;
let positiveRoot;
let positiveTerminal;
const emptyEmit = () => {};
const denies = (operation, code) => assert.throws(operation, error => error.code === code);
const subdirectory = name => { const filename = path.join(work, name); fs.mkdirSync(filename); return filename; };
const recordStore = (name, options = {}) => { const directory = subdirectory(name), budget = createEvidenceBudget(directory, options); return { directory, budget, store: createStore(directory, { budget }) }; };
const naturalClosed = child => child && child.reaped === true && child.exit && child.close;
const absent = pid => { try { process.kill(pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } };
async function family(id, operation) {
  if (unsafe) { rows.push({ id, status: 'UNRUN_UNSAFE_TAIL', pass: null }); return; }
  let observation;
  let failure;
  try { tools(); observation = await operation(); } catch (error) { failure = { reason: reason(error), undefinedValue: error === undefined }; }
  try {
    tools();
    for (const child of [...outerChildren, ...nestedChildren]) assert(naturalClosed(child) && absent(child.pid) && absent(-child.pid), 'ACTUAL_CHILD_CLOSURE');
    evidenceBudget.audit();
  } catch (error) { unsafe = true; failure = { ...(failure ?? {}), unsafe: reason(error) }; }
  const row = { id, pass: !failure, status: failure ? unsafe ? 'UNSAFE_STOP' : 'FAIL' : 'PASS', observation, failure };
  rows.push(row); evidence.save(`${id}.json`, row);
}

const gates = {
  async G01() {
    let delegations = 0, after = false;
    const original = () => { delegations++; }, host = { getBuiltinModule: original };
    const window = createQueryWindow(emptyEmit);
    const value = await importWithWindow({ host, window, load: async () => { const captured = host.getBuiltinModule; assert.equal(captured('module'), undefined); assert.equal(captured('worker_threads'), undefined); return 19; }, afterRevoke: () => { after = true; assert(window.snapshot().revoked); assert.equal(host.getBuiltinModule, original); } });
    assert.equal(value, 19); assert(after); assert.equal(delegations, 0); closeQueryWindow(window);
    return window.snapshot();
  },
  G02() {
    const vectors = [['node:module'], ['worker_threads'], [], ['module', 'extra'], [new String('module')], [undefined], [null], ['Module']];
    for (const args of vectors) { const window = createQueryWindow(emptyEmit); window.open(); denies(() => window.getter(...args), 'BOOTSTRAP_QUERY'); denies(() => window.qualify(), 'BOOTSTRAP_INCOMPLETE_OR_VIOLATION'); assert(window.snapshot().revoked); }
    return { denied: vectors.length, caughtStillUnqualified: true };
  },
  G03() {
    for (const wrap of [value => value, value => new Proxy(value, {})]) {
      const window = createQueryWindow(emptyEmit); window.open(); const captured = wrap(window.getter);
      captured('module'); captured('worker_threads'); denies(() => captured('module'), 'BOOTSTRAP_REVOKED');
      denies(() => window.qualify(), 'BOOTSTRAP_INCOMPLETE_OR_VIOLATION');
    }
    return { capturedAndProxyPermanent: true };
  },
  async G04() {
    for (const sentinel of [null, undefined]) {
      const original = () => {}, host = { getBuiltinModule: original }, window = createQueryWindow(emptyEmit);
      let caught = false;
      try { await importWithWindow({ host, window, load: async () => { host.getBuiltinModule('module'); throw sentinel; } }); }
      catch (error) { caught = true; assert.equal(error, sentinel); }
      assert(caught); assert.equal(host.getBuiltinModule, original); assert(window.snapshot().revoked);
      denies(() => window.getter('worker_threads'), 'BOOTSTRAP_REVOKED');
    }
    const sentinel = {}, later = {};
    const window = createQueryWindow(emptyEmit), host = { getBuiltinModule() {} };
    await assert.rejects(importWithWindow({ host, window, load: async () => { throw sentinel; }, afterRevoke: () => { throw later; } }), error => error.primaryPresent && error.primary === sentinel && error.cleanup[0] === later);
    return { exactNullUndefined: true, selectedAndLaterPreserved: true };
  },
  G05() {
    const sentinel = {}, failed = createQueryWindow(() => { throw sentinel; }); failed.open();
    assert.throws(() => failed.getter('module'), error => error === sentinel); assert(failed.snapshot().revoked);
    let window; window = createQueryWindow(() => { try { window.getter('worker_threads'); } catch {} }); window.open(); window.getter('module');
    denies(() => window.qualify(), 'BOOTSTRAP_INCOMPLETE_OR_VIOLATION');
    assert(window.snapshot().violations.some(row => row.code === 'BOOTSTRAP_REENTRANT'));
    return { observerFaultAndReentrancyDenied: true };
  },
  async G06() {
    const before = createQueryWindow(emptyEmit); denies(() => before.getter('module'), 'BOOTSTRAP_REVOKED'); denies(() => before.open(), 'BOOTSTRAP_REOPEN');
    const window = createQueryWindow(emptyEmit);
    await assert.rejects(importWithWindow({ host: { getBuiltinModule() {} }, window, load: async () => 1 }), error => error.code === 'BOOTSTRAP_INCOMPLETE_OR_VIOLATION');
    assert(window.snapshot().revoked);
    return { incompleteAndReopenRefused: true };
  },
  async G07() {
    const window = createQueryWindow(emptyEmit), host = { getBuiltinModule() {} };
    let captured;
    await importWithWindow({ host, window, load: async () => { captured = host.getBuiltinModule; captured('module'); captured('worker_threads'); } });
    try { captured('module'); } catch {}
    denies(() => closeQueryWindow(window), 'BOOTSTRAP_INCOMPLETE_OR_VIOLATION');
    return { lateCaughtFailureSticky: true };
  },
  G08() {
    const config = JSON.parse(fs.readFileSync(path.join(root, '../executor-v6/runs/admission-v6-01/child-003.json')));
    const parent = pathToFileURL(path.join(root, 'worker.mjs')).href;
    const value = authenticateBootstrap(config.view, parent, parent, projection);
    denies(() => authenticateBootstrap(config.view, `${parent}?alias`, parent, projection), 'BOOTSTRAP_PARENT');
    denies(() => authenticateBootstrap({ ...config.view, consumerPath: 'wrong.mjs' }, parent, parent, projection), 'BOOTSTRAP_ENTRY');
    denies(() => authenticateBootstrap({ ...config.view, engine: 'virtual-bash' }, parent, parent, projection), 'BOOTSTRAP_ENGINE');
    const files = config.view.files.map(entry => entry.path.endsWith('/bundle/index.js') ? { ...entry, sha256: '0'.repeat(64) } : entry);
    denies(() => authenticateBootstrap({ ...config.view, files }, parent, parent, projection), 'BOOTSTRAP_SOURCE');
    return { ...value, sourceOnly: true, engineEvaluations: 0, mutationOfHistoricalFiles: false };
  },
};
for (const [id] of plan.gateFamilies) await family(id, gates[id]);

for (const [id, scenario, expectedNested] of plan.bodyFamilies) await family(id, async () => {
  const directory = subdirectory(id);
  const resultRoot = path.join(directory, 'body-root/runs/case');
  const args = scenario === 'invalid-cli' ? ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(root, 'coordinator.mjs'), 'invalid', 'never-admission', 'NO_AUTHORITY'] : ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(root, 'body-driver.mjs'), scenario, directory];
  const result = await observeCoordinator({ node: process.execPath, args, cwd: root, captureRoot: path.join(directory, 'outer'), resultRoot, deadline: 30000, preflight: tools, postflight: tools, syntheticOnly: true });
  outerChildren.push(...result.ledger);
  const receipt = result.receipt;
  assert(receipt && naturalClosed(receipt));
  const final = receipt.records.at(-1);
  const nested = final?.report?.children ?? [];
  if (Array.isArray(nested)) nestedChildren.push(...nested);
  assert.equal(nested.length, expectedNested);
  assert.equal(result.qualified, scenario === 'positive');
  assert.equal(assessTerminal(receipt, resultRoot), false, 'synthetic must not qualify production');
  const observations = { scenario, qualified: result.qualified, exit: receipt.exit, close: receipt.close, reaped: receipt.reaped, natural: receipt.natural, captureBytes: receipt.captureBytes, retained: { stdout: Buffer.from(receipt.stdout, 'base64').length, stderr: Buffer.from(receipt.stderr, 'base64').length }, failures: receipt.failures, signals: receipt.signals, nested, receipt: result.reference, outer: result.summaryReference };
  if (scenario === 'positive') {
    positive = receipt; positiveRoot = resultRoot; positiveTerminal = JSON.parse(Buffer.from(receipt.stdout, 'base64'));
    const artifact = readDocument(resultRoot, positiveTerminal.result.path, positiveTerminal.result.sha256);
    const probe = artifact.probes.rows[0].report;
    assert.equal(probe.factoryCalls, 1); assert.equal(probe.nativeDelegations, 0); assert.equal(probe.loads.length, 1); assert.equal(probe.bootstrap.consumed, 2); assert(probe.bootstrap.revoked);
    assert.equal(probe.loads[0].sha256, digest(fs.readFileSync(path.join(root, 'fixtures/bootstrap-stub.mjs'))));
    assert.equal(JSON.parse(fs.readFileSync(path.join(resultRoot, 'child-001.json'))).schema, 'BOUND_JSON_PARTS_V1');
    assert.equal(JSON.parse(fs.readFileSync(path.join(resultRoot, 'STAGED.json'))).schema, 'BOUND_JSON_PARTS_V1');
    observations.actualStubBinding = probe.loads;
  } else if (scenario === 'overflow') {
    assert.equal(receipt.captureBytes.stdout, 65537); assert.equal(Buffer.from(receipt.stdout, 'base64').length, 65536);
    assert.equal(receipt.exit.code, 0); assert.equal(receipt.close.code, 0); assert.equal(receipt.natural, false); assert(receipt.signals.includes('SIGTERM')); assert(receipt.failures.some(error => error.code === 'CAPTURE_LIMIT')); assert.equal(final.report.timerRetired, true);
    observations.newUnretainedBytes = 1;
  } else if (scenario === 'nonzero') { assert.equal(receipt.exit.code, 7); assert.equal(JSON.parse(Buffer.from(receipt.stdout, 'base64')).status, 'ADMISSION_ACCEPTED'); }
  else if (scenario === 'missing-failures') { assert.equal(receipt.exit.code, 0); assert.equal(receipt.natural, true); assert(!Object.hasOwn(JSON.parse(Buffer.from(receipt.stdout, 'base64')), 'failures')); }
  else {
    assert.notEqual(receipt.exit.code, 0);
    if (scenario === 'authorization-null') { assert(final.report.rawPrimaryPresent && final.report.rawPrimaryNull); assert(final.report.cleanupErrors.some(row => row.reason === 0)); }
    if (scenario === 'stdout-failure') { assert.equal(receipt.captureBytes.stdout, 0); assert(receipt.captureBytes.stderr > 0 && receipt.captureBytes.stderr <= 32768); }
    if (scenario === 'receipt-persistence') {
      const terminal = JSON.parse(Buffer.from(receipt.stdout, 'base64'));
      const artifact = readDocument(resultRoot, terminal.result.path, terminal.result.sha256);
      assert(artifact.children[0].emergencyReceipt); assert.equal(artifact.children[0].persisted, false);
    }
    if (['caught-gate', 'late-caught-gate', 'config-tamper'].includes(scenario)) {
      const descriptor = fs.readFileSync(path.join(resultRoot, 'child-001.receipt.json'));
      const nestedReceipt = readDocument(resultRoot, 'child-001.receipt.json', digest(descriptor));
      const nestedFinal = nestedReceipt.records.at(-1).report;
      assert.equal(nestedFinal.factoryCalls, scenario === 'late-caught-gate' ? 1 : 0);
      assert.equal(nestedFinal.nativeDelegations, 0);
      if (scenario === 'config-tamper') assert.equal(nestedFinal.loads.length, 0);
      else assert(nestedFinal.bootstrap.violations.length > 0);
    }
  }
  return observations;
});

const data = {
  D01() {
    const { directory, budget } = recordStore('D01-files', { limit: 100 });
    const first = createStore(directory, { budget }), second = createStore(directory, { budget });
    first.save('first.json', 'a'.repeat(30)); second.save('second.json', 'b'.repeat(30));
    budget.external(path.join(directory, 'claim'), Buffer.alloc(30));
    denies(() => second.save('third.json', 'c'.repeat(10)), 'EVIDENCE_CAP');
    budget.audit(); return budget.snapshot();
  },
  D02() {
    const { directory, store } = recordStore('D02-files');
    const value = { text: 'p'.repeat(700000) }, reference = store.save('large.json', value);
    assert.deepEqual(readDocument(directory, reference.path, reference.sha256), value);
    denies(() => readDocument(directory, reference.path, '0'.repeat(64)), 'REFERENCE_HASH');
    const filename = path.join(directory, 'large.json.part-0000.data'); const bytes = fs.readFileSync(filename); bytes[0] ^= 1; fs.writeFileSync(filename, bytes);
    denies(() => readDocument(directory, reference.path, reference.sha256), 'REFERENCE_HASH');
    fs.renameSync(filename, `${filename}.intentionally-missing`);
    assert.throws(() => readDocument(directory, reference.path, reference.sha256), error => error.code === 'ENOENT');
    return { multipart: true, descriptorPartMissingRejects: 3 };
  },
  D03() {
    let calls = 0; const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { calls++; return 1; } });
    denies(() => encode(accessor), 'SERIALIZATION_ACCESSOR'); assert.equal(calls, 0);
    const cyclic = {}; cyclic.self = cyclic; denies(() => encode(cyclic), 'SERIALIZATION_CYCLE');
    denies(() => encode('x'.repeat(1024), 100), 'DOCUMENT_CAP');
    return { getterCalls: calls, denied: 3 };
  },
  D04() {
    const { directory, budget } = recordStore('D04-files'); let writes = 0, closes = 0;
    const later = new Error('close fault');
    const io = { openSync: fs.openSync, writeSync(descriptor, bytes, offset) { if (writes++) throw undefined; return fs.writeSync(descriptor, bytes, offset, 1); }, closeSync(descriptor) { closes++; fs.closeSync(descriptor); throw later; } };
    const store = createStore(directory, { budget, io });
    assert.throws(() => store.save('partial.json', { value: 7 }), error => error.code === 'RECORD_WRITE_AND_CLOSE' && error.primaryPresent && error.primary === undefined && error.cleanup === later);
    assert.equal(closes, 1); assert.equal(fs.statSync(path.join(directory, 'partial.json')).size, 1); budget.audit({ partial: true });
    return { partialBytes: 1, closes, selectedUndefined: true, laterClosePreserved: true };
  },
  D05() {
    assert(positive && positiveTerminal, 'POSITIVE_PREREQUISITE_NOT_QUALIFIED');
    let accessorCalls = 0, denied = 0;
    const check = receipt => { assert.equal(assessTerminal(receipt, positiveRoot, { syntheticOnly: true }), false); denied++; };
    for (const mutate of [value => { delete value.failures; }, value => { value.extra = true; }, value => { value.natural = false; }, value => { value.signals.push('SIGTERM'); }, value => { value.failures.push({ code: 'CAPTURE_LIMIT' }); }, value => { value.captureBytes.stdout++; }, value => { delete value.records[0]; }, value => { value.exit.code = 7; }, value => { value.rawRecords = ''; }, value => { value.stdout += 'notbase64'; }, value => { Object.defineProperty(value, 'failures', { enumerable: true, get() { accessorCalls++; throw new Error('must not read'); } }); }]) { const value = structuredClone(positive); mutate(value); check(value); }
    for (const mutate of [value => { delete value.failures; }, value => { value.failures = {}; }, value => { value.children[0].reaped = false; }, value => { value.result.bytes++; }, value => { value.primary.present = true; }, value => { value.extra = true; }]) {
      const terminal = structuredClone(positiveTerminal); mutate(terminal); const bytes = encode(terminal); check({ ...positive, stdout: bytes.toString('base64'), captureBytes: { ...positive.captureBytes, stdout: bytes.length } });
    }
    assert.equal(accessorCalls, 0); return { denied, accessorCalls, standaloneDataNotProductionBypass: true };
  },
  D06() {
    const bytes = fs.readFileSync(path.join(root, '../executor-v6/runs/admission-v6-01/RESULT.json'));
    assert.equal(bytes.length, 531954); assert.equal(digest(bytes), '902e4643e0e4865daad215c7a7c0cd1285218a8714904169ccf70e18d3467cb2');
    const retained = fs.readFileSync(path.join(root, '../executor-v6/runs/grant-admission-v6-01/coordinator.stdout'));
    assert.equal(retained.length, 65536);
    return { originalObservedBytes: 359581, originalRetainedBytes: retained.length, permanentlyIrrecoverableBytes: 294045, originalResultBytes: bytes.length, oldRecordCapViolated: true, rawTailReconstructed: false };
  },
  D07() {
    const { directory, budget, store } = recordStore('D07-files');
    denies(() => budget.external(path.join(directory, 'AGENTS.md'), Buffer.from('not written')), 'EVIDENCE_INSTRUCTION');
    store.save('file.json', { value: 1 }); const filename = path.join(directory, 'file.json'); const original = fs.readFileSync(filename);
    fs.chmodSync(filename, 0o600); denies(() => budget.audit(), 'EVIDENCE_OBSERVED_SIZE_MODE'); fs.chmodSync(filename, 0o644);
    fs.writeFileSync(filename, '{"value":2}\n'); denies(() => budget.audit(), 'EVIDENCE_CONTENT');
    fs.writeFileSync(filename, original);
    budget.external(path.join(directory, 'link'), Buffer.alloc(0));
    fs.symlinkSync('file.json', path.join(directory, 'link')); denies(() => budget.audit(), 'EVIDENCE_SYMLINK');
    return { instructionPlaintextWritten: false, ownedDataModeHashSymlinkRejects: true };
  },
  async D08() {
    const results = [];
    for (const name of ['cycle', 'ledger', 'outputs']) {
      const { store } = recordStore(`D08-${name}`), ledger = createLedger(1), streams = [];
      const output = { mode: 'admission', runId: 'synthetic-only', status: 'ADMISSION_ACCEPTED', unsafe: false };
      if (name === 'cycle') { const cycle = {}; cycle.self = cycle; output.fatal = cycle; }
      if (name === 'ledger') ledger.summary = () => { throw undefined; };
      const outcome = publish({ output, ledger, store, writeStream(descriptor, bytes) { assert(bytes.length <= 32768); streams.push({ descriptor, bytes: bytes.length }); if (name === 'outputs') throw new Error('injected write failure'); } });
      assert(outcome.unsafe); assert.notEqual(outcome.exitCode, 0); assert(streams.length <= 2); results.push({ name, status: outcome.status, failures: outcome.failures.map(row => row.phase), streams });
    }
    const directory = subdirectory('D08-composed'), streams = [];
    const drivers = {
      checkpoint(phase, state) { if (phase === 'tail') { const cyclic = {}; cyclic.self = cyclic; state.output.serializationCounterexample = cyclic; } },
      configure: () => ({ schedule: { rows: [] }, workflows: [] }),
      authorize: () => ({ recipe, synthetic: true, grant: { syntheticOnly: true }, authorization: { syntheticOnly: true }, plan: { admission: [], limits: { admissionSetup: 0 } } }),
      stageDeclaration: () => ({ views: [], evidenceFiles: [] }), stage: () => ({ views: {}, proof: 'EMPTY_SYNTHETIC_ONLY' }),
      integrity: tools, defectControls: () => [], controls: () => ({ unsafe: false, rows: Array.from({ length: 12 }, () => ({ pass: true, syntheticOnly: true })) }),
      cleanup() {}, inheritedExitCode: () => 0, writeStream(descriptor, bytes) { streams.push({ descriptor, bytes: bytes.length }); },
    };
    const composed = await runCoordinator({ root: directory, mode: 'admission', runId: 'empty-synthetic', repository: root }, drivers);
    assert.equal(composed.ledger.length, 0); assert(composed.publication.unsafe); assert.notEqual(composed.publication.exitCode, 0); assert(streams.every(row => row.bytes <= 32768));
    results.push({ name: 'actual-whole-body-serialization', status: composed.publication.status, children: 0, streams });
    return results;
  },
  D09() {
    const directory = subdirectory('D09-files'), filename = path.join(directory, 'AUTH.json');
    const binding = { commit: 'a'.repeat(40), path: 'tests/synthetic-only.json', sha256: 'b'.repeat(64) };
    const value = { review: binding, grant: binding }, bytes = encode(value);
    fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o644 });
    assert.deepEqual(readAuthorization(filename, digest(bytes), root), value);
    denies(() => readAuthorization(filename, '0'.repeat(64), root), 'AUTH_FILE_HASH');
    const extra = encode({ ...value, extra: true }); fs.writeFileSync(filename, extra);
    denies(() => readAuthorization(filename, digest(extra), root), 'AUTH_FILE_SCHEMA');
    const oversize = Buffer.alloc(65537, 32); fs.writeFileSync(filename, oversize);
    denies(() => readAuthorization(filename, digest(oversize), root), 'AUTH_FILE_METADATA');
    return { denied: 3, actualGitOrAuthorityExecution: false };
  },
};
for (const [id] of plan.recordFamilies) await family(id, data[id]);
const census = [];
let bytes = 0;
function walk(directory) {
  for (const name of fs.readdirSync(directory).sort()) {
    const filename = path.join(directory, name), info = fs.lstatSync(filename);
    assert(census.length < 4096, 'SYNTHETIC_ENTRY_CAP');
    if (info.isSymbolicLink()) { census.push({ path: path.relative(work, filename), type: 'intentional-data-guard-symlink', target: fs.readlinkSync(filename) }); continue; }
    if (info.isDirectory()) { walk(filename); continue; }
    assert(info.isFile() && info.size <= plan.bounds.recordBytes, `RECORD_CAP:${filename}`);
    bytes += info.size; assert(bytes <= plan.bounds.totalBytes, 'SYNTHETIC_TOTAL_CAP');
    census.push({ path: path.relative(work, filename), bytes: info.size, mode: info.mode & 0o7777, sha256: digest(fs.readFileSync(filename)) });
  }
}
try { tools(); walk(work); assert(outerChildren.length <= plan.bounds.outerChildren && nestedChildren.length <= plan.bounds.nestedStubChildren); }
catch (error) { unsafe = true; rows.push({ id: 'FINAL_INTEGRITY', status: 'UNSAFE_STOP', pass: false, failure: reason(error) }); }
const summary = { schema: 'V7_SYNTHETIC_OUTCOME', recipe, total: plan.bounds.families, pass: rows.filter(row => row.pass === true).length, fail: rows.filter(row => row.pass === false).length, unrun: rows.filter(row => row.pass === null).length, unsafe, outerChildren, nestedChildren, actualEngineImports: 0, actualC11: 0, actualSemanticCalls: 0, historicalRescore: false, evidenceBytesBeforeFinal: bytes, rows };
evidence.save('CENSUS.json', census);
const reference = evidence.save('RESULT.json', summary);
tools(); evidenceBudget.audit();
fs.writeSync(1, encode({ pass: summary.pass, fail: summary.fail, unrun: summary.unrun, unsafe, outerChildren: outerChildren.length, nestedChildren: nestedChildren.length, reference }, 8192));
process.exitCode = summary.fail || summary.unrun || unsafe ? 1 : 0;
