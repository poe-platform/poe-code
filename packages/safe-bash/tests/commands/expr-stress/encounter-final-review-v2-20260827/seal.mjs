import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, lstatSync, readlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 128 * 1024 * 1024 });
function inventory() {
  const records = {};
  function walk(current, prefix = '') {
    for (const entry of readdirSync(current).sort()) {
      if (!prefix && entry === 'SEAL.json') continue;
      const filename = prefix ? `${prefix}/${entry}` : entry;
      const absolute = join(current, entry), stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) records[filename] = { kind: 'symlink', target: readlinkSync(absolute) };
      else if (stat.isDirectory()) { records[filename] = { kind: 'directory' }; walk(absolute, filename); }
      else records[filename] = { kind: 'file', bytes: stat.size, sha256: hash(readFileSync(absolute)) };
    }
  }
  walk(owned);
  return records;
}
function verifyBindings() {
  const source = JSON.parse(readFileSync(join(owned, 'candidate-01/candidate.json')));
  assert.equal(hash(git('archive', '--format=tar', source.candidate, ...source.selected)), source.archiveSha256);
  const audit = JSON.parse(readFileSync(join(owned, 'SOURCE-AUDIT.json')));
  for (const entry of audit.sourceFiles) assert.equal(hash(git('show', `${audit.candidate}:${entry.filename}`)), entry.sha256);
  for (const entry of audit.authenticatedHistoricalInputs) assert.equal(hash(git('show', `${entry.commit}:${entry.filename}`)), entry.sha256);
  const freeze = JSON.parse(readFileSync(join(owned, 'candidate-01/freeze-before.json')));
  for (const [filename, expected] of Object.entries(freeze.encounter)) assert.equal(hash(git('show', `${audit.freeze}:tests/commands/expr-stress/encounter-independent-v2-20260827/${filename}`)), expected);
  const core = JSON.parse(readFileSync(join(owned, 'core-01/summary.json')));
  assert.equal(hash(git('archive', '--format=tar', core.candidate, ...core.selected)), core.archiveSha256);
  return { candidate: source.candidate, sourceArchiveSha256: source.archiveSha256, coreArchiveSha256: core.archiveSha256 };
}
const mode = process.argv[2];
assert(mode === '--seal' || mode === '--verify');
const bindings = verifyBindings();
if (mode === '--seal') {
  writeFileSync(join(owned, 'SEAL.json'), `${JSON.stringify({ sealedAt: new Date().toISOString(), bindings, entries: inventory(), detectsAppendedEntries: true, globalLiveTreeClaim: false }, null, 2)}\n`, { flag: 'wx' });
} else {
  const seal = JSON.parse(readFileSync(join(owned, 'SEAL.json')));
  assert.deepEqual(bindings, seal.bindings);
  assert.deepEqual(inventory(), seal.entries);
}
console.log(JSON.stringify({ mode, candidate: bindings.candidate, files: Object.values(inventory()).filter(entry => entry.kind === 'file').length, addedEntryDetection: true }));
