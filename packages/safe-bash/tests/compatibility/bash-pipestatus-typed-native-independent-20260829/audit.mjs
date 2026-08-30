import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const repository = '/Users/kjopek/Workspace/safe-bash';
const root = '/private/tmp/safe-bash-typed6-independent-20260829';
const base = repository + '/tests/compatibility/bash-pipestatus-typed-native-reference-20260829';
const actual = base + '/actual-run-v2';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const read = (file, cap = 131072) => {
  assert.equal(fs.realpathSync(file), file);
  const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= cap);
  const bytes = fs.readFileSync(file); assert.equal(bytes.length, stat.size); return bytes;
};
for (const [descriptor, suffix] of [[1, '.stdout'], [2, '.stderr']]) {
  const actualFd = fs.fstatSync(descriptor), declared = fs.lstatSync(root + '/audit' + suffix);
  assert.ok(actualFd.isFile() && declared.isFile()); assert.equal(actualFd.ino, declared.ino); assert.equal(actualFd.dev, declared.dev);
}
const phase = JSON.parse(read(root + '/PHASE.json')); assert.ok(Date.now() < phase.deadlineMs);
assert.equal(process.execPath, '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node');
const treeBytes = read(root + '/author-tree.nul', 1048576);
const tree = new Map(treeBytes.toString('utf8').split('\0').filter(Boolean).map(line => {
  const match = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)$/.exec(line); assert.ok(match); return [match[3], { mode: match[1], blob: match[2] }];
}));
const bound = [];
function authenticate(file, row, requireGit = true) {
  const bytes = read(file); const stat = fs.lstatSync(file);
  assert.equal(bytes.length, row.bytes); assert.equal(stat.mode & 511, row.mode); assert.equal(hash(bytes), row.sha256);
  if (requireGit) { const entry = tree.get(path.relative(repository, file)); assert.ok(entry, 'selected Git member: ' + file); assert.equal(blob(bytes), entry.blob); }
  bound.push({ path: file, bytes: bytes.length, sha256: hash(bytes), gitBound: requireGit }); return bytes;
}
const sealBytes = read(actual + '/SEAL.json'); assert.equal(hash(sealBytes), '7a043c0bdc645e6c45d3a193d686e1741fcdb9662a5951dac141a41018937201');
assert.equal(blob(sealBytes), tree.get(path.relative(repository, actual + '/SEAL.json')).blob);
const seal = JSON.parse(sealBytes); assert.equal(seal.schema, 'typed6-native-evidence-seal-v2');
const evidence = new Map();
for (const row of seal.rows) {
  assert.ok(!path.isAbsolute(row.path) && !row.path.split('/').includes('..'));
  assert.ok(!evidence.has(row.path)); evidence.set(row.path, authenticate(actual + '/' + row.path, row));
}
assert.equal([...evidence.values()].reduce((sum, bytes) => sum + bytes.length, 0), seal.logicalBytes);
const preflight = JSON.parse(evidence.get('PREFLIGHT.json'));
const sourceRecords = preflight.records.filter(row => row.path.startsWith(repository + '/'));
const toolRecords = preflight.records.filter(row => !row.path.startsWith(repository + '/'));
for (const row of sourceRecords) authenticate(row.path, row);
const tools = JSON.parse(read(base + '/materialized/TOOLS.json'));
const pins = tools.freshPins; assert.equal(pins.length, 4);
const toolResults = [];
for (const pin of pins) {
  const stat = fs.lstatSync(pin.path); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, pin.bytes); assert.equal(stat.mode & 511, pin.mode);
  const digest = createHash('sha256'); let bytes = 0;
  for await (const chunk of fs.createReadStream(pin.path, { highWaterMark: 65536 })) { bytes += chunk.length; assert.ok(bytes <= pin.bytes); digest.update(chunk); }
  assert.equal(bytes, pin.bytes); assert.equal(digest.digest('hex'), pin.sha256); toolResults.push({ path: pin.path, bytes, sha256: pin.sha256, execution: false });
}
const slot = preflight.slotReceipt; const slotBytes = read(slot.path); assert.equal(slotBytes.length, slot.bytes); assert.equal(hash(slotBytes), slot.sha256); assert.equal(blob(slotBytes), slot.blob); assert.equal(tree.get(path.relative(repository, slot.path)).blob, slot.blob);
const cohort = JSON.parse(read(base + '/materialized/COHORT.json'));
const programs = [
  'declare -p PIPESTATUS',
  'readonly PIPESTATUS; false; declare -p PIPESTATUS',
  'false; readonly PIPESTATUS; true; declare -p PIPESTATUS',
  'f() { local PIPESTATUS; false | true; declare -p PIPESTATUS; }; false; f; declare -p PIPESTATUS',
  'f() { local -a PIPESTATUS; false | true; declare -p PIPESTATUS; }; false; f; declare -p PIPESTATUS',
  'PIPESTATUS=seed; false; declare -p PIPESTATUS',
];
assert.equal(cohort.cases.length, 6); assert.deepEqual(cohort.fixtures, []); assert.deepEqual(cohort.failedLookups, []);
for (const [index, row] of cohort.cases.entries()) { assert.equal(row.id, 'P' + (19 + index)); assert.equal(row.program, programs[index]); assert.equal(hash(Buffer.from(row.program)), row.programSha256); assert.equal(row.stdinBase64, ''); assert.equal(row.expectedNative, null); }
function base64(value) { assert.match(value, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/); const bytes = Buffer.from(value, 'base64'); assert.equal(bytes.toString('base64'), value); return bytes; }
function frame(bytes, id, receipt, captures) {
  assert.ok(bytes.length <= 262144); assert.equal(bytes[bytes.length - 1], 0);
  const fields = bytes.toString('utf8').split('\0'); assert.equal(fields.length, 9); assert.equal(fields[8], ''); assert.equal(fields[0], 'FNPIPEOBS1'); assert.equal(fields[1], id);
  assert.match(fields[2], /^(0|[1-9][0-9]{0,2})$/); const status = Number(fields[2]); assert.ok(status <= 255); assert.equal(status, receipt.status);
  for (const [index, name] of ['stdout', 'stderr'].entries()) {
    assert.match(fields[3 + 2 * index], /^(0|[1-9][0-9]*)$/); const output = base64(fields[4 + 2 * index]); assert.equal(output.length, Number(fields[3 + 2 * index])); assert.deepEqual(output, captures[name]);
  }
  const effects = JSON.parse(base64(fields[7])); assert.deepEqual(effects.before, receipt.filesBefore); assert.deepEqual(effects.after, receipt.filesAfter); assert.deepEqual(effects.before, effects.after);
  return { status, stdout: captures.stdout.toString('utf8'), stderr: captures.stderr.toString('utf8'), effects: effects.after };
}
const authorClaims = [
  [1, '', 'pipestatus-typed-case: line 0: declare: PIPESTATUS: not found\n'],
  [1, '', 'pipestatus-typed-case: line 0: declare: PIPESTATUS: not found\n'],
  [0, 'declare -ar PIPESTATUS=\'([0]="0")\'\n', ''],
  [0, 'declare -- PIPESTATUS=""\ndeclare -a PIPESTATUS=\'([0]="0")\'\n', ''],
  [0, 'declare -a PIPESTATUS=\'([0]="1" [1]="0")\'\ndeclare -a PIPESTATUS=\'([0]="0")\'\n', ''],
  [0, 'declare -- PIPESTATUS="seed"\n', ''],
];
const observations = [], frames = [];
for (const [index, row] of cohort.cases.entries()) {
  const receipt = JSON.parse(evidence.get('native-artifacts/' + row.id + '.json.data'));
  assert.equal(receipt.id, row.id); for (const key of ['exit', 'close', 'spawnObserved', 'stdinFinished', 'retired', 'filesVerified', 'regularCaptureCompletion']) assert.equal(receipt[key], true);
  assert.equal(receipt.stop, null); assert.equal(receipt.signal, null); assert.deepEqual(receipt.errors, []); assert.deepEqual(receipt.signals, []); assert.equal(receipt.group.state, 'absent'); assert.ok(receipt.finished >= receipt.started);
  assert.deepEqual(receipt.filesBefore.map(item => item.path), ['empty-path', 'home', 'tmp', 'work']);
  const captures = {};
  for (const capture of receipt.capture) {
    const raw = evidence.get('native-artifacts/captures/' + row.id + '/' + capture.name + '.data'); assert.ok(raw);
    assert.equal(raw.length, capture.bytes); assert.equal(hash(raw), capture.sha256); assert.deepEqual(base64(capture.base64), raw);
    for (const key of ['flush', 'size', 'hash', 'close']) assert.equal(capture[key], true); captures[capture.name] = raw;
  }
  assert.deepEqual(Object.keys(captures), ['stdout', 'stderr']);
  const bytes = evidence.get('native-artifacts/' + row.id + '.observation.nul.data'); assert.equal(bytes.length, receipt.observation.bytes); assert.equal(hash(bytes), receipt.observation.sha256);
  const observed = frame(bytes, row.id, receipt, captures); assert.deepEqual([observed.status, observed.stdout, observed.stderr], authorClaims[index]);
  observations.push({ id: row.id, program: row.program, ...observed, retired: true, pid: receipt.pid, receiptPublishedAtSerialization: receipt.receiptPublished }); frames.push({ bytes, id: row.id, receipt, captures });
}
const controls = [];
const original = frames[0]; const fields = original.bytes.toString().split('\0');
const mutations = [
  ['wrong-magic', values => { values[0] = 'FNPIPEOBS2'; }],
  ['missing-terminal-NUL', values => { values.pop(); }],
  ['duplicate-field', values => { values.splice(2, 0, values[1]); }],
  ['wrong-length', values => { values[3] = '1'; }],
  ['changed-stderr', values => { values[6] = Buffer.from('wrong\n').toString('base64'); values[5] = '6'; }],
  ['changed-effects', values => { values[7] = Buffer.from(JSON.stringify({ before: [], after: [] })).toString('base64'); }],
];
for (const [id, mutate] of mutations) { const changed = [...fields]; mutate(changed); assert.throws(() => frame(Buffer.from(changed.join('\0')), original.id, original.receipt, original.captures)); controls.push({ id, status: 'REJECTED_AS_REQUIRED' }); }
const results = JSON.parse(evidence.get('native-artifacts/RESULTS.json.data'));
assert.equal(results.completed, 6); assert.equal(results.halted, false); assert.deepEqual(results.notStarted, []); assert.equal(results.ledger.confirmedStarts, 7); assert.equal(results.ledger.activeConfirmed, 1); assert.equal(results.ledger.sourceForkReservations, 4);
for (const row of results.rows) { const observed = observations.find(item => item.id === row.id); assert.ok(observed); assert.equal(row.status, observed.status); assert.equal(row.retired, true); assert.equal(row.stop, null); }
const journal = evidence.get('native-artifacts/JOURNAL.jsonl.data').toString().trimEnd().split('\n').map(line => JSON.parse(line));
const rawBytes = [...evidence.entries()].filter(([name]) => name.startsWith('native-artifacts/')).reduce((sum, [, bytes]) => sum + bytes.length, 0); assert.equal(rawBytes, 25569);
const requests = JSON.parse(read(base + '/materialized/REQUESTS.json'));
const approval = JSON.parse(read(base + '/activation-v1/APPROVAL-REQUEST.json'));
const output = { status: 'DATA_AUDIT_COMPLETED', observations, controls, evidenceRows: evidence.size, rawBytes, sourceRecords: sourceRecords.map(row => row.path), toolRecordCount: toolRecords.length, tools: toolResults, slot: { ...slot, blobVerified: true }, requests, approval, journal, results, sealClaimedCounts: { source: seal.sourceMembersReauthenticated, tools: seal.toolPinsReauthenticated }, authorAdminRetirement: 'reported18; no independent OS attestation inferred', ownerRetirement: 'author tool75018f exit0 reported; persisted ledger remains active1', noNativeExecution: true, noProductImports: true, finishedMs: Date.now() };
assert.ok(output.finishedMs < phase.deadlineMs);
for (const row of bound) assert.equal(hash(read(row.path)), row.sha256);
fs.writeFileSync(root + '/AUDIT.json', JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: output.status, observations: observations.length, controls: controls.length, evidenceRows: evidence.size, rawBytes, sourceRecords: sourceRecords.length, tools: toolResults.length, journalRows: journal.length, requestKeys: Object.keys(requests), approvalKeys: Object.keys(approval) }));
