import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { sha256, relativePath } from './binding.mjs';

export function authenticateFixture(records) {
  const raw = Buffer.from(records.records.fixture.base64, 'base64');
  assert.equal(sha256(raw), 'fcb7bae1505a86b2b676396742d7bf362ad779c77192770ed94085646f8d0074');
  assert.equal(sha256(Buffer.from(records.records.authorBinding.base64, 'base64')), 'b046c0dd2765eb86d7fc9ec1b77092d61a2f987568138465bb77bbf0790f1aff');
  const original = JSON.parse(raw);
  const expectedFiles = original.files.map(file => {
    const bytes = file.base64 === undefined ? Buffer.from(file.text) : Buffer.from(file.base64, 'base64');
    return { path: file.path, type: 'file', mode: file.mode, bytes: bytes.length, sha256: sha256(bytes), base64: bytes.toString('base64') };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  assert.deepEqual(records.files, expectedFiles);
  const directoryNames = [...new Set(expectedFiles.flatMap(file => file.path.split('/').slice(0, -1).map((_, index) => file.path.split('/').slice(0, index + 1).join('/'))))].sort();
  assert.deepEqual(records.directories, directoryNames.map(path => ({ path, type: 'directory', mode: 0o755 })));
  const tree = [...records.directories, ...records.files.map(({ base64, ...file }) => file)].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  assert.deepEqual(records.tree, tree); assert.equal(records.treeSha256, sha256(JSON.stringify(tree)));
  assert.equal(records.workflows.length, 6);
  for (const [index, output] of original.proposedOutputs.entries()) assert.deepEqual(records.workflows[index], {
    id: `A0${index + 1}`, args: output.args, cwd: '/repo', env: {}, stdinBase64: '', exitCode: output.exitCode,
    stdoutBase64: Buffer.from(output.stdout).toString('base64'), stderrBase64: '', effects: 'EXACT_BASELINE_TREE_UNCHANGED', basis: 'PROJECT_PREDICTION_NATIVE_UNRUN',
  });
  const objects = [];
  for (const file of records.files) {
    relativePath(file.path);
    if (!file.path.startsWith('.git/objects/')) continue;
    const inflated = inflateSync(Buffer.from(file.base64, 'base64'), { maxOutputLength: 65536 });
    const separator = inflated.indexOf(0);
    assert.ok(separator > 0);
    const [type, size] = inflated.subarray(0, separator).toString('ascii').split(' ');
    assert.equal(String(inflated.length - separator - 1), size);
    const oid = createHash('sha1').update(inflated).digest('hex');
    assert.equal(file.path, `.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`);
    objects.push({ oid, type, bytes: Number(size) });
  }
  assert.equal(objects.length, 11); assert.equal(objects.filter(object => object.type === 'commit').length, 2);
  const index = Buffer.from(records.files.find(file => file.path === '.git/index').base64, 'base64');
  assert.equal(index.length, 184); assert.equal(index.toString('ascii', 0, 4), 'DIRC');
  assert.equal(index.readUInt32BE(4), 2); assert.equal(index.readUInt32BE(8), 2);
  assert.deepEqual(createHash('sha1').update(index.subarray(0, -20)).digest(), index.subarray(-20));
  return { objects: objects.length, commits: 2, indexBytes: index.length, files: records.files.length, directories: records.directories.length, treeSha256: records.treeSha256 };
}
