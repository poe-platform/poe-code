import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, inventory, save } from '../output-emergency-review-20260827/common.mjs';

assert.deepEqual(process.argv.slice(2), ['--capture']);
const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const freeze = JSON.parse(readFileSync(join(owned, 'FREEZE.json')));
const destination = join(owned, 'additional-history.json');
assert(!existsSync(destination));
const paths = ['approved-profile-fixtures-20260827', 'approved-profile-fixtures-independent-20260827']
  .map(path => `tests/commands/expr-stress/${path}`);
const before = paths.map(path => ({ path, entries: inventory(join(root, path)) }));
const archive = spawnSync('git', ['archive', '--format=tar', freeze.baseline, ...paths], { cwd: root, timeout: 30000, killSignal: 'SIGTERM', maxBuffer: 64 * 1024 * 1024 });
assert.equal(archive.status, 0);
const scratch = mkdtempSync(join(owned, '.owned-history-'));
try {
  const extract = spawnSync('tar', ['-xf', '-', '-C', scratch], { input: archive.stdout, timeout: 30000, killSignal: 'SIGTERM' });
  assert.equal(extract.status, 0);
  for (const entry of before) assert.deepEqual(inventory(join(scratch, entry.path)), entry.entries);
  assert.deepEqual(paths.map(path => ({ path, entries: inventory(join(root, path)) })), before);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
save(destination, { recordedAt: new Date().toISOString(), baseline: freeze.baseline, archiveSha256: hash(archive.stdout), entries: before,
  completeEntrySetsEqualBaselineArchiveAndLive: true, scratchAbsent: !existsSync(scratch),
  note: 'Supplemental postcandidate preservation audit, not a preexecution inventory for these two trees. Full entry equality binds them to the original preimplementation committed baseline. Original 11/12 and approved V2 12/12 are preserved, not replayed or rescored.' });
console.log(JSON.stringify(before.map(entry => ({ path: entry.path, entries: entry.entries.length }))));
