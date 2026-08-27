import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory } from './integrity.mjs';
import { addEvidence, git, json, owned, sha256, verifyFrozen } from './replay/review.mjs';

const read = path => JSON.parse(readFileSync(`${owned}/${path}`));
const parent = owned.replace(/\/replay$/, '');
const mode = process.argv[2] ?? 'verify';
assert(['seal', 'verify', 'capture-verification'].includes(mode));
const exclusions = ['replay/evidence-files.json', 'replay/verification.json'];
if (mode === 'seal') {
  addEvidence(`${owned}/evidence-files.json`, { classification: 'Review evidence only; excludes this manifest and its verification receipt to avoid self-reference', exclusions, files: inventory(parent).filter(entry => !exclusions.includes(entry.path)) });
  process.exit(0);
}
const manifest = read('evidence-files.json');
assert.deepEqual(inventory(parent).filter(entry => !exclusions.includes(entry.path)), manifest.files);
verifyFrozen();
const before = read('before.json');
assert.deepEqual(inventory('tests/commands/expr-stress/diagnostics-review'), before.preparationFiles);
const summary = read('summary.json');
assert.equal(summary.candidate, '21220b465537bf45ffcfb36740956a69f43bf75e');
assert.deepEqual(summary.independent, { nineStrict: 9, nineTotal: 9, independentStrict: 25, independentTotal: 26, runtimePassed: 11, runtimeTotal: 12, workers: 0 });
assert.deepEqual(summary.core, { count: 146, failed: [] });
for (const [index, tests, pass, fail] of [[0, 276, 276, 0], [1, 71, 71, 0], [2, 241, 235, 6], [3, 241, 239, 2]]) {
  const counts = summary.regressions[index].counts;
  assert.deepEqual(counts, { tests, suites: 0, pass, fail, cancelled: 0, skipped: 0, todo: 0 });
}
for (const label of ['candidate-diagnostics', 'baseline-8f19a9d5']) {
  const final = read(`final-inventory-${label}.json`);
  assert.deepEqual(final.sourceTests, read(`${label}/source-tests-before.json`).files);
  assert.deepEqual(final.installedFiles, read(`${label}/stage.json`).installedFiles);
  const expected = git('ls-tree', '-r', '-z', final.commit, '--', 'src', 'tests').toString().split('\0').filter(Boolean).map(line => {
    const separator = line.indexOf('\t');
    const [mode, , gitBlob] = line.slice(0, separator).split(' ');
    return { path: line.slice(separator + 1), kind: mode === '120000' ? 'symlink' : 'file', gitBlob };
  }).sort((left, right) => left.path.localeCompare(right.path, 'en'));
  assert.deepEqual(final.sourceTests.map(({ sha256: unused, ...entry }) => entry), expected);
  assert.equal(sha256(json(final.sourceTests)), final.sourceTestsDigest);
}
const originalExpr = before.authorSeal.preserved.find(entry => entry.prefix === 'tests/commands/expr');
for (const entry of originalExpr.files) {
  assert.equal(sha256(git('show', `${summary.candidate}:${entry.path}`)), entry.sha256);
  assert.equal(sha256(readFileSync(entry.path)), entry.sha256);
}
const cleanup = read('final-integrity-cleanup.json');
assert.deepEqual(cleanup.preSafetyQuiescence.ownedRelatedProcesses, []);
for (const entry of cleanup.cleanup) assert(entry.removed && !existsSync(entry.path));
const result = { verifiedAt: new Date().toISOString(), candidate: summary.candidate, evidenceFiles: manifest.files.length, manifestSha256: sha256(readFileSync(`${owned}/evidence-files.json`)), verificationHelperSha256: sha256(readFileSync(fileURLToPath(import.meta.url))), immutableGitSourceTestInventoriesVerifiedIncludingAddedEntries: true, originalExprFilesUnchanged: originalExpr.files.length, historicalPreparationUnchangedIncludingAddedEntries: true, fourOwnedRootsStillAbsent: true, noCurrentRuntimeReexecution: true };
if (mode === 'capture-verification') addEvidence(`${owned}/verification.json`, result);
console.log(json(result));
