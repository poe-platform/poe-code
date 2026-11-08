import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { own, repo, sha, objectHash } from './prepare.mjs';

assert.deepEqual(process.argv.slice(2), ['--seal']);
const sourceBytes = fs.readFileSync(path.join(own, 'SOURCE.json'));
assert.equal(sha(sourceBytes), 'c2cffb6d132f8fae85f5fe80382d653753a1cffba14b82e78b3ad62679ee9559');
const source = JSON.parse(sourceBytes);
const name = 'tests/integration/stream-inspection-public-author/public.test.ts';
const revision = '6bcb55615cbe21ee7738f3c8f1ced8a490102bb2';
const result = spawnSync('/usr/bin/git', ['ls-tree', '-rz', revision, '--', name], { cwd: repo, env: { PATH: '/usr/bin', GIT_OPTIONAL_LOCKS: '0' }, timeout: 5000, maxBuffer: 1048576 });
assert.equal(result.status, 0);
const records = result.stdout.toString().split('\0').filter(Boolean); assert.equal(records.length, 1);
const tab = records[0].indexOf('\t'), [mode, type, blob] = records[0].slice(0, tab).split(' ');
assert.equal(type, 'blob'); assert.equal(records[0].slice(tab + 1), name);
const bytes = fs.readFileSync(path.join(repo, name)); assert.equal(objectHash('blob', bytes), blob);
const changed = { path: name, mode, blob, bytes: bytes.length, sha256: sha(bytes), revision };
const previous = source.fixtures.find(row => row.path === name); assert.ok(previous);
const oldResult = spawnSync('/usr/bin/git', ['cat-file', 'blob', previous.blob], { cwd: repo, env: { PATH: '/usr/bin', GIT_OPTIONAL_LOCKS: '0' }, timeout: 5000, maxBuffer: 1048576 });
assert.equal(oldResult.status, 0); assert.equal(sha(oldResult.stdout), previous.sha256);
const oldTail = '"du", "expr", "which", "timeout"]);';
const newTail = '"du", "expr", "which", "timeout", "apply_patch"]);';
assert.equal(oldResult.stdout.toString().split(oldTail).length, 2);
assert.equal(oldResult.stdout.toString().replace(oldTail, newTail), bytes.toString());
const trees = new Map([...source.ancestorTrees, ...source.fetchedTrees, ...source.reconstructedTrees].map(row => [row.oid, Buffer.from(row.base64, 'base64')]));
for (const [oid, body] of trees) assert.equal(objectHash('tree', body), oid);
const created = [];
function replace(tree, parts) {
  const body = trees.get(tree); assert.ok(body, 'complete selected-path tree witness required');
  const entries = [];
  for (let offset = 0; offset < body.length;) {
    const space = body.indexOf(32, offset), nul = body.indexOf(0, space); assert.ok(space > offset && nul > space && nul + 21 <= body.length);
    const nameBytes = body.subarray(space + 1, nul), text = nameBytes.toString(); assert.ok(Buffer.from(text).equals(nameBytes));
    entries.push({ mode: body.subarray(offset, space).toString(), name: text, oid: body.subarray(nul + 1, nul + 21).toString('hex') }); offset = nul + 21;
  }
  const entry = entries.find(row => row.name === parts[0]); assert.ok(entry);
  if (parts.length === 1) { assert.equal(entry.oid, previous.blob); entry.oid = changed.blob; }
  else { assert.equal(entry.mode, '40000'); entry.oid = replace(entry.oid, parts.slice(1)); }
  const next = Buffer.concat(entries.map(row => Buffer.concat([Buffer.from(`${row.mode} ${row.name}\0`), Buffer.from(row.oid, 'hex')])));
  const oid = objectHash('tree', next); created.push({ oid, base64: next.toString('base64') }); return oid;
}
const computedTree = replace(source.computedTree, name.split('/'));
const manifest = {
  ...source,
  role: 'DERIVED_ONLY_PUBLIC79_FIXTURE_CORRECTION_UNEXECUTED',
  computedTree,
  fixtures: source.fixtures.map(row => row.path === name ? changed : row),
  reconstructedTrees: [...source.reconstructedTrees, ...created],
  predecessor: { computedTree: source.computedTree, sourceSha256: sha(sourceBytes), result: 'original AUTHOR_ASSERTION_FAILURES retained' },
  buildInputsUnchanged: true,
  buildInputListSha256: sha(Buffer.from(JSON.stringify(source.inputs))),
  exactPriorPackage: { sha256: '643939eb315c4869de456bb24e371257e3d85b442f3ca401c57ae93c631c7edd', members: 898, bytes: 814632, relationship: 'same278 build input identities; actual prior tar retained, not rebuilt after fixture correction' },
  fixtureCorrection: { revision, previous, changed, productExecutions: 0 },
  publicFixtureV2: { path: path.relative(repo, path.join(own, 'public-v2.mjs')), sha256: sha(fs.readFileSync(path.join(own, 'public-v2.mjs'))), executions: 0 },
};
assert.equal(JSON.stringify(manifest.inputs), JSON.stringify(source.inputs));
fs.writeFileSync(path.join(own, 'SOURCE-v2.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidate: computedTree, unchangedInputs: manifest.inputs.length, sourceSha256: sha(fs.readFileSync(path.join(own, 'SOURCE-v2.json'))), productExecutions: 0 }));
