import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, chmodSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { base, git, hash, originalReplay, save, snapshot } from './replay.mjs';

const revision = process.argv[2];
assert.match(revision ?? '', /^[0-9a-f]{40}$/);
const gate = readFileSync('/tmp/safe-bash-canonical-final-review.ready', 'utf8');
assert(gate.includes(revision), 'Root ready marker must bind this exact committed revision');
assert.match(gate, /CLOSED/i, 'Root must confirm actual author closure');
assert.equal(git('rev-parse', revision).toString().trim(), revision);
const metadataBase = 'tests/commands/metadata-stress/evidence/fullgate-51282a9-review';
const initialAuthentication = JSON.parse(readFileSync(`${metadataBase}/initial-authentication.json`, 'utf8'));
function overlay(directory) {
  const entries = [...initialAuthentication.native, { path: resolve('tests/commands/metadata-stress/.oracle/coreutils-9.7/src/comm.c'), expected: '3517b5f9e88bbb67ce93e3075811d0856647104ca83c40001f7fa2dcf07c7336' }];
  return entries.map(entry => {
    const source = readFileSync(entry.path);
    assert.equal(hash(source), entry.expected);
    const relative = entry.path.startsWith(`${process.cwd()}/`) ? entry.path.slice(process.cwd().length + 1) : null;
    const target = relative ? resolve(directory, relative) : entry.path;
    if (relative) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(entry.path, target);
      chmodSync(target, statSync(entry.path).mode);
    }
    const actual = hash(readFileSync(target));
    assert.equal(actual, entry.expected);
    return { source: entry.path, target, copied: relative !== null, expected: entry.expected, actual };
  });
}
function manifest(directory) {
  const paths = git('ls-tree', '-r', '--name-only', revision, 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'tests/commands/diff-patch-stress', 'tests/commands/metadata-stress', 'tests/commands/metadata', 'tests/commands/table-text-stress', 'tests/commands/table-text').toString().trim().split('\n');
  return paths.map(path => {
    const bytes = readFileSync(resolve(directory, path));
    const expected = hash(git('show', `${revision}:${path}`));
    assert.equal(hash(bytes), expected, path);
    return { path, sha256: expected, blob: git('rev-parse', `${revision}:${path}`).toString().trim() };
  });
}
function command(directory, label, executable, args) {
  const result = spawnSync(executable, args, { cwd: directory, env: { PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', TMPDIR: resolve(base, '.scratch') }, encoding: 'utf8', timeout: 240_000, maxBuffer: 32 * 1024 * 1024 });
  save(`${base}/${label}.json`, { revision, executable, args, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr });
  console.log(label, result.status, result.stdout.slice(-1000));
  return result;
}
const corrected = snapshot(revision, 'final-corrected');
const copied = overlay(corrected);
const before = manifest(corrected);
save(`${base}/final-gate.json`, { capturedAt: new Date().toISOString(), revision, gate, headAtCapture: git('rev-parse', 'HEAD').toString().trim(), dirtyAtCapture: git('status', '--short').toString(), stagedAtCapture: git('diff', '--cached', '--name-status').toString(), before, nativeOverlay: copied, harness: ['replay.mjs', 'probe.mjs', 'evaluate.mjs', 'final-run.mjs', 'mutations.mjs', 'type-wiring.mjs', 'initial-freeze.json', 'initial-extra-control-native-product.json'].map(name => ({ name, sha256: hash(readFileSync(`${base}/${name}`)) })) });
const originals = snapshot('72f780d', 'final-original');
assert.equal(git('diff', '--diff-filter=D', '--name-only', '72f780d', revision, '--', 'src').toString(), '', 'Deleted source paths require explicit clean source replacement');
execFileSync('/usr/bin/tar', ['-xf', '-', '-C', originals], { input: git('archive', revision, 'src'), maxBuffer: 128 * 1024 * 1024 });
const originalSource = git('ls-tree', '-r', '--name-only', revision, 'src').toString().trim().split('\n').map(path => {
  const actual = hash(readFileSync(resolve(originals, path)));
  const expected = hash(git('show', `${revision}:${path}`));
  assert.equal(actual, expected, path);
  return { path, sha256: actual };
});
save(`${base}/final-original-source-binding.json`, { revision, files: originalSource, originalTestRevision: '72f780d0dbe73f71702c89c33d29aa614170c403', sourceOnlyOverlay: true });
overlay(originals);
originalReplay(originals, 'final-qualified-original31');
const outcomes = [];
outcomes.push(command(corrected, 'final-mandatory-setup-check', process.execPath, ['tests/commands/metadata-stress/canonical-env/runner.mjs', 'check']));
outcomes.push(command(corrected, 'final-mandatory-metadata-table-release', process.execPath, ['tests/commands/metadata-stress/canonical-env/runner.mjs', 'release']));
outcomes.push(command(corrected, 'final-setup-provenance-controls', process.execPath, ['--import', 'tsx', '--test', 'tests/commands/metadata-stress/canonical-env/setup.test.mjs', 'tests/commands/metadata-stress/canonical-env/provenance-controls.test.mjs']));
outcomes.push(command(corrected, 'final-corrected-diff-targets', process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', 'tests/commands/diff-patch-stress/fuzz/edits.test.ts', 'tests/commands/diff-patch-stress/emptyfile-delta/emptyfile.test.ts', 'tests/commands/diff-patch-stress/editflows/quoted-safety.test.ts']));
outcomes.push(command(corrected, 'final-author-signed-matcher-controls', process.execPath, ['--import', 'tsx', '--test', 'tests/commands/diff-patch-stress/fuzz/repeated-match.test.ts']));
const after = manifest(corrected);
assert.deepEqual(after, before);
save(`${base}/final-post-replay-manifest.json`, { revision, unchanged: true, after });
process.exitCode = outcomes.every(result => result.status === 0 && !result.error && !result.signal) ? 0 : 1;
