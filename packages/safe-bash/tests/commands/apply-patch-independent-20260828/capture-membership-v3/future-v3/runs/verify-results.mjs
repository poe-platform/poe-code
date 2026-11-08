import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const own = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prior = path.resolve(own, '../../path-transport-v2');
const evidence = path.join(own, 'evidence');
const read = filename => fs.readFileSync(filename);
const json = filename => JSON.parse(read(filename));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const final = json(path.join(own, 'FINAL.json'));
const seal = json(path.join(own, 'EXECUTION-SEAL.json'));
const runtime = json(path.join(own, 'RUNTIME-SEAL.json'));
const check = (filename, expected) => {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), filename);
  assert.equal(stat.mode & 0o777, expected.mode, filename);
  assert.equal(stat.size, expected.bytes, filename);
  assert.equal(hash(read(filename)), expected.sha256, filename);
};
let checkedBindings = 0;
for (const directory of [prior, own]) for (const [name, expected] of Object.entries(json(path.join(directory, 'EXECUTION-SEAL.json')).files)) {
  check(path.resolve(directory, name), expected);
  checkedBindings++;
}
assert.equal(checkedBindings, 555);
const metadata = json(path.join(own, 'METADATA.json'));
let toolFiles = 0;
let toolDirectories = 0;
for (const group of metadata.tools) {
  for (const entry of group.entries ?? [group]) {
    if (entry.type === 'directory') {
      const stat = fs.lstatSync(path.resolve(entry.path));
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
      assert.equal(stat.mode & 0o777, entry.mode);
      toolDirectories++;
    } else { check(path.resolve(entry.path), entry); toolFiles++; }
  }
  if (group.directory) {
    const names = [];
    const walk = directory => {
      for (const name of fs.readdirSync(directory)) {
        const filename = path.join(directory, name);
        names.push(path.relative(process.cwd(), filename));
        if (fs.lstatSync(filename).isDirectory()) walk(filename);
      }
    };
    walk(path.resolve(group.directory));
    assert.deepEqual(names.sort(), group.entries.map(entry => entry.path).sort());
  }
}
const statuses = ['PASS', 'FAIL', 'NOT_RUN', 'STATIC_NONCONFORMANCE', 'HARNESS_ERROR'];
const emptyCounts = () => Object.fromEntries(statuses.map(status => [status, 0]));
const total = emptyCounts();
const layouts = Object.fromEntries(['source', 'installed', 'moved'].map(layout => [layout, emptyCounts()]));
const receipts = [];
const membership = {};
const failures = [];
const tracked = new Set();
const addFile = name => {
  assert.ok(!tracked.has(name));
  tracked.add(name);
  const filename = path.join(evidence, name);
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  membership[name] = { bytes: stat.size, mode: stat.mode & 0o777, sha256: hash(read(filename)) };
};
let capturedBytes = 0;
let actualLoads = 0;
for (const [index, owner] of final.processClosure.entries()) {
  assert.equal(owner.closeObserved, true);
  assert.equal(owner.groupAbsent, true);
  assert.equal(owner.retired, true);
  assert.equal(owner.id, seal.jobs[index].id);
  const stem = `${String(index + 1).padStart(3, '0')}-${owner.id}`;
  const name = `${stem}.json`;
  addFile(name);
  const receipt = json(path.join(evidence, name));
  assert.equal(receipt.id, owner.id);
  assert.equal(receipt.pid, owner.pid);
  assert.equal(receipt.role, owner.role);
  assert.equal(receipt.fault, null);
  assert.equal(receipt.signal, null);
  assert.equal(receipt.closeObserved, true);
  assert.equal(receipt.groupAbsent, true);
  const channels = { stdout: [], stderr: [] };
  const offsets = { stdout: 0, stderr: 0 };
  const lengths = {};
  let stderrStarted = false;
  for (const reference of receipt.fragments) {
    assert.deepEqual(Object.keys(reference).sort(), ['bytes', 'name', 'sha256']);
    assert.equal(path.basename(reference.name), reference.name);
    addFile(reference.name);
    const fragment = json(path.join(evidence, reference.name));
    assert.deepEqual(Object.keys(fragment).sort(), ['base64', 'channel', 'offset', 'sha256', 'totalBytes']);
    assert.ok(fragment.channel === 'stdout' || fragment.channel === 'stderr');
    if (fragment.channel === 'stderr') stderrStarted = true;
    else assert.equal(stderrStarted, false);
    assert.ok(Number.isSafeInteger(fragment.offset) && fragment.offset >= 0);
    assert.ok(Number.isSafeInteger(fragment.totalBytes) && fragment.totalBytes > 0);
    assert.equal(fragment.offset, offsets[fragment.channel]);
    assert.equal(reference.name, `${stem}-${fragment.channel}-${fragment.offset}.json`);
    const bytes = Buffer.from(fragment.base64, 'base64');
    assert.equal(bytes.toString('base64'), fragment.base64);
    assert.ok(bytes.length > 0 && bytes.length <= 65536);
    assert.equal(bytes.length, reference.bytes);
    assert.equal(hash(bytes), reference.sha256);
    assert.equal(hash(bytes), fragment.sha256);
    if (lengths[fragment.channel] !== undefined) assert.equal(lengths[fragment.channel], fragment.totalBytes);
    lengths[fragment.channel] = fragment.totalBytes;
    offsets[fragment.channel] += bytes.length;
    channels[fragment.channel].push(bytes);
  }
  const stdout = Buffer.concat(channels.stdout);
  const stderr = Buffer.concat(channels.stderr);
  for (const [channel, bytes] of [['stdout', stdout], ['stderr', stderr]]) {
    assert.equal(bytes.length, lengths[channel] ?? 0);
    assert.equal(hash(bytes), receipt[`${channel}Sha256`]);
  }
  assert.equal(stdout.length + stderr.length, receipt.bytes);
  capturedBytes += receipt.bytes;
  receipts.push({ id: receipt.id, role: receipt.role, pid: receipt.pid, code: receipt.code, bytes: receipt.bytes, receipt: name });
  if (receipt.role === 'product') {
    const records = stdout.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
    const observed = records.at(-1);
    const product = final.product.find(product => product.id === receipt.id);
    assert.ok(product);
    assert.equal(observed.kind, 'final');
    assert.equal(observed.complete, true);
    assert.equal(observed.job, receipt.id);
    assert.equal(observed.shells, observed.disposed);
    assert.deepEqual(observed.loads, product.loads);
    assert.deepEqual(observed.counts, product.counts);
    const cases = records.filter(record => record.kind === 'case');
    assert.deepEqual(cases.map(({ raw, ...row }) => row), product.cases);
    assert.equal(new Set(cases.map(row => row.id)).size, cases.length);
    const counts = emptyCounts();
    for (const row of cases) {
      assert.ok(statuses.includes(row.status));
      counts[row.status]++;
      total[row.status]++;
      layouts[product.layout][row.status]++;
      if (row.status === 'FAIL') failures.push({ job: receipt.id, id: row.id, failures: row.failures, raw: row.raw });
    }
    assert.deepEqual(counts, observed.counts);
    for (const load of observed.loads) {
      const expected = runtime.packageInventory[load.relative] ?? runtime.harness[load.relative];
      assert.ok(expected, load.relative);
      for (const key of ['bytes', 'mode', 'sha256']) assert.equal(load[key], expected[key]);
      actualLoads++;
    }
    for (const name of ['apply', 'parser', 'matcher', 'shared', 'options', 'index']) assert.ok(observed.loads.some(load => load.relative === `dist/commands/apply-patch/${name}.js`));
  }
  if (receipt.role === 'type') {
    const result = final.types.find(result => result.id === receipt.id);
    assert.ok(result);
    assert.equal(result.actualCode, receipt.code);
    assert.equal(result.pass, receipt.code === result.expectedCode && (!result.diagnostic || stdout.toString().includes(result.diagnostic)));
  }
}
assert.equal(capturedBytes, final.capturedBytes);
assert.equal(receipts.length, final.executedJobs);
assert.deepEqual(final.notRunJobs, seal.jobs.slice(receipts.length).map(job => job.id));
addFile('work-archive.json.gz.base64');
const archiveText = read(path.join(own, final.archive.path)).toString('ascii');
const compressed = Buffer.from(archiveText.trimEnd(), 'base64');
assert.equal(compressed.toString('base64') + '\n', archiveText);
assert.equal(compressed.length, final.archive.compressedBytes);
assert.equal(hash(compressed), final.archive.sha256);
const archive = JSON.parse(gunzipSync(compressed, { maxOutputLength: 128 * 1024 * 1024 }));
assert.deepEqual(Object.keys(archive).sort(), ['files', 'inventory']);
assert.equal(Object.keys(archive.inventory).length, final.archive.entries);
assert.deepEqual(Object.keys(archive.files).sort(), Object.entries(archive.inventory).filter(([, entry]) => entry.kind === 'file').map(([name]) => name).sort());
let archivedBytes = 0;
for (const [name, entry] of Object.entries(archive.inventory)) {
  assert.ok(!path.isAbsolute(name));
  assert.ok(name.replace(/\/$/, '').split('/').every(component => component !== '' && component !== '.' && component !== '..' && component !== 'AGENTS.md'));
  assert.ok(entry.kind === 'directory' || entry.kind === 'file');
  if (entry.kind === 'file') {
    const bytes = Buffer.from(archive.files[name], 'base64');
    assert.equal(bytes.toString('base64'), archive.files[name]);
    assert.equal(bytes.length, entry.bytes);
    assert.equal(hash(bytes), entry.sha256);
    archivedBytes += bytes.length;
  }
}
const subtree = prefix => Object.fromEntries(Object.entries(archive.inventory).filter(([name]) => name.startsWith(prefix) && name !== prefix).map(([name, entry]) => [name.slice(prefix.length), entry]));
assert.deepEqual(subtree('source/'), final.sourceAfter);
assert.deepEqual(subtree('physically-moved/node_modules/virtual-bash/'), runtime.packageInventory);
assert.ok(archive.files['physically-moved/consumer-positive.mts']);
assert.equal(Object.keys(archive.inventory).some(name => name.startsWith('installed/')), false);
assert.equal(final.cleanup.knownChildrenRetired, true);
assert.equal(final.cleanup.ownedRootRemoved, true);
assert.equal(fs.existsSync(path.join(own, '.work-v2')), false);
const actualNames = fs.readdirSync(evidence, { encoding: 'buffer' }).map(name => name.toString('hex')).sort();
const expectedNames = [...tracked].map(name => Buffer.from(name).toString('hex')).sort();
assert.deepEqual(actualNames, expectedNames);
assert.ok(Object.values(membership).reduce((sum, entry) => sum + entry.bytes, 0) < 128 * 1024 * 1024);
const captureManifest = { schema: 'actual-review-capture-membership-v1', files: membership };
const manifestBytes = Buffer.from(JSON.stringify(captureManifest, null, 2) + '\n');
fs.writeFileSync(path.join(own, 'runs/CAPTURE-MEMBERSHIP.json'), manifestBytes, { flag: 'wx' });
const result = {
  verifiedAt: new Date().toISOString(), attemptConsumed: true, controllerExitCode: 1,
  plannedJobs: 70, executedJobs: receipts.length, notRunJobs: final.notRunJobs,
  executedByRole: Object.fromEntries(['git', 'guard', 'build', 'type', 'product'].map(role => [role, receipts.filter(receipt => receipt.role === role).length])),
  layouts, observedCaseReceipts: final.product.reduce((sum, product) => sum + product.cases.length, 0), observedCaseCounts: total,
  plannedCaseReceipts: 422, undispatchedCaseReceipts: 44,
  limits: { plannedCases: 18, pass: 0, fail: 0, unrun: 18 },
  adapters: { real: { pass: 0, fail: 0, unrun: 4 }, mockS3: { pass: 0, fail: 0, unrun: 4 }, dav: 'NOT_RUN; not a frozen planned job' },
  mutations: { sealedIntents: 6, plannedPhases: 18, dispatchedPhases: 0, killed: 0, unrun: 18 },
  types: Object.fromEntries(['source', 'installed', 'moved'].map(layout => {
    const results = final.types.filter(result => result.id.startsWith(`types-${layout}-`));
    return [layout, { pass: results.filter(result => result.pass).length, fail: results.filter(result => !result.pass).length, unrun: 5 - results.length }];
  })),
  loadObservations: { productChildren: final.product.length, records: actualLoads, recordsPerChild: final.product.map(product => ({ id: product.id, records: product.loads.length })), allMatchedRuntimeSeal: true, sixAppModulesPerChild: true, mutantLoads: 0 },
  checkedBindings, toolFiles, toolDirectories, rawCaptureBytes: capturedBytes,
  captureFiles: tracked.size, captureMembershipSha256: hash(manifestBytes),
  rawEvidenceFileBytes: Object.values(membership).reduce((sum, entry) => sum + entry.bytes, 0),
  archive: { ...final.archive, decodedFileBytes: archivedBytes, verifiedFiles: Object.keys(archive.files).length, instructionBodies: 0 },
  cleanup: final.cleanup, knownChildren: final.processClosure,
  fatalStage: 'types-moved-positive preparation, before child admission',
  fatalClassification: 'sealed controller harness collision, not a compiler or product failure',
  fatal: final.stopped,
  started: final.started, preCleanupElapsedMs: final.elapsedMs,
  finalArtifactMtimeUtc: fs.statSync(path.join(own, 'FINAL.json')).mtime.toISOString(),
  controllerLogMtimeUtc: fs.statSync(path.join(own, 'runs/controller.log')).mtime.toISOString(),
  peakOwnedProcesses: final.peakOwnedProcesses, peakWorkingBytes: final.peakWorkingBytes,
  admittedWorkingBytes: final.admittedWorkingBytes,
  finalSha256: hash(read(path.join(own, 'FINAL.json'))),
  runtimeSealSha256: hash(read(path.join(own, 'RUNTIME-SEAL.json'))),
  grantSha256: hash(read(path.join(own, 'ROOT-GO.json'))),
  receipts, failures,
  qualification: 'Post-run data verification only. No product dispatch, C18 proof rerun, replay, fixture correction, retry, unexecuted mutant kill or full acceptance inferred.',
};
fs.writeFileSync(path.join(own, 'runs/POSTRUN.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...result, knownChildren: result.knownChildren.length, receipts: result.receipts.length, failures: result.failures.map(failure => ({ job: failure.job, id: failure.id })), notRunJobs: result.notRunJobs.length }, null, 2));
