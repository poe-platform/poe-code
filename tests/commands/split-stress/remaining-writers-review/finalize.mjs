import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { dirname, join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const scope = dirname(fileURLToPath(import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = async path => JSON.parse(await fs.readFile(path, 'utf8'));
function patch(text) {
  const result = spawnSync('apply_patch', [], { cwd: root, input: `*** Begin Patch\n${text}*** End Patch\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
}
function publish(name, data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n';
  patch(`*** Add File: ${join(scope, name)}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n`);
}
async function witness(path) {
  const stat = await fs.lstat(path);
  if (stat.isDirectory()) return { directory: true, mode: stat.mode & 0o7777 };
  return { mode: stat.mode & 0o7777, sha256: hash(stat.isSymbolicLink() ? await fs.readlink(path) : await fs.readFile(path)), ...(stat.isSymbolicLink() ? { link: await fs.readlink(path) } : { size: stat.size }) };
}
async function tree(directory) {
  const entries = {};
  async function visit(path) {
    const entry = await witness(path);
    entries[relative(directory, path)] = entry;
    if (entry.directory) for (const child of (await fs.readdir(path)).sort()) await visit(join(path, child));
  }
  await visit(directory);
  return entries;
}
await assert.rejects(fs.access(join(scope, 'summary.json')), { code: 'ENOENT' });
const freeze = await parse(join(scope, 'attempt-03/freeze.json'));
const result = await parse(join(scope, 'attempt-03/results.json'));
assert.equal(result.complete, true);
const summary = { candidate: result.candidate, parent: freeze.parent, finalAttempt: 'attempt-03', started: result.started, finished: result.finished, node: freeze.node, platform: freeze.platform, arch: freeze.arch, native: freeze.native, rows: [], checks: [], limitations: [] };
for (const run of result.runs) {
  summary.rows.push({ mode: run.mode, code: run.code, signal: run.signal, counts: run.counts, audit: run.audit, capturedReports: run.captures.length, publishedReports: run.publishedReports.length, retainedScratch: run.retainedScratch, childRuns: run.childRuns });
}
summary.guards = result.guards;
summary.rendezvous = result.rendezvous;
summary.authentication = { candidateEntries: freeze.entries.length, goldens: freeze.entries.filter(entry => entry.path.startsWith('tests/commands/split/evidence/')).length, archiveUnchangedIncludingNewEntries: result.archiveUnchangedIncludingNewEntries, liveSplitUnchangedIncludingNewEntries: result.liveSplitUnchangedIncludingNewEntries, nativeUnchanged: result.nativeUnchanged, liveTrackedChanges: result.liveTrackedChanges };
const capture = result.runs.find(run => run.mode === 'canonical-capture');
const reports = Object.fromEntries(capture.captures.map(entry => [basename(entry.path, '.json'), JSON.parse(Buffer.from(entry.base64, 'base64'))]));
assert.equal(reports.edge.evidence.length, 18);
assert.equal(reports.stress.report.length, 8);
assert.equal(reports.stress.report.reduce((sum, row) => sum + row.variants.length, 0), 16);
assert.equal(reports['dangling-native'].report.length, 11);
assert.equal(reports['dangling-native'].report.reduce((sum, row) => sum + row.observed.length, 0), 22);
assert.equal(reports['gnu9.7-darwin'].cohort.length, 43);
assert.equal(reports['apple-bsd'].cohort.length, 20);
assert.equal(reports['gnu-errors'].report.length, 9);
assert.equal(reports['native-profile-differences'].length, 4);
summary.vectorCounts = { gnu: 43, apple: 20, errors: 9, crossProfile: 4, edge: 18, stressInputsAndArguments: 8, stressChunkVariants: 16, danglingFixtures: 11, danglingVfsObservations: 22, nativeProcessesPerCanonicalMode: 128 };
for (const name of ['edge', 'stress']) {
  const current = capture.captures.find(entry => basename(entry.path) === `${name}.json`);
  const prior = await fs.readFile(join(freeze.copy, `tests/commands/split/evidence/${name}-latest.json`));
  assert.deepEqual(Buffer.from(current.base64, 'base64'), prior);
  summary.checks.push({ check: `${name}-raw-bytes-identical-to-committed-golden`, pass: true, sha256: hash(prior) });
}
for (const entry of capture.captures) {
  assert.equal(entry.mode, 0o600);
  assert.equal(entry.directory.mode, 0o700);
}
const helper = result.runs.find(run => run.mode === 'helper');
const negativeTaps = [2, 3].map(index => join(scope, `attempt-03/helper-child-${index}.tap`));
const failureReports = [];
for (const [index, path] of negativeTaps.entries()) {
  const text = await fs.readFile(path, 'utf8');
  const extracted = index === 0
    ? [...text.matchAll(/^# split native failure ([\w.-]+) \(base64\): (.+)$/gm)].map(match => ({ name: match[1], report: JSON.parse(Buffer.from(match[2], 'base64')) }))
    : [...text.matchAll(/^# split native capture: (.+)$/gm)].map(match => {
      const publication = helper.publishedReports.find(entry => entry.path === match[1]);
      assert.ok(publication, 'published failure JSON must survive helper cleanup');
      return { name: basename(match[1], '.json'), report: JSON.parse(Buffer.from(publication.base64, 'base64')) };
    });
  assert.equal(extracted.length, index === 0 ? 6 : 7);
  const byName = Object.fromEntries(extracted.map(entry => [entry.name, entry.report]));
  assert.equal(byName.edge.evidence.length, 18);
  assert.equal(byName.edge.evidence.filter(row => !row.semanticMatch).length, 1);
  assert.equal(byName.edge.evidence[0].observed.status, byName.edge.evidence[0].expected.status + 1);
  assert.equal(byName.stress.report.length, 8);
  assert.equal(byName.stress.report.flatMap(row => row.variants).filter(row => !row.match).length, 1);
  assert.equal(byName['dangling-native'].report.length, 11);
  assert.equal(byName['dangling-native'].failures.length, 1);
  assert.equal(byName['dangling-native'].report.flatMap(row => row.observed).filter(row => !row.match).length, 1);
  for (const [name, rows] of [['gnu9.7-darwin', 43], ['apple-bsd', 20]]) {
    assert.equal(byName[name].cohort.length, rows);
    assert.equal(byName[name].cohort.filter(row => !row.match).length, 1);
  }
  assert.equal(byName['gnu-errors'].report.length, 9);
  assert.equal(byName['gnu-errors'].report.filter(row => !row.semanticMatch).length, 1);
  failureReports.push({ capture: index === 1, reports: extracted.map(entry => ({ name: entry.name, sha256: hash(JSON.stringify(entry.report)) })), expectedFailingTests: 6, genuineCanonicalFailures: 0 });
}
summary.failureReports = failureReports;
summary.checks.push({ check: 'failure-reports-survive-cleanup-with-exact-cohorts-and-one-injected-observed-status-mismatch-per-failing-test', pass: true });
summary.limitations = [
  'Node API interception is verified for these inspected tests, not kernel-wide tracing or a security sandbox against hostile native code.',
  'Native binaries remain pinned, with argv/cwd/environment and timeout recorded; no native oracle replacement or timeout increase was used.',
  'Report-directory identity is checked before exclusive create, not a transactional race/ABA guarantee.',
  'Direct assertion exceptions retain TAP but can precede aggregate report publication.',
  'Helper negative children deliberately alter observed status in their own generated sandbox test copies; frozen candidate files remain byte-identical.',
  'Repeated modes and reporting controls are not new semantic coverage; frozen8670 remains UNQUALIFIED; no full gate, superiority, completion or duration claim.',
];
publish('summary.json', summary);
const cleanup = [];
for (const prefix of ['', 'attempt-02/', 'attempt-03/']) {
  const attemptFreeze = await parse(join(scope, prefix, 'freeze.json'));
  const attemptResults = await parse(join(scope, prefix, 'results.json'));
  assert.equal(attemptFreeze.candidate, result.candidate);
  assert.equal(await fs.realpath(attemptFreeze.temporary), attemptFreeze.temporary);
  assert.match(basename(attemptFreeze.temporary), /^virtual-bash-split-remaining-review-[A-Za-z0-9]+$/);
  assert.deepEqual(await tree(attemptFreeze.copy), attemptFreeze.before);
  assert.deepEqual((await fs.readdir(attemptFreeze.temporary)).sort(), attemptResults.knownTopLevelChildren);
  for (const run of attemptResults.runs) assert.throws(() => process.kill(run.pid, 0), { code: 'ESRCH' });
  for (const native of attemptFreeze.native) assert.equal((await witness(native.path)).sha256, native.pin);
  const snapshot = await tree(attemptFreeze.temporary);
  publish(`${prefix}temporary-before-cleanup.json`, snapshot);
  for (const name of attemptResults.knownTopLevelChildren) {
    assert.equal(basename(name), name);
    await fs.rm(join(attemptFreeze.temporary, name), { recursive: true, force: false });
  }
  assert.deepEqual(await fs.readdir(attemptFreeze.temporary), []);
  await fs.rmdir(attemptFreeze.temporary);
  cleanup.push({ attempt: prefix || 'attempt-01', temporary: attemptFreeze.temporary, exactKnownChildren: attemptResults.knownTopLevelChildren, archiveAuthenticatedImmediatelyBeforeRemoval: true, topLevelPidsGone: true, removed: true });
}
publish('cleanup.json', cleanup);
const packed = [];
async function pack(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await pack(path); continue; }
    if (!/\.(json|tap)$/.test(path) || (await fs.stat(path)).size < 1024 * 1024) continue;
    const bytes = await fs.readFile(path);
    const compressed = gzipSync(bytes, { level: 9 });
    const encoded = compressed.toString('base64').match(/.{1,120}/g).join('\n') + '\n';
    const destination = `${path}.gz.base64`;
    patch(`*** Add File: ${destination}\n${encoded.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n`);
    const restored = gunzipSync(Buffer.from(await fs.readFile(destination, 'utf8'), 'base64'));
    assert.deepEqual(restored, bytes);
    packed.push({ original: relative(scope, path), archived: relative(scope, destination), originalBytes: bytes.length, originalSha256: hash(bytes), compressedBytes: compressed.length, compressedSha256: hash(compressed), encoding: 'gzip+base64', byteExactRoundTrip: true });
    patch(`*** Delete File: ${path}\n`);
  }
}
await pack(scope);
publish('PACKING.json', { entries: packed, note: 'Lossless storage only; every original byte and SHA256 retained and round-tripped before removal of redundant raw files. This includes verifier failures. No oracle/canonical test recapture occurred.' });
const liveChanges = [];
for (const [path, expected] of Object.entries(freeze.liveBefore.tracked)) if (JSON.stringify(await witness(join(root, path))) !== JSON.stringify(expected)) liveChanges.push(path);
assert.deepEqual(await tree(join(root, 'tests/commands/split')), freeze.liveBefore.splitTree);
publish('final-authentication.json', { at: new Date().toISOString(), splitTreeUnchangedIncludingNewEntries: true, liveTrackedChanges: liveChanges, native: await Promise.all(freeze.native.map(async entry => ({ ...entry, final: await witness(entry.path) }))), cleanupRoots: cleanup.length, packedFiles: packed.length });
console.log(JSON.stringify({ candidate: result.candidate, complete: true, guardChecks: summary.guards.length, cleanupRoots: cleanup.length, packedFiles: packed.length, liveChanges }, null, 2));
