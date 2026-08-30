import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../../..');
const seal = JSON.parse(readFileSync(path.join(directory, 'evidence-v1/seal.json')));
const destination = path.join(directory, 'commit-pathproof-v1.json');
const mode = process.argv[2];
assert.ok(mode === 'capture' || mode === 'verify');
const proof = mode === 'capture' ? { version: 1, objects: {}, changes: {} } : JSON.parse(readFileSync(destination));
function git(...args) {
  const result = spawnSync('git', args, { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  return result.stdout;
}
function object(oid) {
  if (!proof.objects[oid] && mode === 'capture') {
    const type = git('cat-file', '-t', oid).toString().trim();
    const bytes = git('cat-file', type, oid);
    proof.objects[oid] = { type, base64: bytes.toString('base64') };
  }
  assert.ok(proof.objects[oid], `sealed object ${oid}`);
  const { type, base64 } = proof.objects[oid];
  const bytes = Buffer.from(base64, 'base64');
  assert.equal(createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex'), oid);
  return { type, bytes };
}
function tree(oid) {
  if (!oid) return new Map();
  const saved = object(oid);
  assert.equal(saved.type, 'tree');
  const result = new Map();
  let cursor = 0;
  while (cursor < saved.bytes.length) {
    const space = saved.bytes.indexOf(32, cursor);
    const nul = saved.bytes.indexOf(0, space);
    result.set(saved.bytes.subarray(space + 1, nul).toString(), {
      mode: saved.bytes.subarray(cursor, space).toString(),
      oid: saved.bytes.subarray(nul + 1, nul + 21).toString('hex'),
    });
    cursor = nul + 21;
  }
  assert.equal(cursor, saved.bytes.length);
  return result;
}
function changed(oldTree, newTree, prefix = '') {
  if (oldTree === newTree) return [];
  const oldEntries = tree(oldTree);
  const newEntries = tree(newTree);
  const changes = [];
  for (const name of [...new Set([...oldEntries.keys(), ...newEntries.keys()])].sort()) {
    const oldEntry = oldEntries.get(name);
    const newEntry = newEntries.get(name);
    if (oldEntry?.oid === newEntry?.oid && oldEntry?.mode === newEntry?.mode) continue;
    const file = prefix + name;
    if (oldEntry?.mode === '40000' || newEntry?.mode === '40000') {
      changes.push(...changed(oldEntry?.oid, newEntry?.oid, `${file}/`));
    } else {
      if (oldEntry) object(oldEntry.oid);
      if (newEntry) object(newEntry.oid);
      changes.push({ path: file, before: oldEntry ?? null, after: newEntry ?? null });
    }
  }
  return changes;
}
for (const name of ['freeze', 'candidate', 'evidence', 'independentFreeze']) {
  const oid = seal.commits[name];
  const commit = object(oid);
  assert.equal(commit.type, 'commit');
  const raw = commit.bytes.toString();
  const parents = [...raw.matchAll(/^parent ([a-f0-9]{40})$/gm)].map(match => match[1]);
  assert.equal(parents.length, 1);
  const parent = object(parents[0]);
  assert.equal(parent.type, 'commit');
  const previousTree = /^tree (.*)$/m.exec(parent.bytes.toString())[1];
  const currentTree = /^tree (.*)$/m.exec(raw)[1];
  const delta = changed(previousTree, currentTree);
  const expected = seal.pathsets[name].trim().split('\n').map(row => {
    const [status, file] = row.split('\t');
    assert.equal(status, 'A');
    return file;
  }).sort();
  assert.deepEqual(delta.map(item => item.path).sort(), expected);
  assert.ok(delta.every(item => item.before === null && item.after.mode === '100644'));
  const record = { oid, parent: parents[0], previousTree, currentTree, delta };
  if (mode === 'capture') proof.changes[name] = record;
  else assert.deepEqual(record, proof.changes[name]);
}
if (mode === 'capture') {
  assert.equal(existsSync(destination), false);
  writeFileSync(destination, `${JSON.stringify(proof, null, 2)}\n`);
}
console.log(JSON.stringify({ mode, allChangedPathsAuthenticated: true, objects: Object.keys(proof.objects).length,
  pathCounts: Object.fromEntries(Object.entries(proof.changes).map(([name, value]) => [name, value.delta.length])) }, null, 2));
