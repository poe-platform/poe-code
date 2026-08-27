import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./', import.meta.url)), repository = fileURLToPath(new URL('../../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const walk = (prefix = '') => readdirSync(join(root, prefix)).sort().flatMap(name => { const path = join(prefix, name); assert.equal(lstatSync(join(root, path)).isSymbolicLink(), false); return lstatSync(join(root, path)).isDirectory() ? walk(path) : [path]; });
const manifest = JSON.parse(readFileSync(join(root, 'MANIFEST.json')));
assert.deepEqual(walk().filter(path => path !== 'MANIFEST.json'), manifest.files.map(entry => entry.path));
for (const entry of manifest.files) { const bytes = readFileSync(join(root, entry.path)); assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256, entry.path); }
const report = JSON.parse(readFileSync(join(root, 'PREPARATION.json')));
assert.equal(report.candidate, '8670ebe8f0d39966c2de2638780437398e5f8490');
for (const input of report.inputs) {
  const bytes = execFileSync('git', ['--no-replace-objects', 'show', `${input.revision}:${input.path}`], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(bytes.length, input.bytes); assert.equal(hash(bytes), input.sha256);
}
assert.deepEqual(report.candidateInputs, { scope: 3246, canonical: 560, cleanup: 220, cleanupCompactSha256: 'd9309d27efd2e1e418f075f4f514efeeefa833e8b3dc5e061662289f8ecd67b6' });
assert.equal(report.originalControls.count, 11); assert.equal(report.originalRefusal.status, 78); assert.equal(report.originalRefusal.archiveBuildSuiteExecuted, false);
assert.deepEqual(report.originalRefusal.issues, [{ kind: 'dirty-tracked-inputs', records: [' M src/commands/search/rg.ts'] }]);
assert.equal(report.existingStrictGuard.authenticatedNativeAssets, 49); assert.equal(report.existingStrictGuard.status, 'preflight-rejected-before-suite');
assert.ok(report.existingStrictGuard.issues.some(issue => issue.kind === 'dirty-tracked-inputs'));
assert.equal(report.cleaned, true); assert.equal(report.newArchiveModeReviewed, false); assert.equal(report.suiteLaunched, false); assert.equal(report.compilerRuns, 0); assert.equal(report.nativeProgramsExecuted, 0); assert.equal(report.sourceArchiveExtracted, false);
const cases = JSON.parse(readFileSync(join(root, 'guard-cases.json')));
assert.equal(cases.candidate, report.candidate); assert.equal(cases.newModeFlag, null); assert.equal(cases.cases.length, 18); assert.equal(new Set(cases.cases.map(entry => entry.id)).size, 18);
console.log(JSON.stringify({ preparationAuthenticated: true, candidate: report.candidate, pendingCases: cases.cases.length, nativeAvailability: 49, newArchiveModeReviewed: false, wholeGateLaunched: false, readiness: report.readiness }, null, 2));
