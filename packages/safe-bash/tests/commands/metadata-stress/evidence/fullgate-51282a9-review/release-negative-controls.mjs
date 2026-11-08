import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, renameSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { base, hash, save } from '../../../diff-patch-stress/evidence/fullgate-51282a9-review/replay.mjs';

const directory = resolve(base, '.scratch/final-corrected');
const oracle = resolve(directory, 'tests/commands/metadata-stress/.oracle');
assert(lstatSync(oracle).isDirectory() && !lstatSync(oracle).isSymbolicLink());
const results = [];
function release(label) {
  const args = ['tests/commands/metadata-stress/canonical-env/runner.mjs', 'release'];
  const result = spawnSync(process.execPath, args, { cwd: directory, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC' }, encoding: 'utf8', timeout: 30_000 });
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 78);
  assert.equal(report.status, 'setup-unavailable');
  assert.equal(report.executedTests, 0);
  results.push({ label, args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, report });
}
renameSync(oracle, `${oracle}-temporarily-withheld`);
try { release('missing copied native cache'); }
finally { renameSync(`${oracle}-temporarily-withheld`, oracle); }
const binary = resolve(oracle, 'coreutils-9.7/src/stat');
const before = { sha256: hash(readFileSync(binary)), mode: statSync(binary).mode };
renameSync(binary, `${binary}-qualified-bytes`);
try {
  execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${binary}\n+deliberately wrong oracle pin; must never execute\n*** End Patch\n` });
  try { release('wrong copied stat pin'); }
  finally { execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Delete File: ${binary}\n*** End Patch\n` }); }
} finally { renameSync(`${binary}-qualified-bytes`, binary); }
const after = { sha256: hash(readFileSync(binary)), mode: statSync(binary).mode };
assert.deepEqual(after, before);
save('tests/commands/metadata-stress/evidence/fullgate-51282a9-review/release-negative-controls.json', { results, before, after, helperSha256: hash(readFileSync(new URL(import.meta.url))), method: 'Only copied disposable native assets withheld/corrupted and restored; no original host cache, historical evidence, fixture or product edits. Exact release CLI fails78 with zero tests for each control. Repeated prerequisites controls, not extra semantic coverage.' });
console.log('Exact release CLI: missing cache and wrong pin both unavailable78, zero tests, copied assets restored');
