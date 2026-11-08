import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../../..');
const controlPath = 'tests/shell/cd-prerequisite-independent-20260828';
const appendPath = `${controlPath}/ratification-v3`;
const controlSeal = 'beeda1a96bb25c846cd6df0cf0f7a0fff06bcf6e';
const policyCommit = 'ef833fd2cbf006993b1f94d7f3a0d3254e0ad3de';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 4 * 1024 * 1024 });
const blob = (commit, path) => git(['show', `${commit}:${path}`]);
const readJson = name => JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
const binding = readJson('BINDING.json');
const manifest = readJson('MANIFEST.json');

assert.equal(binding.schema, 'cd-ratification-binding/v1');
assert.equal(binding.controlSeal, controlSeal);
assert.equal(binding.policy.commit, policyCommit);
assert.equal(binding.policy.sha256, '1a88dd6c82a82803bd0c5b1aa2939f394ecb1486626bd074c7a1f6455a8fe60e');
assert.equal(binding.policy.blob, '37ecdd0c187896ab7583c3631c4d6fea262f4c29');
assert.equal(binding.behavioralAssertionsChanged, false);
assert.deepEqual(binding.counts, { originalFiles: 18, commandCases: 82, diagnosticCases: 4, positiveTypes: 10, negativeTypes: 10, invariants: 12, futureControls: 7 });

function inventory(base, excludedChild) {
  const entries = {};
  const visit = (path, relativePath) => {
    const stat = lstatSync(resolve(root, path));
    assert(!stat.isSymbolicLink(), `unexpected symlink: ${path}`);
    if (stat.isDirectory()) {
      entries[relativePath] = { kind: 'directory', mode: stat.mode & 0o777 };
      for (const name of readdirSync(resolve(root, path)).sort()) {
        if (!relativePath && name === excludedChild) continue;
        visit(`${path}/${name}`, relativePath ? `${relativePath}/${name}` : name);
      }
    } else {
      assert(stat.isFile(), `unexpected entry: ${path}`);
      const bytes = readFileSync(resolve(root, path));
      entries[relativePath] = { kind: 'file', mode: stat.mode & 0o777, bytes: bytes.length, sha256: sha256(bytes) };
    }
  };
  visit(base, '');
  return entries;
}

function authenticate(entry, commit = entry.commit) {
  const bytes = blob(commit, entry.path);
  assert.equal(git(['rev-parse', `${commit}:${entry.path}`]).toString().trim(), entry.blob, entry.path);
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(sha256(bytes), entry.sha256, entry.path);
  assert.deepEqual(readFileSync(resolve(root, entry.path)), bytes, entry.path);
}

authenticate(binding.policy);
const expectedProfiles = [
  ['882085678862a23cfeef6505fa41a03891743439', 'AUTHOR-POLICY-v2.md', 'bbc2024017c6476b2f8c43af4a1088367303c86a4d894cd3ce6e57fda6bbc9ff'],
  ['7728401ccb7bfa8f1961ffe100ca5617f3a6b553', 'AUTHOR-POLICY-v3-DETAILS.md', '5268aeafff4878926931c8ccf80cf2234134ae0d1fc594b00e44b6d157211489'],
];
assert.equal(binding.profiles.length, 2);
for (let index = 0; index < expectedProfiles.length; index++) {
  const [commit, name, hash] = expectedProfiles[index];
  const entry = binding.profiles[index];
  assert.equal(entry.commit, commit);
  assert.equal(entry.path, `tests/shell/cd-prerequisite-20260828/${name}`);
  assert.equal(entry.sha256, hash);
  for (const at of [commit, controlSeal, policyCommit]) authenticate(entry, at);
}

const controlNames = git(['ls-tree', '-r', '--name-only', controlSeal, '--', controlPath]).toString().trim().split('\n').sort();
assert.equal(controlNames.length, 18);
assert.deepEqual(controlNames, binding.originalFiles.map(entry => entry.path).sort());
const expectedControl = { '': { kind: 'directory', mode: binding.controlDirectoryMode } };
for (const entry of binding.originalFiles) {
  authenticate(entry, controlSeal);
  expectedControl[entry.path.slice(controlPath.length + 1)] = { kind: 'file', mode: entry.mode, bytes: entry.bytes, sha256: entry.sha256 };
}
assert.deepEqual(inventory(controlPath, 'ratification-v3'), expectedControl, 'original membership/bytes/modes changed outside sole authorized append');
const originalCounts = JSON.parse(blob(controlSeal, `${controlPath}/VALIDATION-v2.json`));
for (const name of ['commandCases', 'diagnosticCases', 'positiveTypes', 'negativeTypes', 'invariants']) assert.equal(originalCounts[name], binding.counts[name]);
assert.equal(originalCounts.integrationControls, binding.counts.futureControls);

assert.equal(manifest.schema, 'cd-ratification-membership/v1');
assert.deepEqual(manifest.selfExclusion, ['MANIFEST.json']);
assert.deepEqual(Object.keys(manifest.files).sort(), ['BINDING.json', 'HANDOFF.md', 'verify.mjs']);
const actualAppend = inventory(appendPath);
assert.deepEqual(Object.keys(actualAppend).sort(), ['', 'BINDING.json', 'HANDOFF.md', 'MANIFEST.json', 'verify.mjs']);
assert.deepEqual(actualAppend[''], { kind: 'directory', mode: manifest.directoryMode });
for (const [name, entry] of Object.entries(manifest.files)) assert.deepEqual(actualAppend[name], entry, name);
assert.equal(actualAppend['MANIFEST.json'].mode, 0o644);

if (process.argv.length > 2) {
  assert.equal(process.argv[2], '--commit');
  const commit = process.argv[3];
  assert.match(commit ?? '', /^[a-f0-9]{40}$/u);
  assert.equal(process.argv.length, 4);
  const expectedNames = Object.keys(actualAppend).filter(Boolean).map(name => `${appendPath}/${name}`).sort();
  const committedNames = git(['ls-tree', '-r', '--name-only', commit, '--', appendPath]).toString().trim().split('\n').sort();
  assert.deepEqual(committedNames, expectedNames);
  for (const path of expectedNames) assert.deepEqual(blob(commit, path), readFileSync(resolve(root, path)), path);
  const changes = git(['diff-tree', '--no-commit-id', '--name-status', '--no-renames', '-r', commit]).toString().trim().split('\n').sort();
  assert.deepEqual(changes, expectedNames.map(path => `A\t${path}`));
  const composedNames = git(['ls-tree', '-r', '--name-only', commit, '--', controlPath]).toString().trim().split('\n').sort();
  assert.deepEqual(composedNames, [...controlNames, ...expectedNames].sort());
  for (const path of controlNames) assert.deepEqual(blob(commit, path), blob(controlSeal, path), path);
}

assert.deepEqual(inventory(controlPath, 'ratification-v3'), expectedControl, 'original membership changed during data verification');
assert.deepEqual(inventory(appendPath), actualAppend, 'append membership changed during data verification');
console.log(JSON.stringify({ kind: 'policy-binding/data-verification-only', consistent: true, originalFilesUnchanged: 18, appendFiles: 4, behavioralAssertionsChanged: false, newCases: 0, executions: 0, typeCompilations: 0, runtimeAuthorization: false }));
