import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '../../..');
const revision = '91d56dbececa0cbc273c7680c60cf9a054470414', path = 'tests/plugins/qualified-current-release-native-data/classification.json';
const output = resolve(process.argv[2] ?? ''); assert.ok(process.argv[2]); assert.equal(existsSync(output), false);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repository, maxBuffer: 8 * 1024 * 1024 });
const manifestBytes = git(['show', `${revision}:${path}`]), manifest = JSON.parse(manifestBytes);
const native = 'tests/commands/regex-execution/continuation/artifacts/native';
const tracked = new Set(git(['ls-tree', '-r', '-z', '--name-only', revision, '--', native]).toString().split('\0').filter(Boolean));
const report = { revision, manifestSha256: hash(manifestBytes), runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), startedAt: new Date().toISOString(), entries: [], readOnlyLiveSupplement: true, historicalCommitClaimForUntrackedFiles: false };
for (const entry of manifest.files) {
  assert.ok(entry.path.startsWith(native + '/'));
  const filename = join(repository, entry.path), row = { path: entry.path, declaredSha256: entry.sha256, gitTracked: tracked.has(entry.path) };
  if (row.gitTracked) row.gitSha256 = hash(git(['show', `${revision}:${entry.path}`]));
  row.liveExists = existsSync(filename);
  if (row.liveExists) { assert.ok(lstatSync(filename).isFile()); assert.equal(lstatSync(filename).isSymbolicLink(), false); assert.ok(realpathSync(filename).startsWith(realpathSync(join(repository, native)) + '/')); row.liveSha256 = hash(readFileSync(filename)); }
  row.gitMatches = row.gitTracked && row.gitSha256 === entry.sha256;
  row.liveMatches = row.liveExists && row.liveSha256 === entry.sha256;
  report.entries.push(row);
}
for (const row of report.entries) if (row.liveExists) assert.equal(hash(readFileSync(join(repository, row.path))), row.liveSha256);
report.counts = { declared: report.entries.length, tracked: report.entries.filter(row => row.gitTracked).length, untrackedAtCommit: report.entries.filter(row => !row.gitTracked).length, trackedMatching: report.entries.filter(row => row.gitMatches).length, liveMatching: report.entries.filter(row => row.liveMatches).length, liveMissing: report.entries.filter(row => !row.liveExists).length, liveMismatched: report.entries.filter(row => row.liveExists && !row.liveMatches).length };
report.finishedAt = new Date().toISOString(); writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report.counts));
