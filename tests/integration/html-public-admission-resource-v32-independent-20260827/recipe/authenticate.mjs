import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, lstatSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const owned = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const repository = resolve(owned, '../../..');
export const author = 'tests/integration/html-public-independent-20260827/admission-v3.2';
export const freeze = 'e27a62c40a317deae83fc1ef9d41d57f38d7d51d';
export const manifestSha = '968c52402f4c10507fb7c5410b33086bba33e7209b7030b42e7859b4c85c1980';
export const evidenceCommit = '2bfeb0e12e342c34cd163f2453c9edd8d0190630';
export const evidenceSha = '3c46668c88d0f01081020c19a93f761fe4b90e780e30406b75df0e4ccc858d3d';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const fileHash = path => hash(readFileSync(path));
export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
export const git = args => execFileSync('/usr/bin/git', ['--no-replace-objects', '-C', repository, ...args], { env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', HOME: owned, TMPDIR: owned }, maxBuffer: 4 * 1024 ** 2, timeout: 10000 });
export function inventory(root) {
  const files = {}, directories = [];
  function visit(relative) {
    for (const name of readdirSync(join(root, relative)).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      const stat = lstatSync(join(root, path));
      assert.equal(stat.isSymbolicLink(), false, path);
      if (stat.isDirectory()) { directories.push(path); visit(path); }
      else { assert.ok(stat.isFile(), path); files[path] = { sha256: fileHash(join(root, path)), bytes: stat.size }; }
    }
  }
  visit('');
  return { files, directories };
}
export async function authenticate() {
  const started = new Date().toISOString();
  for (const [commit, path, expected] of [[freeze, `${author}/recipe/MANIFEST.json`, manifestSha], [evidenceCommit, `${author}/MANIFEST.json`, evidenceSha]]) {
    assert.equal(hash(git(['show', `${commit}:${path}`])), expected);
    assert.equal(fileHash(join(repository, path)), expected);
  }
  const evidence = readJson(join(repository, author, 'MANIFEST.json'));
  const current = inventory(join(repository, author));
  assert.deepEqual(Object.keys(current.files).sort(), [...Object.keys(evidence.files), 'MANIFEST.json'].sort());
  assert.deepEqual(current.directories, evidence.directories);
  const committedPaths = git(['ls-tree', '-r', '--name-only', evidenceCommit, '--', author]).toString().trim().split('\n').map(path => path.slice(author.length + 1));
  assert.deepEqual(committedPaths.sort(), Object.keys(current.files).sort());
  for (const [path, identity] of Object.entries(evidence.files)) {
    assert.deepEqual(current.files[path], identity, path);
    assert.equal(hash(git(['show', `${evidenceCommit}:${author}/${path}`])), identity.sha256, path);
  }
  assert.equal(Object.keys(current.files).length, 176);
  const { intactBindings } = await import('../../html-public-independent-20260827/admission-v3.2/recipe/bindings.mjs');
  const authentication = intactBindings(freeze, manifestSha);
  const pin = readJson(join(repository, author, 'recipe/PIN.json'));
  const amendment = readJson(join(repository, author, 'recipe/AMENDMENT.json'));
  const priorRoot = 'tests/integration/html-public-independent-20260827/admission-v3.1';
  const prior = inventory(join(repository, priorRoot));
  assert.deepEqual(Object.keys(prior.files).sort(), pin.previousEvidence.files.map(row => row.path.slice(priorRoot.length + 1)).sort());
  assert.equal(pin.previousEvidence.files.length, 78);
  for (const row of pin.previousEvidence.files) {
    assert.equal(fileHash(join(repository, row.path)), row.sha256);
    assert.equal(hash(git(['show', `${pin.previousEvidence.commit}:${row.path}`])), row.sha256);
  }
  const base = `${priorRoot}/recipe`;
  for (const source of amendment.sources) {
    assert.equal(hash(git(['show', `${amendment.baseRecipeCommit}:${base}/${source.name}`])), source.baseSha256);
    assert.equal(fileHash(join(repository, author, 'recipe', source.name)), source.patchedSha256);
    assert.equal(source.byteIdentical, source.baseSha256 === source.patchedSha256);
  }
  for (const source of amendment.newRuntimeFiles) assert.equal(fileHash(join(repository, author, 'recipe', source.name)), source.sha256);
  const oldPin = JSON.parse(git(['show', `${amendment.baseRecipeCommit}:${base}/PIN.json`]));
  assert.deepEqual(pin.policy, oldPin.policy);
  assert.deepEqual(pin.policy, amendment.policy);
  assert.deepEqual(pin.tools, oldPin.tools);
  assert.equal(fileHash(join(repository, author, 'recipe/core.mjs')), '446c14f2e12753b8933aa307f7ce8b0dec90dd251bbd613e64a484c26397340d');
  const tools = { ...pin.tools };
  tools.tar = { path: '/usr/bin/tar', realpath: realpathSync('/usr/bin/tar'), sha256: fileHash('/usr/bin/tar'), lstatSymlink: lstatSync('/usr/bin/tar').isSymbolicLink() };
  const savedSummary = readJson(join(repository, author, 'execution-01/SUMMARY.json'));
  const readonly = readJson(join(repository, author, 'READ-ONLY-VALIDATION.json'));
  const forwarding = readJson(join(repository, author, 'execution-01/forwarding-controls/SUMMARY.json'));
  assert.equal(readonly.checks.length, 33);
  assert.equal(forwarding.actual.length, 6);
  assert.equal(forwarding.predicates.length, 8);
  assert.equal(evidence.originalSynthetic.executed, 28);
  assert.equal(savedSummary.controlsExecuted, 5);
  assert.equal(git(['rev-parse', 'aff899aa94ed0c57a936b08fd36d185688f5c0bb^{commit}']).toString().trim(), 'aff899aa94ed0c57a936b08fd36d185688f5c0bb');
  return { started, finished: new Date().toISOString(), protectedFiles: 176, priorFiles: 78, exactFileAndDirectoryInventories: true, appendDetectionScope: 'author v3.2 and v3.1 only; not whole repository', authentication, amendment, tools, authorClaimsStaticOnly: { realCases: savedSummary.controlsExecuted, expected: savedSummary.expectedOutcomes, unexpected: savedSummary.unexpectedFailures, originalSynthetic: evidence.originalSynthetic, forwardingCohorts: forwarding.actual.length, orderedPredicates: forwarding.predicates.length, readonlyChecks: readonly.checks.length }, candidateExecuted: false };
}
