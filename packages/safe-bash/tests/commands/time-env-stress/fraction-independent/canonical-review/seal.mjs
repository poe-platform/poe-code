import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const own = dirname(import.meta.filename);
const repo = '/Users/kjopek/Workspace/safe-bash';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = name => JSON.parse(readFileSync(join(own, name)));
const pinned = (revision, path) => execFileSync('/usr/bin/git', ['show', revision + ':' + path], { cwd: repo, timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
const result = json('RESULTS.json');
assert.equal(result.accepted, true);
assert.deepEqual(result.commands.canonical223.counts, { tests: 223, pass: 223, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
for (const command of Object.values(result.commands)) {
  assert.equal(command.status, 0); assert.equal(command.clean, true);
  assert.deepEqual(command.signals, []); assert.deepEqual(command.survivors, []);
}
assert.equal(result.archiveChanges.length, 1);
assert.equal(result.archiveChanges[0].path, 'tests/commands/time-env/date.test.ts');
assert.equal(result.readonlyGuards.beforeSha256, result.readonlyGuards.afterSha256);
assert.deepEqual(result.readonlyGuards.changes, []);
assert.equal(result.cleanedScratch, true); assert.equal(existsSync(result.scratch), false);
assert.equal(hash(readFileSync(join(own, 'runtime-imports.jsonl'))), result.imports.sha256);
assert.equal(result.imports.negativeControls.length, 6);
assert.ok(result.imports.negativeControls.every(row => row.rejected));
const datePath = 'tests/commands/time-env/date.test.ts';
assert.equal(hash(pinned(result.candidate, datePath)), result.candidateSha256);
assert.equal(hash(readFileSync(join(repo, datePath))), result.candidateSha256);
assert.equal(hash(readFileSync(join(own, 'candidate.patch'))), result.diffSha256);
const referencePaths = [
  ['c9b9626', 'tests/commands/time-env-stress/fraction-independent/semantics/canonical-native-proposals.json'],
  ['c9b9626', 'tests/commands/time-env-stress/fraction-independent/semantics/product-results.jsonl'],
  ['c9b9626', 'tests/commands/time-env-stress/fraction-independent/semantics/consumer.stderr'],
  ['c9b9626', 'tests/commands/time-env-stress/fraction-independent/semantics/classification-v2.json'],
  ['61c66bc', 'tests/commands/time-env-stress/fraction-independent/packed/evidence-final/source-original223.json'],
  ['61c66bc', 'tests/commands/time-env-stress/fraction-independent/packed/evidence-final/source-original223.stdout'],
  ['61c66bc', 'tests/commands/time-env-stress/fraction-independent/packed/evidence-final/source-original223.stderr'],
  [result.candidate, 'tests/commands/time-env-stress/fraction-independent/canonical/canonical223.json'],
  [result.candidate, 'tests/commands/time-env-stress/fraction-independent/canonical/canonical223.stdout'],
];
const references = referencePaths.map(([revision, path]) => {
  const bytes = pinned(revision, path);
  assert.equal(hash(readFileSync(join(repo, path))), hash(bytes), 'historical evidence changed: ' + path);
  return { revision, path, sha256: hash(bytes), bytes: bytes.length };
});
if (process.argv.includes('--check')) {
  assert.deepEqual(json('REFERENCES.json'), references);
  const manifest = json('MANIFEST.json');
  for (const [path, sha256] of Object.entries(manifest.files)) assert.equal(hash(readFileSync(join(own, path))), sha256, path);
  assert.deepEqual(readdirSync(own).filter(path => path !== 'MANIFEST.json').sort(), Object.keys(manifest.files).sort());
  console.log(`PASS: sealed independent223/223 + scoped types; ${references.length} immutable historical references; no product rerun.`);
} else {
  writeFileSync(join(own, 'REFERENCES.json'), JSON.stringify(references, null, 2) + '\n', { flag: 'wx' });
  const files = Object.fromEntries(readdirSync(own).sort().filter(path => path !== 'MANIFEST.json').map(path => [path, hash(readFileSync(join(own, path)))]));
  writeFileSync(join(own, 'MANIFEST.json'), JSON.stringify({ sealedAt: new Date().toISOString(), identity: result.identity, candidate: result.candidate,
    source: result.source, verdict: 'ACCEPT exact two canonical migrations only; not integration/default68 acceptance', files,
  }, null, 2) + '\n', { flag: 'wx' });
  console.log('Sealed independent canonical migration acceptance.');
}
