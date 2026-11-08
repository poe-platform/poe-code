import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(owned, 'FILE-MANIFEST.json');
const entries = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function visit(relative) {
  for (const entry of readdirSync(join(owned, relative), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(relative, entry.name);
    if (path === 'FILE-MANIFEST.json') continue;
    if (entry.isDirectory()) { assert.notEqual(entry.name, '.work'); entries.push({ path, kind: 'directory' }); visit(path); }
    else { assert(entry.isFile()); const bytes = readFileSync(join(owned, path)); entries.push({ path, kind: 'file', bytes: bytes.length, sha256: hash(bytes) }); }
  }
}
visit('');
const summary = JSON.parse(readFileSync(join(owned, 'run-01/summary.json')));
const audit = JSON.parse(readFileSync(join(owned, 'final-audit-02/verification.json')));
assert.equal(summary.summaries.original.pass, 240);
assert.equal(summary.summaries.revised.pass, 241);
assert.equal(summary.summaries.original.tests, 241);
assert.equal(summary.summaries.revised.tests, 241);
assert.equal(summary.fullOutputPolicyAccepted, false);
assert.equal(audit.authenticatedFinalAuthorReceipt, true);
assert.equal(audit.outputPolicyAccepted, false);
assert.equal(audit.forcedWorkerCleanup, 0);
if (process.argv[2] === '--seal') {
  assert(!existsSync(manifestPath), 'never replace a sealed manifest');
  writeFileSync(manifestPath, `${JSON.stringify({ schema: 1, classification: 'Artifact integrity, not complete output policy acceptance',
    replayCandidate: summary.candidate, authorCommit: audit.actualAuthorCommit, excludesOnly: 'FILE-MANIFEST.json',
    detectsAddedEntries: true, entries }, null, 2)}\n`, { flag: 'wx' });
} else assert.equal(process.argv.length, 2);
const manifest = JSON.parse(readFileSync(manifestPath));
assert.deepEqual(entries, manifest.entries, 'reject changed, missing, and added files/directories');
console.log(JSON.stringify({ entries: entries.length, candidate: summary.candidate, original: '240/241', revised: '241/241',
  runtimeOriginal: '11/12', runtimeRevised: '12/12', outputPolicyAccepted: false, finalAuthorBound: true, scratchAbsent: true }));
