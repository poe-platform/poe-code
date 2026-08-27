import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const candidate = '8670ebe8f0d39966c2de2638780437398e5f8490';
const admissionCommit = '98843c59';
const refusalCommit = '86c63b39';
const owner = 'tests/integration/full-gate-20260827/combined-8670ebe8';
const output = resolve(process.argv[2] ?? ''); assert.ok(process.argv[2]); assert.equal(existsSync(output), false);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repository, timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
const show = (revision, path) => git('show', `${revision}:${path}`);
const inputs = [];
const captured = (revision, path) => { const bytes = show(revision, path); inputs.push({ revision: git('rev-parse', revision).toString().trim(), path, bytes: bytes.length, sha256: hash(bytes) }); return bytes; };
const profile = JSON.parse(captured(admissionCommit, `${owner}/policy.json`));
const cleanup = JSON.parse(captured(admissionCommit, `${owner}/cleanup-expected.json`));
const receipt = JSON.parse(captured(admissionCommit, `${owner}/CANDIDATE.json`));
const authorControls = JSON.parse(captured(admissionCommit, `${owner}/preparation-controls.json`));
for (const path of ['run.mjs', 'controls.mjs', 'import-guard.mjs', 'README.md']) captured(admissionCommit, `${owner}/${path}`);
const helper = captured(admissionCommit, 'tests/integration/full-gate-20260827/preflight-repair/preflight.mjs');
const helperPolicy = captured(admissionCommit, 'tests/integration/full-gate-20260827/preflight-repair/policy.json');
const refusal = JSON.parse(captured(refusalCommit, `${owner}/refused-launch-01.json`));
const tree = git('rev-parse', `${candidate}^{tree}`).toString().trim();
assert.equal(profile.candidate, candidate); assert.equal(profile.candidateTree, tree); assert.equal(receipt.candidate, candidate); assert.equal(receipt.tree, tree);
assert.equal(cleanup.revision, candidate); assert.equal(cleanup.tree, tree); assert.equal(Object.keys(cleanup.files).length, 220);
assert.equal(hash(JSON.stringify(cleanup)), 'd9309d27efd2e1e418f075f4f514efeeefa833e8b3dc5e061662289f8ecd67b6');
const entries = new Map(git('ls-tree', '-r', '-z', candidate).toString().split('\0').filter(Boolean).map(record => {
  const separator = record.indexOf('\t'), [mode, type, blob] = record.slice(0, separator).split(' '); return [record.slice(separator + 1), { mode, type, blob }];
}));
for (const entry of profile.scopeInputs) { assert.equal(entries.get(entry.path)?.blob, entry.blob); assert.equal(entries.get(entry.path)?.mode, entry.mode); }
assert.equal(profile.scopeInputs.length, 3246);
const canonical = [...entries.keys()].filter(path => /^tests\/.*\.test\.ts$/u.test(path) && !path.startsWith('tests/commands/regex-execution/continuation/artifacts/native/')).sort();
assert.deepEqual(canonical, profile.canonicalFiles); assert.equal(canonical.length, 560);
const paths = Object.keys(cleanup.files), requests = paths.map(path => `${candidate}:${path}\n`).join('');
const blobs = execFileSync('git', ['--no-replace-objects', 'cat-file', '--batch'], { cwd: repository, input: requests, timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
let offset = 0;
for (const path of paths) {
  const end = blobs.indexOf(10, offset); assert.ok(end >= 0);
  const [blob, type, size] = blobs.subarray(offset, end).toString().split(' '), length = Number(size);
  assert.equal(type, 'blob'); assert.ok(Number.isSafeInteger(length)); assert.equal(blob, entries.get(path)?.blob);
  const bytes = blobs.subarray(end + 1, end + 1 + length); assert.equal(bytes.length, length); assert.equal(hash(bytes), cleanup.files[path], path);
  offset = end + 2 + length;
}
assert.equal(offset, blobs.length);
assert.equal(authorControls.controls.length, 11); assert.equal(authorControls.wholeGateLaunched, false);
assert.equal(refusal.candidate, candidate); assert.equal(refusal.exitStatus, 78); assert.equal(refusal.archiveBuildSuiteExecuted, false); assert.equal(refusal.outputCreated, false); assert.equal(hash(refusal.raw), refusal.rawSha256);
const originalRefusal = JSON.parse(refusal.raw).preflight;
assert.deepEqual(originalRefusal.issues, [{ kind: 'dirty-tracked-inputs', records: [' M src/commands/search/rg.ts'] }]);
const temporary = mkdtempSync(join(tmpdir(), 'safe-bash-archive-admission-prep-'));
const report = { preparedAt: new Date().toISOString(), candidate, tree, admissionCommit: git('rev-parse', admissionCommit).toString().trim(), refusalCommit: git('rev-parse', refusalCommit).toString().trim(), inputs, candidateInputs: { scope: profile.scopeInputs.length, canonical: canonical.length, cleanup: paths.length, cleanupCompactSha256: hash(JSON.stringify(cleanup)) }, originalControls: { count: authorControls.controls.length, names: authorControls.controls, qualification: 'authenticated historical preparation, not a new execution' }, originalRefusal: { status: refusal.exitStatus, issues: originalRefusal.issues, rawSha256: refusal.rawSha256, archiveBuildSuiteExecuted: false }, newArchiveModeReviewed: false, suiteLaunched: false, compilerRuns: 0, nativeProgramsExecuted: 0, sourceArchiveExtracted: false };
try {
  writeFileSync(join(temporary, 'preflight.mjs'), helper); writeFileSync(join(temporary, 'policy.json'), helperPolicy);
  const { assessRepository } = await import(pathToFileURL(join(temporary, 'preflight.mjs')));
  const environment = { ...process.env, TREE_NATIVE_BIN: '/tmp/safe-bash-tree-external-oracle-TbVJVK/tree' };
  const current = assessRepository({ repository, candidate, profile, environment });
  assert.equal(current.native.assets.length, 49); assert.deepEqual(current.native.issues, []); assert.equal(current.suiteLaunched, false);
  report.existingStrictGuard = { status: current.status, issues: current.issues, authenticatedNativeAssets: current.native.assets.length, qualification: 'existing strict guard; live status metadata read only, no live source copied or modified' };
  report.readiness = 'pending explicit archive-mode source/evidence/flag handoff';
} finally {
  rmSync(temporary, { recursive: true, force: true }); report.cleaned = !existsSync(temporary);
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ candidate, inputs: report.candidateInputs, strict: report.existingStrictGuard, newArchiveModeReviewed: false, suiteLaunched: false, cleaned: report.cleaned, output }, null, 2));
