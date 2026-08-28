import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const own = dirname(fileURLToPath(import.meta.url));
const repository = resolve(own, '../../..');
const prefix = relative(repository, own);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const oid = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repository, maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
function entries(bytes) {
  const records = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const space = bytes.indexOf(32, cursor);
    const zero = bytes.indexOf(0, space);
    const mode = bytes.subarray(cursor, space).toString();
    records.push({ mode, name: bytes.subarray(space + 1, zero).toString(), oid: bytes.subarray(zero + 1, zero + 21).toString('hex'), type: mode === '40000' ? 'tree' : 'blob' });
    cursor = zero + 21;
  }
  assert.equal(cursor, bytes.length);
  return records;
}
function capture(commit) {
  assert.match(commit, /^[0-9a-f]{40}$/);
  const objects = new Map();
  function keep(type, identifier) {
    if (!objects.has(identifier)) {
      const bytes = git('cat-file', type, identifier);
      assert.equal(oid(type, bytes), identifier);
      objects.set(identifier, { type, oid: identifier, sha256: sha256(bytes), base64: bytes.toString('base64') });
    }
    return Buffer.from(objects.get(identifier).base64, 'base64');
  }
  const rawCommit = keep('commit', commit).toString();
  const parent = rawCommit.match(/^parent (.+)$/m)[1];
  const rawParent = keep('commit', parent).toString();
  function visitPath(raw) {
    let current = raw.match(/^tree (.+)$/m)[1];
    for (const name of prefix.split('/')) {
      const entry = entries(keep('tree', current)).find(item => item.name === name);
      assert.ok(entry);
      current = entry.oid;
    }
    return current;
  }
  const tree = visitPath(rawCommit);
  const parentTree = visitPath(rawParent);
  const members = [];
  function visit(identifier, path, saveMembers) {
    for (const entry of entries(keep('tree', identifier))) {
      const filename = `${path}/${entry.name}`;
      if (entry.type === 'tree') visit(entry.oid, filename, saveMembers);
      else if (saveMembers) {
        const bytes = git('cat-file', 'blob', entry.oid);
        assert.equal(oid('blob', bytes), entry.oid);
        assert.deepEqual(readFileSync(join(repository, filename)), bytes, `committed evidence exact: ${filename}`);
        members.push({ path: filename, mode: entry.mode, blob: entry.oid, sha256: sha256(bytes), size: bytes.length });
      }
    }
  }
  visit(tree, prefix, true);
  visit(parentTree, prefix, false);
  const changedPaths = git('diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commit).toString().split('\0').filter(Boolean);
  assert.ok(changedPaths.length > 0 && changedPaths.every(path => path.startsWith(prefix + '/')));
  const staged = git('diff', '--cached', '--name-status').toString();
  assert.equal(staged, '', 'no staging left after explicit owned evidence commit');
  const data = { version: 1, capturedAt: new Date().toISOString(), commit, parent, prefix, changedPaths, members, objects: [...objects.values()], foreignStagingAfterEvidenceCommit: staged,
    evidenceManifestSha256: sha256(readFileSync(join(own, 'evidence-manifest-v1.json'))), note: 'This bounded proof authenticates the evidence commit, not the later audit commit containing the proof itself.' };
  writeFileSync(join(own, 'commit-object-proof-v1.json.gz'), gzipSync(JSON.stringify(data)), { flag: 'wx' });
  return data;
}
function verify() {
  const proof = JSON.parse(gunzipSync(readFileSync(join(own, 'commit-object-proof-v1.json.gz'))));
  const objects = new Map();
  for (const object of proof.objects) {
    const bytes = Buffer.from(object.base64, 'base64');
    assert.equal(oid(object.type, bytes), object.oid);
    assert.equal(sha256(bytes), object.sha256);
    objects.set(object.oid, { type: object.type, bytes });
  }
  const get = (type, identifier) => {
    assert.equal(objects.get(identifier)?.type, type);
    return objects.get(identifier).bytes;
  };
  function root(commit) { return get('commit', commit).toString().match(/^tree (.+)$/m)[1]; }
  function differences(left, right, prefix = '') {
    if (left === right) return [];
    const before = left ? entries(get('tree', left)) : [];
    const after = right ? entries(get('tree', right)) : [];
    const results = [];
    for (const name of [...new Set([...before, ...after].map(item => item.name))].sort()) {
      const old = before.find(item => item.name === name);
      const current = after.find(item => item.name === name);
      if (old?.oid === current?.oid && old?.mode === current?.mode) continue;
      if ((old?.type ?? 'tree') === 'tree' && (current?.type ?? 'tree') === 'tree') results.push(...differences(old?.oid, current?.oid, `${prefix}${name}/`));
      else results.push(prefix + name);
    }
    return results;
  }
  assert.equal(get('commit', proof.commit).toString().match(/^parent (.+)$/m)[1], proof.parent);
  assert.deepEqual(differences(root(proof.parent), root(proof.commit)), [...proof.changedPaths].sort());
  for (const member of proof.members) {
    let current = root(proof.commit);
    let selected;
    for (const name of member.path.split('/')) {
      selected = entries(get('tree', current)).find(entry => entry.name === name);
      assert.ok(selected);
      current = selected.oid;
    }
    assert.equal(current, member.blob);
    assert.equal(selected.mode, member.mode);
    const bytes = readFileSync(join(repository, member.path));
    assert.equal(bytes.length, member.size);
    assert.equal(sha256(bytes), member.sha256);
    assert.equal(oid('blob', bytes), member.blob);
  }
  assert.equal(sha256(readFileSync(join(own, 'evidence-manifest-v1.json'))), proof.evidenceManifestSha256);
  const result = { evidenceCommit: proof.commit, parent: proof.parent, reconstructedChangedPaths: proof.changedPaths.length, authenticatedOwnedMembers: proof.members.length,
    rawCommitTreeObjects: objects.size, allChangesOwned: proof.changedPaths.every(path => path.startsWith(proof.prefix + '/')), noLooseObjectAssumption: true, verifiedAt: new Date().toISOString() };
  console.log(JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[2] === 'capture') {
  capture(process.argv[3]);
  writeFileSync(join(own, 'COMMIT-AUDIT-v1.json'), JSON.stringify(verify(), null, 2) + '\n', { flag: 'wx' });
} else if (process.argv[2] === 'verify') verify();
else throw new Error('usage: commit-audit-v1.mjs capture FULL_EVIDENCE_COMMIT | verify');
