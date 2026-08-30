import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base, hash, save } from '../../../diff-patch-stress/evidence/fullgate-51282a9-review/replay.mjs';

const directory = resolve(base, '.scratch/final-corrected');
const marker = resolve(directory, '.git');
const text = `gitdir: ${resolve(base, '.scratch/intentionally-absent-git-metadata')}\n`;
const before = hash(readFileSync(resolve(directory, 'tests/commands/metadata-stress/canonical-env/author-snapshot.json')));
execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Add File: ${marker}\n+${text.trim()}\n*** End Patch\n` });
try {
  const unavailable = spawnSync('/usr/bin/git', ['rev-parse', '--show-toplevel'], { cwd: directory, encoding: 'utf8' });
  assert.notEqual(unavailable.status, 0);
  const code = "const {runRelease}=await import('./tests/commands/metadata-stress/canonical-env/runner.mjs'); const result=runRelease(); console.log(JSON.stringify(result)); process.exitCode=result.exitCode;";
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { cwd: directory, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC' }, encoding: 'utf8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
  const report = JSON.parse(result.stdout);
  save('tests/commands/metadata-stress/evidence/fullgate-51282a9-review/git-unavailable-release.json', { method: 'Generated archive has no Git database; explicit non-resolving .git indirection prevents discovery of surrounding working repository. No git init, real repository/index change, or author source/fixture edit. This is an explicit Git-unavailable control, not a claim the surrounding host repository does not exist.', marker: text, git: { status: unavailable.status, stdout: unavailable.stdout, stderr: unavailable.stderr }, invocation: { args: ['--input-type=module', '--eval', code], status: result.status, stderr: result.stderr, signal: result.signal }, report });
  assert.equal(result.status, 0);
  assert.equal(report.status, 'qualified-scoped-pass');
  assert.equal(report.before.head, null);
  assert.equal(report.after.head, null);
  assert.equal(report.counts.pass, 318);
  assert.equal(report.nativeRows.filter(row => row.passed).length, 22);
  assert.equal(hash(readFileSync(resolve(directory, 'tests/commands/metadata-stress/canonical-env/author-snapshot.json'))), before);
  console.log('Git-unavailable archive control: 318/318, all22 native rows, immutable history unchanged');
} finally {
  execFileSync('apply_patch', [], { input: `*** Begin Patch\n*** Delete File: ${marker}\n*** End Patch\n` });
}
