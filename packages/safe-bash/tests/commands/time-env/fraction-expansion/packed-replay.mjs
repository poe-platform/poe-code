import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(dirname(import.meta.filename), '../../../..');
const output = process.argv[2]; assert.ok(output?.startsWith('/tmp/'));
const candidate = execFileSync('git', ['rev-parse', 'c782363^{commit}'], { cwd: repo }).toString().trim();
const originalPath = 'tests/commands/time-env-stress/fix-review/packed.mjs';
const original = execFileSync('git', ['show', `2542cfa:${originalPath}`], { cwd: repo }).toString();
const hash = value => createHash('sha256').update(value).digest('hex');
const oldRevision = '94bb4c974b17cd01477eff1c92e41619e0ebf465';
assert.equal(original.split(oldRevision).length - 1, 2);
const driver = original.replaceAll(oldRevision, candidate)
  .replace("const own = dirname(import.meta.filename), repo = resolve(own, '../../../..');", `const own = ${JSON.stringify(join(repo, dirname(originalPath)))}, repo = ${JSON.stringify(repo)};`)
  .replace("'../../../integration/full-gate-20260827/supervise.mjs'", JSON.stringify(pathToFileURL(join(repo, 'tests/integration/full-gate-20260827/supervise.mjs')).href));
assert.notEqual(driver, original);
for (const name of ['holdout.mts', 'guard.mjs']) {
  const pinned = execFileSync('git', ['show', `2542cfa:tests/commands/time-env-stress/fix-review/${name}`], { cwd: repo });
  const current = execFileSync('git', ['hash-object', `tests/commands/time-env-stress/fix-review/${name}`], { cwd: repo }).toString().trim();
  assert.equal(current, execFileSync('git', ['hash-object', '--stdin'], { input: pinned, cwd: repo }).toString().trim());
}
const scratch = await mkdtemp('/tmp/time-env-fraction-packed-driver-');
try {
  const path = join(scratch, 'driver.mjs'); await writeFile(path, driver);
  const result = spawnSync(process.execPath, [path, output, candidate], { cwd: repo, timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? ''); assert.ifError(result.error); assert.equal(result.status, 0);
  await writeFile(join(output, 'author-replay-provenance.json'), JSON.stringify({ candidate, originalRevision: '2542cfa', originalPath, originalSha256: hash(original), driverSha256: hash(driver),
    adaptation: ['replace the two candidate source-revision constants only', 'bind driver paths to unchanged original holdout and supervisor', 'no assertion or expected-output changes'],
    independentAcceptance: false, capturedAt: new Date().toISOString() }, null, 2));
} finally { await rm(scratch, { recursive: true, force: true }); }
