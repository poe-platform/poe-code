import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, lstatSync, openSync, readFileSync, readlinkSync, readdirSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const own = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(own, '../../..');
export const baseRelative = 'tests/integration/html-public-independent-20260827/admission-v2';
export const base = join(repository, baseRelative);
export const authorCommit = 'aa4374b0ab5f0789e51026b7c6fe163c044a9a6c';
export const candidate = 'aff899aa94ed0c57a936b08fd36d185688f5c0bb';
export const expected = Object.freeze({ seal: '82347c76a2730e7ddbab6c696c5558b657edc6b4701549505ef4e557420c6aa7', binding: '7df791cf7c7c0010af85726af9d9e78dcdebbdaff0c182fb9670be6e29b8989a', core: '446c14f2e12753b8933aa307f7ce8b0dec90dd251bbd613e64a484c26397340d', runner: '93772a99c377a950307fdbefcf5f87ed7292a89c105833c4e180a0099f95de1d', originalRunner: '3e05654ca42f8479db4ca4a66747c94d88fd8b9c7760feefc34ea85d7afe1733', inputs: '1886e217c0cf4c9f4a9c7a19a9d747fbb06660f6e201530785975cdec200c257', archive: 'cb7f6b6d68f5946c3300e28156367ba42d1af83b12cb1b4be88832c50dfbfd07', pack: 'd9c1a97388357c5cb0c810cf2fa5181dc7bebff49efe517db414a5833096eed7', hold: '3d78ae7a8967aafba3a33343d9ded8d3bb964c63d8ac1a60033750eae73c3d1e' });
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function identity(filename) {
  const stat = lstatSync(filename);
  assert.ok(stat.isFile(), filename);
  const digest = createHash('sha256'), blobDigest = createHash('sha1').update(`blob ${stat.size}\0`);
  const buffer = Buffer.alloc(65536), descriptor = openSync(filename, 'r');
  try {
    let count;
    while ((count = readSync(descriptor, buffer, 0, buffer.length, null))) {
      digest.update(buffer.subarray(0, count)); blobDigest.update(buffer.subarray(0, count));
    }
  } finally { closeSync(descriptor); }
  return { sha256: digest.digest('hex'), blob: blobDigest.digest('hex'), bytes: stat.size, mode: stat.mode & 0o111 ? '100755' : '100644' };
}
export function inventory(directory, prefix = '') {
  const result = {};
  for (const name of readdirSync(join(directory, prefix)).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    const filename = join(directory, relative), stat = lstatSync(filename);
    assert.ok(!stat.isSymbolicLink(), filename);
    if (stat.isDirectory()) Object.assign(result, inventory(directory, relative));
    else result[relative] = identity(filename);
  }
  return result;
}
export const hashes = records => Object.fromEntries(Object.entries(records).map(([name, entry]) => [name, entry.sha256]));
export function write(filename, value) { writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }); }
export function toolIdentity(filename) {
  const chain = [];
  let current = filename;
  while (lstatSync(current).isSymbolicLink()) {
    const target = readlinkSync(current); chain.push({ path: current, target }); current = resolve(dirname(current), target);
    assert.ok(chain.length < 16);
  }
  return { path: filename, chain, realpath: realpathSync(filename), ...identity(realpathSync(filename)) };
}
export async function authenticatedCore() {
  assert.equal(identity(join(base, 'core.mjs')).sha256, expected.core);
  return import(join(base, 'core.mjs'));
}
export async function authenticate() {
  const core = await authenticatedCore();
  const { entries, git, objectId, validateTree, validateLinkBytes } = core;
  const sealed = inventory(base), seal = JSON.parse(readFileSync(join(base, 'SEAL.json')));
  assert.equal(sealed['SEAL.json'].sha256, expected.seal);
  const covered = hashes(sealed); delete covered['SEAL.json']; assert.deepEqual(covered, seal.files);
  const committed = entries(repository, authorCommit, [baseRelative]);
  assert.equal(committed.length, Object.keys(sealed).length);
  for (const entry of committed) {
    const local = sealed[entry.path.slice(baseRelative.length + 1)];
    assert.equal(local.blob, entry.blob, entry.path); assert.equal(local.mode, entry.mode, entry.path);
  }
  assert.equal(sealed['binding-04/BINDINGS.json'].sha256, expected.binding);
  assert.equal(sealed['run.mjs'].sha256, expected.runner);
  const binding = JSON.parse(readFileSync(join(base, 'binding-04/BINDINGS.json')));
  assert.equal(binding.candidate, candidate); assert.equal(binding.inputs.length, 410);
  assert.equal(hash(JSON.stringify(binding.inputs)), expected.inputs);
  assert.equal(binding.archive.bytes, 2340945920); assert.equal(binding.archive.sha256, expected.archive);
  assert.equal(binding.pack.sha256, expected.pack); assert.equal(Object.keys(binding.pack.files).length, 830);
  const tree = entries(repository, candidate);
  assert.equal(tree.length, binding.fullTree.entries); assert.equal(hash(JSON.stringify(tree)), binding.fullTree.sha256);
  assert.equal(git(repository, ['rev-parse', `${candidate}^{tree}`]).toString().trim(), binding.tree);
  validateTree(tree, binding.links, binding.inputs);
  assert.deepEqual(entries(repository, candidate, binding.selectedRoots), binding.inputs.map(({ sha256: unused, ...entry }) => entry));
  assert.ok(binding.inputs.every(entry => !entry.path.split('/').includes('AGENTS.md')));
  assert.deepEqual(tree.filter(entry => entry.path.startsWith('src/')), binding.inputs.filter(entry => entry.path.startsWith('src/')).map(({ sha256: unused, ...entry }) => entry));
  const links = [];
  for (const entry of tree.filter(entry => entry.mode === '120000')) {
    const bytes = git(repository, ['cat-file', 'blob', entry.blob]); validateLinkBytes(entry, binding.links[entry.path], bytes);
    links.push({ ...entry, sha256: hash(bytes), targetBase64: bytes.toString('base64'), metadataOnly: true });
  }
  assert.equal(links.length, 12);
  const rawCommit = readFileSync(join(base, 'binding-04/candidate.commit.raw'));
  assert.equal(hash(rawCommit), binding.durability.rawCommitSha256); assert.equal(rawCommit.length, binding.durability.rawCommitBytes);
  assert.equal(objectId('commit', rawCommit), candidate);
  const delta = git(repository, ['diff-tree', '--no-commit-id', '--name-only', '-r', binding.durability.parent, candidate]).toString().trim().split('\n');
  assert.deepEqual(delta, binding.durability.delta.map(entry => entry.path)); assert.equal(delta.length, 2);
  git(repository, ['merge-base', '--is-ancestor', binding.durability.parent, binding.author]);
  const fixtures = {};
  for (const entry of binding.fixtures) {
    const actual = identity(join(repository, entry.path));
    assert.equal(actual.sha256, entry.sha256); assert.equal(actual.blob, entry.blob); assert.equal(actual.mode, entry.mode);
    const frozen = entries(repository, binding.freeze, [entry.path]);
    assert.deepEqual(frozen, entries(repository, authorCommit, [entry.path])); assert.equal(frozen[0].blob, actual.blob);
    fixtures[entry.path] = actual;
  }
  assert.equal(Object.keys(fixtures).length, 18);
  assert.equal(fixtures['tests/integration/html-public-independent-20260827/run.mjs'].sha256, expected.originalRunner);
  const holdRelative = 'tests/integration/html-public-admission-v2-independent-20260827';
  const hold = inventory(join(repository, holdRelative)); assert.equal(hold['MANIFEST.json'].sha256, expected.hold);
  const holdTree = entries(repository, 'd28083dd43c7d1b513ec195b38df2f7fd3e15b48', [holdRelative]);
  assert.equal(holdTree.length, 93); assert.equal(Object.keys(hold).length, 93);
  for (const entry of holdTree) { const actual = hold[entry.path.slice(holdRelative.length + 1)]; assert.equal(actual.blob, entry.blob); assert.equal(actual.mode, entry.mode); }
  const holdManifest = JSON.parse(readFileSync(join(repository, holdRelative, 'MANIFEST.json')));
  assert.equal(Object.keys(holdManifest.files).length, 92);
  for (const [name, entry] of Object.entries(holdManifest.files)) { assert.equal(hold[name].sha256, entry.sha256); assert.equal(hold[name].bytes, entry.bytes); }
  const readGit = relative => git(repository, ['show', `${binding.author}:${relative}`]);
  const prefix = 'tests/plugins/html-to-markdown-public-author/evidence-v1/';
  const receiptBytes = readGit(`${prefix}INDEPENDENT-BINDINGS-BLOCKED.json`);
  assert.equal(hash(receiptBytes), binding.receipt.sha256);
  assert.deepEqual(gunzipSync(Buffer.from(readFileSync(join(base, 'binding-04/receipt.json.gz.base64'), 'utf8'), 'base64'), { maxOutputLength: core.limits.metadataBytes }), receiptBytes);
  const receipt = JSON.parse(receiptBytes), authorManifest = JSON.parse(readGit(`${prefix}MANIFEST.json`));
  const compressed = Buffer.from(readGit(`${prefix}RAW.json.gz.base64`).toString(), 'base64');
  assert.equal(hash(compressed), authorManifest.compressedSha256);
  const payload = gunzipSync(compressed, { maxOutputLength: core.limits.metadataBytes });
  assert.equal(hash(payload), authorManifest.payloadSha256); assert.equal(payload.length, authorManifest.payloadBytes);
  const captures = JSON.parse(payload).entries; assert.equal(captures.length, 52);
  for (const entry of captures) { const declared = authorManifest.entries.find(value => value.name === entry.name); assert.ok(declared); const bytes = Buffer.from(entry.base64, 'base64'); assert.equal(bytes.length, declared.bytes); assert.equal(hash(bytes), declared.sha256); }
  const reportBytes = Buffer.from(captures.find(entry => entry.name === 'final/REPORT.json').base64, 'base64');
  assert.equal(hash(reportBytes), binding.report.rawSha256);
  assert.deepEqual(JSON.parse(reportBytes).inputBindings, binding.inputs);
  assert.deepEqual(receipt.packFiles, binding.pack.files);
  assert.deepEqual(tree.filter(entry => entry.mode !== '120000').map(entry => entry.path).sort(), Object.keys(receipt.packageFiles).sort());
  for (const entry of binding.inputs) assert.equal(entry.sha256, receipt.packageFiles[entry.path]);
  const tools = {};
  for (const [name, entry] of Object.entries(binding.tools)) {
    if (entry.files !== undefined) { const files = hashes(inventory(entry.path)); assert.equal(hash(JSON.stringify(files)), entry.sha256, name); assert.equal(Object.keys(files).length, entry.files); tools[name] = { ...entry, inventory: files }; }
    else { const actual = toolIdentity(entry.path); assert.equal(actual.sha256, entry.sha256, name); tools[name] = { ...entry, actual }; }
  }
  const native = Object.fromEntries(['/usr/bin/git', '/usr/bin/tar', '/bin/ps', '/usr/bin/xcrun', '/Applications/Xcode.app/Contents/Developer/usr/bin/git', '/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core/git'].map(filename => [filename, toolIdentity(filename)]));
  assert.equal(toolIdentity(process.execPath).sha256, binding.tools.node.sha256);
  return { schema: 'html-partial-auth/1', authorCommit, candidate, expected, sealed, fixtures, hold, tools, native, links, delta, selectedInputs: 410, sourceEntries: tree.filter(entry => entry.path.startsWith('src/')).length, all410InputsSha256: expected.inputs, fullTree: binding.fullTree, authenticatedAuthorCaptures: 52, originalRejection: binding.originalRejection, archiveStreamExecuted: false, scope: 'metadata and bounded protected/tool hashes; no full archive, control, materialization, compiler or reconstruction execution' };
}
