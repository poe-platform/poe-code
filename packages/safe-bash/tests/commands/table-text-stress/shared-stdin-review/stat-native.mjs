import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { root, work, sha, save } from './tools.mjs';

const commit = 'bdaaf50b3eccdd261349c1f32c19407fa348a64f';
const path = 'tests/commands/metadata/stat.test.ts';
function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
assert.equal(git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit]).trim(), path);
const before = git(['show', `${commit}^:${path}`]);
const after = git(['show', `${commit}:${path}`]);
const oldExpected = 'file:4:751:-rwxr-x--x:regular file:1969-12-31 23:59:59.999 +0000:2000-01-01 00:00:00.123 +0000:946684800:946684800.123:-0.001:%';
const expected = 'file:4:751:-rwxr-x--x:regular file:1969-12-31 23:59:59.999000000 +0000:2000-01-01 00:00:00.123000000 +0000:946684800:946684800.123:-0.001:%';
assert.equal(before.split(oldExpected).length, 2);
assert.equal(before.replace(oldExpected, expected), after);
assert.equal(readFileSync(join(root, path), 'utf8'), after);
const oracle = join(root, 'tests/commands/metadata-stress/.oracle/coreutils-9.7');
const binaryPins = { stat: '9bfc67687cc527eb69aa7a877c1551c22db6ea46ff910ad055015958924e1fea', touch: '47fc9af399d94e27bc94c19eba754502b38dfb80fbad3d09c5f6b237698dbf68' };
for (const [name, hash] of Object.entries(binaryPins)) assert.equal(sha(readFileSync(join(oracle, 'src', name))), hash);
mkdirSync(work, { recursive: true });
const cwd = mkdtempSync(join(work, 'native-stat-'));
const calls = [];
function native(command, args) {
  const result = spawnSync(join(oracle, 'src', command), args, { cwd, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  calls.push({ command, args, status: result.status, stdoutHex: Buffer.from(result.stdout).toString('hex'), stderrHex: Buffer.from(result.stderr).toString('hex') });
  return result.stdout;
}
let times;
try {
  writeFileSync(join(cwd, 'sentinel'), 'comm-final-stat-only');
  writeFileSync(join(cwd, 'file'), Buffer.from('00ff0d0a', 'hex'));
  chmodSync(join(cwd, 'file'), 0o751);
  for (const command of ['stat', 'touch']) assert.equal(native(command, ['--version']).split('\n')[0], `${command} (GNU coreutils) 9.7`);
  native('touch', ['-a', '-d', '@-0.001', 'file']);
  native('touch', ['-m', '-d', '@946684800.123', 'file']);
  const metadata = statSync(join(cwd, 'file'), { bigint: true });
  assert.equal(metadata.atimeNs, -1000000n);
  assert.equal(metadata.mtimeNs, 946684800123000000n);
  times = { atimeNs: String(metadata.atimeNs), mtimeNs: String(metadata.mtimeNs) };
  assert.equal(native('stat', ['-c', '%n:%s:%a:%A:%F:%x:%y:%Y:%.3Y:%.3X:%%', 'file']), expected + '\n');
  assert.deepEqual(readdirSync(cwd).sort(), ['file', 'sentinel']);
  assert.equal(readFileSync(join(cwd, 'file')).toString('hex'), '00ff0d0a');
  assert.equal(readFileSync(join(cwd, 'sentinel'), 'utf8'), 'comm-final-stat-only');
} finally { rmSync(cwd, { recursive: true }); }
save(join(work, 'stat-independent-native.json'), { commit, path, beforeSha256: sha(before), afterSha256: sha(after), onlyExpectedStringChanged: true, diff: git(['show', '--format=', commit, '--', path]), binaryPins, sourceSha256: sha(readFileSync(join(oracle, 'src/stat.c'))), calls, times, exact: 1, total: 1, cleanup: { cwd, removed: true }, historical: '42/43 author metadata retained, not rerun here', limitation: 'Zero-padding known integral milliseconds; no recovered nanosecond precision and no SGID execution.' });
console.log('Independent native stat assertion validation 1/1; test-only commit verified.');
