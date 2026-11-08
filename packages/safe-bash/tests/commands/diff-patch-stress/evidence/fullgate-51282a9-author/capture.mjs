import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { oracleIdentity } from '../../gnu-target/oracle.ts';

export const directory = 'tests/commands/diff-patch-stress/evidence/fullgate-51282a9-author';
export const tests = [
  'tests/commands/diff-patch-stress/fuzz/edits.test.ts',
  'tests/commands/diff-patch-stress/emptyfile-delta/emptyfile.test.ts',
  'tests/commands/diff-patch-stress/editflows/quoted-safety.test.ts',
];
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, { encoding: 'utf8', shell: false, timeout: 120_000, maxBuffer: 16 * 1024 * 1024, ...options });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { binary, args, status: result.status, stdout: result.stdout, stderr: result.stderr };
}
export function save(path, data) {
  assert(!existsSync(path), `refusing to replace evidence ${path}`);
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n';
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`;
  const result = command('apply_patch', [], { input: patch });
  assert.equal(result.status, 0, result.stderr);
}
export function sourceState() {
  const paths = command('git', ['ls-files', 'src']).stdout.trim().split('\n');
  const sources = Object.fromEntries(paths.map(path => [path, hash(readFileSync(path))]));
  const diffPatch = Object.fromEntries(Object.entries(sources).filter(([path]) => path.startsWith('src/commands/diff-patch/')));
  return { head: command('git', ['rev-parse', 'HEAD']).stdout.trim(), sources, sourceSha256: hash(JSON.stringify(sources)),
    diffPatchSha256: hash(JSON.stringify(diffPatch)), status: command('git', ['status', '--short']).stdout,
    index: command('git', ['diff', '--cached', '--name-status']).stdout };
}
if (process.argv[2] === 'original') {
  const paths = [...new Set([...tests, ...command('git', ['ls-files', 'tests/commands/diff-patch-stress/emptyfile-delta']).stdout.trim().split('\n'),
    ...command('git', ['ls-files', 'src/commands/diff-patch']).stdout.trim().split('\n'),
    'tests/commands/diff-patch-stress/fuzz/helpers.ts', 'tests/commands/diff-patch-stress/editflows/helpers.ts',
    'tests/commands/diff-patch-stress/editflows/fixtures.ts', 'tests/commands/diff-patch-stress/safety/helpers.ts',
    'tests/commands/diff-patch-stress/gnu-target/oracle.ts', 'tests/integration/full-gate-20260827/REPORT.md'])].sort();
  save(`${directory}/original.json`, { capturedAt: new Date().toISOString(), node: process.version,
    platform: process.platform, arch: process.arch, state: sourceState(),
    pins: { gnuPatch: oracleIdentity('patch'), gnuDiff: oracleIdentity('diff'), applePatch: oracleIdentity('patch', 'apple-calibration') },
    files: Object.fromEntries(paths.map(path => { const bytes = readFileSync(path); return [path, { sha256: hash(bytes), base64: bytes.toString('base64') }]; })) });
  save('/tmp/safe-bash-canonical-diff-status.txt', 'Ownership confirmed from current root assignment: leaf, no delegation. Only diff-patch production if independently proven, three named test scopes, author evidence. Source and exact originals archived in fullgate-51282a9-author/original.json before execution. Report routes eight apparent failures: repeated hunk 1, pruned-parent nlink 6, stripped quoted ancestor 1. Native diagnosis and unchanged exact suite counts pending. No production changes; other workers and index preserved.\n');
  const before = sourceState();
  const result = command(process.execPath, ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap', ...tests]);
  save(`${directory}/original-run.json`, { capturedAt: new Date().toISOString(), before, result, after: sourceState() });
  console.log(result.stdout.slice(-1000));
  console.log(`Original suite exit ${result.status}`);
}
