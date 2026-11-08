import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(join(here, 'MANIFEST.json')));
const found = {};
function visit(directory) {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name), key = relative(here, path), stat = lstatSync(path);
    assert.equal(stat.isSymbolicLink(), false, key);
    if (stat.isDirectory()) { found[key + '/'] = 'directory'; visit(path); }
    else { assert.ok(stat.isFile(), key); if (key !== 'MANIFEST.json') found[key] = hash(readFileSync(path)); }
  }
}
visit(here);
assert.deepEqual(found, manifest.entries, 'Exact evidence inventory: missing, changed and new entries fail');
const result = JSON.parse(readFileSync(join(here, 'attempt-1/RESULT.json')));
const gitBlob = (revision, path) => execFileSync('git', ['--no-replace-objects', 'show', `${revision}:${path}`], { cwd: repository, maxBuffer: 8 * 1024 * 1024 });
assert.equal(result.runnerSha256, hash(readFileSync(join(here, 'run.mjs'))));
for (const [path, pin] of Object.entries(result.source)) assert.equal(hash(gitBlob(result.revision, path)), pin, path);
const family = 'tests/integration/full-gate-20260827/runtime-profile-20260827';
const author = JSON.parse(gitBlob('b4266526', family + '/RECEIPT.json'));
for (const [path, pin] of Object.entries(author.source)) assert.equal(result.source[path], pin, path);
assert.equal(hash(gitBlob('b4266526', family + '/AUTHOR_RESULTS.json')), author.evidenceSha256);
assert.deepEqual(result.authorReplay, JSON.parse(readFileSync(join(here, 'attempt-1/UNCHANGED-AUTHOR.json'))));
assert.deepEqual(result.counts, { author: 11, independent: 24, pass: 24, fail: 0 });
assert.equal(result.error, undefined);
assert.ok(result.checks.every(check => check.pass));
assert.equal(result.cleaned, true);
assert.equal(result.privateAccess, false);
assert.equal(result.wholeGate, false);
assert.equal(result.affectedBodiesReexecuted, false);
assert.equal(result.runtime.identity.sha256, '4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0');
assert.equal(result.runtime.identity.version, 'v24.11.1');
assert.equal(result.probes.positive.status, 0);
assert.equal(result.probes['legacy-feature'].status, 78);
assert.match(result.probes['legacy-feature'].probe.stderr, /ERR_INVALID_RETURN_PROPERTY_VALUE[\s\S]*got null/u);
assert.equal(result.runtimeProbeTrustBoundary.suppliedKnownFixtureExecutedForIdentityBeforeHashRefusal, true);
assert.ok(result.children.every(child => child.signal === null && child.error === null));
console.log(JSON.stringify({ evidence: 'sealed', authorReplay: 11, independent: 24, newEntriesDetected: true, wholeGate: false }));
