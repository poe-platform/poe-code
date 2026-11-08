import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, inventory, save } from '../output-emergency-review-20260827/common.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const [mode] = process.argv.slice(2);
assert(['--seal', '--verify'].includes(mode) && process.argv.length === 3);
const freeze = JSON.parse(readFileSync(join(owned, 'FREEZE-v2.json')));
for (const entry of freeze.controls) assert.equal(hash(readFileSync(join(root, entry.path))), entry.sha256);
for (const entry of freeze.historical) assert.deepEqual(inventory(join(owned, '..', entry.path)), entry.entries);
const approved = JSON.parse(readFileSync(join(owned, 'additional-history.json')));
for (const entry of approved.entries) assert.deepEqual(inventory(join(root, entry.path)), entry.entries);
assert.equal(approved.scratchAbsent, true);
const originalFreeze = JSON.parse(readFileSync(join(owned, 'FREEZE.json')));
const originalTest = readFileSync(join(owned, 'regression-pretype.ts.data'), 'utf8');
assert.equal(hash(readFileSync(join(owned, 'FREEZE.json'))), freeze.typeOnlyCorrection.originalFreezeSha256);
assert.equal(hash(originalTest), freeze.typeOnlyCorrection.originalTestSha256);
assert.equal(readFileSync(join(root, 'tests/commands/expr/output-quota.test.ts'), 'utf8'), originalTest.replace('this: TextEncoder,', 'this: InstanceType<typeof TextEncoder>,'));
for (const name of ['run01', 'run02']) {
  const summary = JSON.parse(readFileSync(join(owned, name, 'summary.json')));
  assert.equal(summary.candidate, 'c25e682a7baa2f2abf70cebf8c01d11d0ad5daee');
  assert.equal(summary.sourceSha256, 'b1ad46e35f4077659aee2d148ab30a1ac6ba4032a877669ae2c5bfb27447c7fa');
  assert.equal(summary.build, 0); assert.equal(summary.types, 0); assert.equal(summary.regressionStatus, 0); assert.equal(summary.adjacentStatus, 1);
  assert.equal(summary.passed, 46); assert.equal(summary.total, 47);
  assert.deepEqual(summary.failed, ['stdout-rejection-normal-quota']);
  const archive = spawnSync('git', ['archive', '--format=tar', summary.candidate, ...originalFreeze.selected], { cwd: root, timeout: 30000, killSignal: 'SIGTERM', maxBuffer: 128 * 1024 * 1024 });
  assert.equal(archive.status, 0); assert.equal(hash(archive.stdout), summary.archiveSha256);
  const regression = JSON.parse(readFileSync(join(owned, name, 'regression.json')));
  assert(regression.stdout.includes('# tests 85\n') && regression.stdout.includes('# pass 85\n') && regression.stdout.includes('# fail 0\n'));
  const adjacent = JSON.parse(readFileSync(join(owned, name, 'adjacent.json')));
  assert(adjacent.stdout.includes('# tests 303\n') && adjacent.stdout.includes('# pass 302\n') && adjacent.stdout.includes('# fail 1\n'));
  const results = JSON.parse(readFileSync(join(owned, name, 'unchanged47.json')));
  assert.equal(results.safetyTerminations, 0); assert.equal(results.activeAfterSafety, 0);
  assert.deepEqual(results.unhandledRejections, []); assert.deepEqual(results.mainThreadMatcherViolations, []);
  assert(results.rows.every(row => row.activeAtSettlement === 0 && row.activeAfterCleanup === 0));
  const cleanup = JSON.parse(readFileSync(join(owned, name, 'cleanup.json')));
  assert.equal(cleanup.absent, true); assert(!existsSync(cleanup.scratch));
}
const entries = inventory(owned).filter(entry => entry.path !== 'SEAL.json');
assert(!entries.some(entry => entry.path.startsWith('.owned-')));
if (mode === '--seal') save(join(owned, 'SEAL.json'), { sealedAt: new Date().toISOString(), entries,
  note: 'Complete entry equality includes new additions. No historical assertions rescaled; 46/47 twice and 302/303 twice intentionally retained. This verifies archived candidate evidence, not later live product source.' });
else assert.deepEqual(entries, JSON.parse(readFileSync(join(owned, 'SEAL.json'))).entries);
console.log('Verified candidate archives, 85/85 twice, unchanged 46/47 twice, adjacent 302/303 twice, historical evidence and full entry sets.');
