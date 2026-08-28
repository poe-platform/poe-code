import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatePacket, readAuthorization, authority, loadAuthorityReference } from './authorization.mjs';
import { referenceData, reviewData, grantData, dispositionData, childLedgerData, wireLimits } from './contracts.mjs';
import { createEvidenceBudget } from './evidence.mjs';
import { createStore, readDocument, readConfig, saveInput, encode, digest } from './records.mjs';
import { observeCoordinator } from './outer.mjs';
import { assessTerminal } from './report.mjs';
import { supervise } from './supervisor.mjs';
import { createLedger, launchTracked } from './launch-ledger.mjs';
import { boundFile } from './projection.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(fs.readFileSync(path.join(root, 'PLAN.json'))), recipe = authenticatePacket(root);
const bindings = new Map(JSON.parse(fs.readFileSync(path.join(root, 'SEAL.json'))).files.map(entry => [entry.path, entry]));
const projection = JSON.parse(fs.readFileSync(path.join(root, '../executor-v3/PROJECTION.json')));
const guard = () => { assert.equal(authenticatePacket(root), recipe); for (const tool of projection.tools) boundFile(tool.path, tool); };
guard();
const work = path.join(root, 'runs', plan.runId); fs.mkdirSync(work);
const receiptsRoot = path.join(work, 'receipts'); fs.mkdirSync(receiptsRoot);
const budget = createEvidenceBudget(receiptsRoot, { limit: 8 * 1024 * 1024 });
const store = createStore(receiptsRoot, { budget });
const rows = [], supervised = [], nested = [], metadata = [];
let unsafe = false, positive, positiveRoot, positiveArtifact;
const absence = pid => { try { process.kill(pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } };
const ownDir = name => { const directory = path.join(work, name); fs.mkdirSync(directory); return directory; };
const witness = (directory, pid) => {
  const value = JSON.parse(fs.readFileSync(path.join(directory, `loads-${pid}.json`)));
  assert.equal(value.pid, pid); assert.equal(value.denied.length, 0); assert(value.loaded.length > 0);
  for (const entry of value.loaded) { const expected = bindings.get(entry.path); assert(entry.actualNextLoad && expected && expected.sha256 === entry.sha256 && expected.bytes === entry.bytes); boundFile(path.resolve(root, entry.path), expected); }
  return { pid, loads: value.loaded.length, main: value.main };
};
async function family(id, action) {
  if (unsafe) { rows.push({ id, pass: null, status: 'UNRUN_UNSAFE_TAIL' }); return; }
  let observation, failure;
  try { guard(); observation = await action(); } catch (error) { failure = { code: error?.code ?? null, message: error?.message ?? null, stack: error?.stack ?? null }; }
  try {
    guard(); budget.audit();
    for (const child of [...supervised, ...nested]) assert(child.pid && child.reaped && child.exit && child.close && absence(child.pid) && absence(-child.pid), 'REAP_GUARD');
    for (const child of metadata) assert(child.pid && child.reaped && absence(child.pid) && absence(-child.pid), 'METADATA_REAP_GUARD');
  } catch (error) { unsafe = true; failure = { ...failure, unsafe: error.message }; }
  const row = { id, pass: !failure, status: failure ? unsafe ? 'UNSAFE_STOP' : 'FAIL' : 'PASS', observation, failure };
  rows.push(row); store.save(`${id}.json`, row);
}
store.save('PRE.json', { recipe, tools: projection.tools, planSha256: digest(fs.readFileSync(path.join(root, 'PLAN.json'))), currentPermission: plan.authorization, pid: process.pid });
for (const [id, scenario, expected, expectedMetadata, expectedWorkers] of plan.composed) await family(id, async () => {
  const directory = ownDir(id), resultRoot = path.join(directory, 'body/runs/case');
  const common = ['--unhandled-rejections=strict', '--max-old-space-size=256', '--import', path.join(root, 'guard.mjs')];
  const args = scenario === 'invalid-cli' ? [...common, path.join(root, 'coordinator.mjs'), 'invalid', 'never-admission', 'NO_AUTHORITY'] : [...common, path.join(root, 'actor.mjs'), scenario, directory];
  const observed = await observeCoordinator({ node: process.execPath, args, cwd: directory, captureRoot: path.join(directory, 'outer'), resultRoot, preflight: guard, postflight: guard, deadline: 30000, syntheticOnly: true });
  supervised.push(...observed.ledger);
  const receipt = observed.receipt;
  assert(receipt && receipt.reaped && receipt.exit && receipt.close);
  const closure = scenario === 'invalid-cli' ? { metadataRaw: [], children: [] } : JSON.parse(fs.readFileSync(path.join(directory, 'ACTOR-CLOSURE.json')));
  metadata.push(...closure.metadataRaw); nested.push(...closure.children);
  const witnesses = [witness(directory, receipt.pid), ...[...closure.metadataRaw, ...closure.children].map(child => witness(directory, child.pid))];
  assert.equal(closure.metadataRaw.length, expectedMetadata); assert.equal(closure.children.length, expectedWorkers);
  assert.equal(observed.qualified, expected); assert.equal(assessTerminal(receipt, resultRoot), false, 'stub authority cannot earn production qualification');
  const terminal = JSON.parse(Buffer.from(receipt.stdout, 'base64'));
  if (scenario === 'positive') {
    positive = receipt; positiveRoot = resultRoot;
    positiveArtifact = readDocument(resultRoot, terminal.result.path, terminal.result.sha256);
    assert.equal(receipt.records.length, 3); assert.equal(receipt.records.at(-1).report.children, 1);
  }
  if (scenario === 'intentional-status') { const artifact = readDocument(resultRoot, terminal.result.path, terminal.result.sha256); assert.equal(artifact.children[1].exit.code, 7); assert.equal(artifact.children[1].natural, false); }
  if (scenario === 'outer-nonzero') { assert.equal(receipt.exit.code, 7); assert.equal(terminal.status, 'ADMISSION_ACCEPTED'); }
  if (scenario === 'invalid-cli') { assert.equal(receipt.exit.code, 1); assert.equal(receipt.records.at(-1).report.children, 0); assert.equal(terminal.failures[0].code, 'REPORT_STORE_UNAVAILABLE'); }
  if (scenario === 'array-authority') { const artifact = readDocument(resultRoot, terminal.result.path, terminal.result.sha256); assert.equal(artifact.fatal.code, 'AUTHORIZATION_BINDING'); }
  return { qualified: observed.qualified, receiptReference: observed.reference, outerReference: observed.summaryReference, exit: receipt.exit, close: receipt.close, natural: receipt.natural, reaped: receipt.reaped, actualMetadata: closure.metadataRaw, children: closure.children, witnesses, scenario, syntheticAuthorityOnly: true };
});

const validReference = { commit: '0'.repeat(40), path: 'tests/NONEXISTENT-INERT.json', sha256: '1'.repeat(64) };
await family('A01', () => {
  const directory = ownDir('A01-inputs'); let negatives = 0, readCalls = 0, observeCalls = 0, getterCalls = 0, coercions = 0;
  const jsonCase = (name, value, expectedCode) => {
    const folder = path.join(directory, name); fs.mkdirSync(folder);
    const bytes = encode(value), filename = path.join(folder, 'AUTH.json'); fs.writeFileSync(filename, bytes, { flag: 'wx' });
    if (expectedCode) { assert.throws(() => readAuthorization(filename, digest(bytes), root), error => error.code === expectedCode); negatives++; }
    else assert.deepEqual(readAuthorization(filename, digest(bytes), root), value);
  };
  jsonCase('positive', { review: validReference, grant: validReference });
  for (const role of ['review', 'grant']) for (const [index, value] of [null, 0, true, [], [validReference.commit], {}, { value: validReference.commit }].entries()) jsonCase(`${role}-${index}`, { review: validReference, grant: validReference, [role]: { ...validReference, commit: value } }, 'AUTH_REFERENCE_SCHEMA');
  jsonCase('top-array', [], 'AUTH_FILE_SCHEMA');
  const invalid = [];
  for (const key of ['commit', 'path', 'sha256']) {
    for (const value of [undefined, null, 0, true, [], [validReference[key]], {}, new String(validReference[key])]) invalid.push({ ...validReference, [key]: value });
    const missing = { ...validReference }; delete missing[key]; invalid.push(missing);
    invalid.push(Object.assign(Object.create({ [key]: validReference[key] }), missing));
    invalid.push(Object.defineProperty({ ...missing }, key, { enumerable: true, get() { getterCalls++; return validReference[key]; } }));
    invalid.push({ ...validReference, [key]: { toString() { coercions++; return validReference[key]; }, toJSON() { coercions++; return validReference[key]; } } });
  }
  invalid.push({ ...validReference, extra: true });
  for (const binding of invalid) {
    assert.equal(referenceData(binding), null);
    assert.throws(() => loadAuthorityReference(binding, { read() { readCalls++; }, observe() { observeCalls++; }, receipts: [], ordinal: 1 }), error => error.code === 'AUTHORIZATION_BINDING');
    for (const role of ['review', 'grant']) assert.throws(() => authority({ root: '/INERT', repository: '/INERT', phase: 'admission', runId: 'case', outputRoot: '/INERT/runs/case', review: validReference, grant: validReference, [role]: binding, observe() { observeCalls++; } }), error => error.code === 'AUTHORIZATION_BINDING');
    negatives += 4;
  }
  for (const value of [Object.assign(Object.create(null), validReference), Object.assign(Object.create({ unrelated: true }), validReference)]) assert(referenceData(value));
  assert.equal(readCalls, 0); assert.equal(observeCalls, 0); assert.equal(getterCalls, 0); assert.equal(coercions, 0);
  return { negatives, jsonPositive: 1, ownDataPrototypeIndependentPositives: 2, readCalls, observeCalls, getterCalls, coercions, realGitCalls: 0 };
});
await family('A02', () => {
  const review = { role: 'different-reviewer', verdict: 'PREEXECUTION_ACCEPTED', recipeSha256: '0'.repeat(64) };
  const grant = { role: 'root', phase: 'admission', attempts: 1, runId: 'inert-not-issued', outputRoot: '/INERT-NOT-AUTHORITY', recipeSha256: '0'.repeat(64), reviewSha256: '0'.repeat(64), planSha256: '0'.repeat(64), bootstrapProfile: 'JUST_BASH_3_4_2_UNAVAILABLE_BOOTSTRAP_V1', reportProtocol: 'BOUNDED_TERMINAL_V3', candidate: '0'.repeat(40), packSha256: '0'.repeat(64), command: { entry: 'coordinator.mjs', phase: 'admission', runId: 'inert-not-issued', nodeArgs: ['--unhandled-rejections=strict', '--max-old-space-size=256'] } };
  assert(reviewData(review)); assert(grantData(grant)); let negatives = 0, getters = 0;
  for (const [original, validate] of [[review, reviewData], [grant, grantData]]) {
    for (const key of Object.keys(original)) {
      for (const value of [undefined, null, [], [original[key]], {}, true]) { if (value === original[key]) continue; assert.equal(validate({ ...original, [key]: value }), null); negatives++; }
      const missing = { ...original }; delete missing[key]; assert.equal(validate(missing), null); negatives++;
      const inherited = Object.assign(Object.create({ [key]: original[key] }), missing); assert.equal(validate(inherited), null); negatives++;
      const accessor = Object.defineProperty(missing, key, { enumerable: true, get() { getters++; return original[key]; } }); assert.equal(validate(accessor), null); negatives++;
    }
    assert.equal(validate({ ...original, extra: true }), null); negatives++;
  }
  for (const command of [{ ...grant.command, extra: true }, { ...grant.command, nodeArgs: [...grant.command.nodeArgs].reverse() }, { ...grant.command, nodeArgs: new Array(2) }, { ...grant.command, runId: [grant.runId] }]) { assert.equal(grantData({ ...grant, command }), null); negatives++; }
  assert.equal(getters, 0); return { positives: 2, negatives, getters, documentsAreUnresolvableDataNotIssuedAuthority: true };
});
await family('A03', () => {
  assert(positive, 'POSITIVE_PREREQUISITE'); let negatives = 0, getterCalls = 0;
  const check = value => { assert.equal(assessTerminal(value, positiveRoot, { syntheticOnly: true }), false); negatives++; };
  const wire = mutate => { const value = structuredClone(positive); mutate(value.records); const bytes = Buffer.concat(value.records.map(row => encode(row))); value.rawRecords = bytes.toString('base64'); value.captureBytes.records = bytes.length; check(value); };
  for (const [key, value] of [['mode', []], ['runId', 'wrong'], ['status', 'UNSAFE_STOP'], ['unsafe', 0], ['children', '1'], ['children', true], ['children', 2], ['allChildrenReaped', false], ['result', null]]) wire(records => { records.at(-1).report[key] = value; });
  for (const key of ['mode', 'runId', 'status', 'unsafe', 'result', 'children', 'allChildrenReaped']) wire(records => { delete records.at(-1).report[key]; });
  wire(records => { records.at(-1).report.extra = true; });
  wire(records => { records.splice(1, 1); records.forEach((row, index) => { row.sequence = index; }); });
  for (const [key, value] of [['pid', '123'], ['pid', 0], ['group', 0], ['status', false], ['signal', 'SIGTERM'], ['errorCode', 'EPERM'], ['stdoutBytes', 0], ['stdoutBytes', 65537], ['stdoutSha256', []], ['stderrBase64', 'Cg=='], ['reaped', false], ['role', 'git-authority-metadata'], ['ordinal', 2]]) wire(records => { records[0].receipt[key] = value; });
  wire(records => { records[0].receipt.stdoutBytes++; });
  wire(records => { records[0].receipt.reference.commit = [records[0].receipt.reference.commit]; });
  wire(records => { records[0].receipt.extra = true; });
  wire(records => { delete records[0].receipt.reference; });
  wire(records => { [records[0].receipt, records[1].receipt] = [records[1].receipt, records[0].receipt]; });
  for (const mutate of [row => { row.natural = false; }, row => { row.exit.code = 7; }, row => { row.close = null; }, row => { delete row.failures; }, row => { row.captureBytes.stdout++; }, row => { row.signals = ['SIGTERM']; }, row => { row.failures = [{ code: 'CAPTURE_LIMIT' }]; }, row => { row.extra = true; }, row => { Object.defineProperty(row, 'records', { enumerable: true, get() { getterCalls++; return positive.records; } }); }]) { const value = structuredClone(positive); mutate(value); check(value); }
  assert.equal(getterCalls, 0); return { negatives, getterCalls, sourceAndDataFindingsNotProductionBypassClaims: true };
});
await family('A04', () => {
  assert(positive && positiveArtifact, 'POSITIVE_PREREQUISITE'); let negatives = 0, getters = 0;
  for (const disposition of [{ code: '0', signal: null }, { code: false, signal: null }, { code: null, signal: null }, { code: NaN, signal: null }, { code: Infinity, signal: null }, { code: -1, signal: null }, { code: 256, signal: null }, { code: 0, signal: false }, { code: null, signal: '' }, { code: 0 }, { signal: null }, { code: 0, signal: null, extra: true }, Object.create({ code: 0, signal: null }), Object.defineProperty({ signal: null }, 'code', { enumerable: true, get() { getters++; return 0; } })]) { assert.equal(dispositionData(disposition), null); negatives++; }
  for (const code of ['0', false, null]) { const receipt = structuredClone(positive), terminal = JSON.parse(Buffer.from(receipt.stdout, 'base64')); terminal.children[0].exit.code = code; terminal.children[0].close.code = code; const bytes = encode(terminal); receipt.stdout = bytes.toString('base64'); receipt.captureBytes.stdout = bytes.length; assert.equal(assessTerminal(receipt, positiveRoot, { syntheticOnly: true }), false); negatives++; }
  const original = positiveArtifact.children[0]; assert(childLedgerData(original, 1));
  for (const mutate of [row => { row.natural = false; }, row => { row.reaped = false; }, row => { row.close = null; }, row => { row.exit.code = 7; row.close.code = 7; }, row => { row.failures = [{ code: 'NATURAL_DEADLINE' }]; }, row => { row.errors = new Array(1); }, row => { row.extra = true; }]) { const row = structuredClone(original); mutate(row); assert.equal(childLedgerData(row, 1), null); negatives++; }
  const deadline = { ...structuredClone(original), operationId: 'C09-deadline', kind: 'control', natural: false, failures: [{ code: 'NATURAL_DEADLINE' }], signals: ['SIGTERM'] };
  assert(childLedgerData(deadline, 1)); assert.equal(childLedgerData({ ...deadline, signals: ['SIGKILL'] }, 1), null); negatives++;
  assert.equal(getters, 0); return { negatives, getters, actualC06Status7DistinctFromDeadlineDataModel: true, deadlineOnlyDataPositive: true };
});
await family('A05', async () => {
  const directory = ownDir('A05-inputs'), files = path.join(directory, 'files'); fs.mkdirSync(files);
  const localBudget = createEvidenceBudget(files, { limit: 16 * 1024 * 1024 }), local = createStore(files, { budget: localBudget });
  const results = [], ledger = createLedger(2);
  try {
    for (const [index, bytes] of [2097150, 2097151].entries()) {
      const value = 'x'.repeat(bytes - 3), name = `child-${String(index + 1).padStart(3, '0')}.json`;
      assert.equal(encode(value).length, bytes);
      const reference = saveInput(local, name, value); assert.equal(readConfig(files, name, reference.sha256), value);
      const receipt = await launchTracked({ ledger, kind: 'config-data', prepare: async () => ({ configSha: reference.sha256 }), supervise: (_prepared, attach) => supervise(process.execPath, ['--unhandled-rejections=strict', '--max-old-space-size=256', '--import', path.join(root, 'guard.mjs'), path.join(root, 'stub.mjs'), 'config', path.join(files, name), reference.sha256], directory, { onSpawn: attach }), persist: async (_entry, row) => store.save(`A05-child-${index}.json`, row).sha256 });
      supervised.push(ledger.entries.at(-1)); assert.equal(receipt.exit.code, 0); assert(receipt.natural && receipt.reaped); assert.equal(receipt.records.at(-1).report.encodedBytesIncludingLF, bytes);
      results.push({ bytesIncludingLF: bytes, reference, witness: witness(directory, receipt.pid) });
    }
  } finally { await ledger.closeAll(); for (const entry of ledger.entries) if (!supervised.includes(entry)) supervised.push(entry); }
  assert.throws(() => saveInput(local, 'child-003.json', 'x'.repeat(2097152 - 3)), error => error.code === 'DOCUMENT_CAP');
  assert(!fs.existsSync(path.join(files, 'child-003.json')));
  const stagedValue = 's'.repeat(2097152 - 3), staged = saveInput(local, 'STAGED.json', stagedValue);
  assert.equal(readDocument(files, 'STAGED.json', staged.sha256, wireLimits.staged), stagedValue);
  assert.equal(encode(stagedValue).length, 2097152);
  const envelope = JSON.parse(fs.readFileSync(path.join(files, 'child-001.json')));
  const altered = local.writeRecord('bad-envelope.json', encode({ ...envelope, extra: true }));
  assert.throws(() => readDocument(files, altered.path, altered.sha256, wireLimits.config), error => error.code === 'REFERENCE_DOCUMENT');
  assert.throws(() => readConfig(files, 'child-001.json', [staged.sha256]), error => error.code === 'REFERENCE_BINDING');
  assert.throws(() => saveInput(local, ['child-004.json'], 'value'), error => error.code === 'INPUT_NAME');
  localBudget.audit();
  return { results, configMaximumIncludingLF: 2097151, configPlusOneRefused: true, stagedMaximumIncludingLF: 2097152, envelopeExtraRefused: true, configHashArrayRefused: true, configNameArrayRefused: true, full248Plus8MiBBoundaries: 'STATIC_ONLY', heapIsNotRSS: true };
});

const census = []; let totalBytes = 0;
function censusTree(directory) {
  for (const name of fs.readdirSync(directory).sort()) {
    const filename = path.join(directory, name), info = fs.lstatSync(filename);
    assert(census.length < 4096 && !info.isSymbolicLink());
    if (info.isDirectory()) { censusTree(filename); continue; }
    assert(info.isFile() && info.size <= 262144, `RECORD_BOUND:${filename}`); totalBytes += info.size; assert(totalBytes <= 67108864);
    census.push({ path: path.relative(work, filename), bytes: info.size, mode: info.mode & 0o7777, sha256: digest(fs.readFileSync(filename)) });
  }
}
guard(); censusTree(work);
store.save('CENSUS.json', census);
const result = { recipe, rows, pass: rows.filter(row => row.pass === true).length, fail: rows.filter(row => row.pass === false).length, unrun: rows.filter(row => row.pass === null).length, unsafe, supervised, nested, metadata, totalBytesBeforeFinal: totalBytes, realEngines: 0, realGitAuthority: 0, actualStagingC11AdmissionOr99: 0, historicalRescore: false, full248Plus8MiB: 'STATIC_ONLY' };
const reference = store.save('RESULT.json', result); guard(); budget.audit();
fs.writeSync(1, encode({ pass: result.pass, fail: result.fail, unrun: result.unrun, unsafe, supervised: supervised.length, nested: nested.length, metadata: metadata.length, reference }, 8192));
process.exitCode = result.fail || result.unrun || unsafe ? 1 : 0;
