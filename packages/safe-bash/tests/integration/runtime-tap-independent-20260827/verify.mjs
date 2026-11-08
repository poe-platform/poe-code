import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(join(here, path)));
const blob = (revision, path) => execFileSync('git', ['--no-replace-objects', 'show', `${revision}:${path}`], { cwd: repository });
const entries = {};
function visit(directory) { for (const name of readdirSync(directory).sort()) { const path = join(directory, name), key = relative(here, path), stat = lstatSync(path); assert.equal(stat.isSymbolicLink(), false); if (stat.isDirectory()) { entries[key + '/'] = 'directory'; visit(path); } else { assert.ok(stat.isFile()); if (key !== 'MANIFEST.json') entries[key] = hash(readFileSync(path)); } } }
visit(here); assert.deepEqual(entries, json('MANIFEST.json').entries);
const original = blob('8bd5baa7', 'tests/integration/runtime-permission-independent-20260827/run.mjs').toString();
assert.equal(readFileSync(join(here, 'replay30.mjs'), 'utf8'), original.replace("const revision = '774644f9ea39b41f824db4c829e7a97e6e1386be'", "const revision = 'c800c899114c6c83b3d3eb67231176d124abaf49'"));
const replay = json('replay-30/RESULT.json'), closure = json('closure/RESULT.json');
assert.deepEqual(replay.counts, { independent: 30, pass: 29, fail: 1 });
assert.deepEqual(replay.checks.filter(row => !row.pass).map(row => row.name), ['v24.11.1 plain node:test execution preserves TAP consumers']);
assert.deepEqual(closure.counts, { total: 31, pass: 31, fail: 0 });
assert.equal(replay.author.controls.length, 26); assert.deepEqual(replay.author.failures, []);
assert.equal(closure.author24.controls.length, 24); assert.deepEqual(closure.author24.failures, []);
for (const [result, filename, rows] of [[replay, 'replay30.mjs', replay.staged], [closure, 'closure.mjs', closure.source]]) {
  assert.equal(result.revision, 'c800c899114c6c83b3d3eb67231176d124abaf49'); assert.equal(result.error, undefined); assert.equal(result.cleaned, true);
  assert.equal(result.runnerSha256, hash(readFileSync(join(here, filename))));
  for (const row of rows) assert.equal(hash(blob(row.commit, row.path)), row.sha256);
  assert.ok(result.children.every(child => child.signal === null && child.error === null));
}
const neighbors = json('REPORTER-NEIGHBOR.json'); assert.equal(neighbors.cases.length, 2); assert.equal(neighbors.error, undefined); assert.equal(neighbors.cleaned, true);
assert.equal(neighbors.runnerSha256, hash(blob('8bd5baa7', 'tests/integration/runtime-permission-independent-20260827/reporter-neighbor.mjs')));
assert.equal(closure.full16Groups, false); assert.equal(replay.fullRuntimeGroupsExecuted, false);
console.log(JSON.stringify({ sealed: true, unchanged30: '29/30 retained', independentDispatch: '31/31', unchangedAuthor: '26/26 + 24/24', neighbors: '2/2', full16GroupsExecuted: false }));
