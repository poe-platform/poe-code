import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const reviewDirectory = path.dirname(fileURLToPath(import.meta.url));
const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: reviewDirectory }).toString().trim();
const review = path.relative(repository, reviewDirectory);
const stage = path.dirname(review);
const phase = path.dirname(stage);
const git = (...args) => execFileSync('git', args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const objectId = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
const read = (relative) => fs.readFileSync(path.join(repository, relative));
const json = (relative) => JSON.parse(read(relative));
const inputs = json(`${review}/INPUTS.json`);
const preseal = process.argv.includes('--preseal');
const committedIndex = process.argv.indexOf('--committed');
const committed = committedIndex < 0 ? undefined : process.argv[committedIndex + 1];
assert(!preseal || committedIndex < 0, 'preseal cannot assert committed membership');
assert(committedIndex < 0 || committed, 'missing committed freeze reference');
assert.deepEqual(process.argv.slice(2), preseal ? ['--preseal'] : committed ? ['--committed', committed] : []);

function tree(commit, root) {
  const result = new Map();
  for (const record of git('ls-tree', '-r', '-t', '-z', commit, '--', root).toString().split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const [mode, type, oid] = record.slice(0, tab).split(' ');
    const name = record.slice(tab + 1);
    if (name === root || type === 'tree' && root.startsWith(`${name}/`)) continue;
    assert(name.startsWith(`${root}/`));
    assert(['tree', 'blob'].includes(type), `unsupported committed entry ${name}`);
    result.set(name.slice(root.length + 1), { mode, type, oid });
  }
  return result;
}

function inventory(root, excluded = () => false) {
  const result = new Map();
  function visit(relative) {
    for (const name of fs.readdirSync(path.join(repository, root, relative)).sort()) {
      const entry = relative ? `${relative}/${name}` : name;
      if (excluded(entry)) continue;
      const absolute = path.join(repository, root, entry);
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) {
        result.set(entry, { mode: '040000', type: 'tree' });
        visit(entry);
      } else {
        assert(stat.isFile() || stat.isSymbolicLink(), `unsupported live entry ${entry}`);
        const bytes = stat.isSymbolicLink() ? Buffer.from(fs.readlinkSync(absolute)) : fs.readFileSync(absolute);
        result.set(entry, { mode: stat.isSymbolicLink() ? '120000' : stat.mode & 0o111 ? '100755' : '100644', type: 'blob', oid: objectId('blob', bytes), sha256: hash(bytes), bytes: bytes.length });
      }
    }
  }
  visit('');
  return result;
}

function authenticateTree(commit, root, excluded = () => false) {
  const expected = new Map([...tree(commit, root)].filter(([name]) => !excluded(name)));
  const actual = inventory(root, excluded);
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort(), `membership drift ${root}`);
  for (const [name, value] of expected) {
    const found = actual.get(name);
    assert.equal(found.type, value.type, name);
    assert.equal(found.mode, value.mode, name);
    if (value.type === 'blob') assert.equal(found.oid, value.oid, `bytes drift ${root}/${name}`);
  }
  return { entries: actual.size, files: [...actual.values()].filter(value => value.type === 'blob').length, detectsNewEntries: true };
}

const phaseResult = authenticateTree(inputs.commits.phase1Review.commit, phase, name => name === 'stage2' || name.startsWith('stage2/'));
const policyFiles = ['POLICY-v2.md', 'policy-invariants-v2.json', 'policy-v2-manifest.json'];
const stageResult = authenticateTree(inputs.commits.evidence.commit, stage, name => policyFiles.includes(name) || name === 'review-618d8967' || name.startsWith('review-618d8967/'));
assert.deepEqual([phaseResult.files, phaseResult.entries, stageResult.files, stageResult.entries], [179, 182, 23, 25]);

for (const document of inputs.documents) {
  const bytes = read(document.path);
  assert.equal(bytes.length, document.bytes, document.path);
  assert.equal(hash(bytes), document.sha256, document.path);
  assert(bytes.equals(git('show', `${document.commit}:${document.path}`)), `document commit drift ${document.path}`);
}
const originalFreeze = json(`${stage}/freeze-manifest.json`);
for (const [name, value] of Object.entries(originalFreeze.files)) {
  const bytes = read(`${stage}/${name}`);
  assert.equal(hash(bytes), value.sha256, name);
  assert.equal(bytes.length, value.bytes, name);
  assert(bytes.equals(git('show', `${inputs.commits.freeze.commit}:${stage}/${name}`)), `original freeze drift ${name}`);
}
const policy = json(`${stage}/policy-v2-manifest.json`);
assert.deepEqual(policy.appendAllowlistRelativeToStage2, policyFiles);
assert.equal(hash(read(`${stage}/freeze-manifest.json`)), policy.priorSeals.stage2.freezeManifestSHA256);
assert.equal(hash(read(`${stage}/evidence-manifest.json`)), policy.priorSeals.stage2.sha256);
assert.equal(hash(read(`${phase}/review-manifest.json`)), policy.priorSeals.phase1.sha256);
for (const [name, value] of Object.entries(policy.documents)) assert.equal(hash(read(`${stage}/${name}`)), value.sha256);

const rawCandidate = Buffer.from(inputs.commits.candidate.rawCommitBody);
assert.equal(objectId('commit', rawCandidate), inputs.commits.candidate.commit);
assert.equal(hash(rawCandidate), inputs.commits.candidate.rawCommitSHA256);
assert(rawCandidate.equals(git('cat-file', 'commit', inputs.commits.candidate.commit)));
const baseline = json('tests/shell/getopts/runtime/baseline.json');
assert.equal(Object.keys(baseline.protectedPaths).length, 243);
const protectedTrees = ['candidate', 'author'].map(key => new Map(git('ls-tree', '-r', '-z', inputs.commits[key].commit, '--', ...Object.keys(baseline.protectedPaths)).toString().split('\0').filter(Boolean).map(record => {
  const tab = record.indexOf('\t');
  const [mode, type, oid] = record.slice(0, tab).split(' ');
  assert.equal(type, 'blob');
  return [record.slice(tab + 1), { mode, oid }];
})));
for (const expected of protectedTrees) assert.equal(expected.size, 243);
for (const [name, expected] of Object.entries(baseline.protectedPaths)) {
  const bytes = read(name);
  assert.equal(hash(bytes), expected, `protected live drift ${name}`);
  for (const committedTree of protectedTrees) assert.equal(objectId('blob', bytes), committedTree.get(name).oid, `protected committed drift ${name}`);
}

const overlay = json(`${review}/native-corrections-v1.json`);
assert.deepEqual(overlay.corrections.map(value => value.id), ['N05', 'N13']);
assert.deepEqual(overlay.originalCounts, { bash53: '14/16', bash32: '9/16', hostDefinitions: 12, hostExecutionsAtOriginalFreeze: 0 });
const approvedChanges = {
  N05: { from: 'repeated-local|0|b|1|||1\n', to: 'repeated-local|0|a|1|||1\n' },
  N13: { from: 'no-argument|0|b|4|||1\n', to: 'no-argument|0|b|4|x|old|1\n' },
};
for (const correction of overlay.corrections) {
  assert.deepEqual(correction.replaceExactlyOnce, approvedChanges[correction.id]);
  assert.deepEqual(correction.originalFrozenControl, originalFreeze.scripts.find(value => value.id === correction.id));
  const expected = correction.originalSelectedExpectation;
  assert.equal(expected.stdout.split(correction.replaceExactlyOnce.from).length, 2);
  assert.deepEqual(correction.correctedSelectedNativeExpectation, { ...expected, stdout: expected.stdout.replace(correction.replaceExactlyOnce.from, correction.replaceExactlyOnce.to) });
  for (const profile of ['bash53', 'bash32']) {
    const capture = json(`${stage}/capture-01/${profile}.json`);
    const row = capture.results.find(value => value.id === correction.id);
    const observation = correction.preservedNativeObservations[profile];
    assert.deepEqual(expected, row.expected);
    assert.equal(observation.productStdout, row.productStdout);
    assert.equal(observation.rawStderr, row.execution.stderr);
    assert.equal(observation.processStatus, row.execution.status);
    assert.equal(row.selectedProfileExpectationMatched, false);
    if (profile === 'bash53') assert.equal(correction.correctedSelectedNativeExpectation.stdout, row.productStdout);
  }
}

const owned = inventory(review);
const authored = ['FREEZE.md', 'INPUTS.json', 'REVIEW-PROCEDURE.md', 'native-corrections-v1.json', 'verify-freeze.mjs'];
if (preseal) assert.deepEqual([...owned.keys()].sort(), authored.sort());
else {
  const manifest = json(`${review}/freeze-manifest.json`);
  assert.deepEqual([...owned.keys()].sort(), [...Object.keys(manifest.files), 'freeze-manifest.json'].sort());
  assert.deepEqual(Object.keys(manifest.files).sort(), [...authored, 'VALIDATION.json'].sort());
  for (const [name, value] of Object.entries(manifest.files)) {
    const found = owned.get(name);
    assert.equal(found.type, 'blob');
    assert.equal(found.mode, '100644');
    assert.equal(found.sha256, value.sha256, name);
    assert.equal(found.bytes, value.bytes, name);
  }
}
if (committed) authenticateTree(committed, review);
console.log(JSON.stringify({ format: 'independent-getopts-freeze-validation-v1', checkedAt: new Date().toISOString(), mode: preseal ? 'preseal' : committed ? 'committed' : 'sealed', freezeCommit: committed ?? null, phase1: phaseResult, stage2: stageResult, documents: inputs.documents.length, originalFreezeFiles: Object.keys(originalFreeze.files).length, policyFiles: policyFiles.length, protectedLiveHashes: 243, correctedNativeRecords: 4, ownedEntries: owned.size, candidateCommitBodyAuthenticated: true, candidateImplementationInspected: false, candidateExecutions: 0, nativeExecutions: 0, oldVerifiersExecuted: false, privateAccess: false, interpretation: 'Metadata, recorded native corrections and content/membership integrity only; not candidate acceptance.' }, null, 2));
