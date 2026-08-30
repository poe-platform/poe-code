import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv.length !== 3 || process.argv[2] !== '--inspect') {
  throw new Error('HELD: v1 supports --inspect only; HTML74 acceptance, full pack reproduction and root bindings remain unresolved. No admission or execution API.');
}

const directory = dirname(fileURLToPath(import.meta.url));
const repository = join(directory, '../../..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const json = filename => JSON.parse(readFileSync(join(directory, filename), 'utf8'));
const prepared = json('preparation.v1.json');
const manifest = json('MANIFEST.json');

function regular(filename) {
  assert.ok(lstatSync(filename).isFile() && !lstatSync(filename).isSymbolicLink(), `regular input: ${filename}`);
  return readFileSync(filename);
}

function walk(root) {
  return readdirSync(root).sort().flatMap(name => {
    const filename = join(root, name);
    const stat = lstatSync(filename);
    assert.ok(!stat.isSymbolicLink(), `no input symlink: ${filename}`);
    if (stat.isDirectory()) return walk(filename);
    assert.ok(stat.isFile(), `regular input: ${filename}`);
    return [filename];
  });
}

assert.deepEqual(manifest.excluded, ['MANIFEST.json']);
const files = walk(directory).map(filename => relative(directory, filename));
assert.deepEqual(manifest.files.map(entry => entry.path), files.filter(filename => filename !== 'MANIFEST.json'));
assert.equal(manifest.count, manifest.files.length);
for (const entry of manifest.files) {
  assert.ok(!/(^|\/)AGENTS\.md$|\.(?:ts|mts|cts|tsx)$/u.test(entry.path));
  const bytes = regular(join(directory, entry.path));
  assert.equal(bytes.length, entry.bytes);
  assert.equal(sha256(bytes), entry.sha256, entry.path);
  assert.equal(gitBlob(bytes), entry.gitBlob, entry.path);
  assert.equal(entry.mode, '100644');
  assert.equal(lstatSync(join(directory, entry.path)).mode & 0o111, 0);
}
assert.equal(prepared.schemaVersion, 1);
assert.equal(prepared.state, 'preparation-only');
assert.equal(prepared.mode, 'scoped-committed-archive');
assert.equal(prepared.admitted, false);
assert.equal(prepared.actualDuCasesExecuted, 0);
assert.equal(prepared.heldDuCases, 29);
assert.equal(prepared.fullHistoryArchiveProof, false);
assert.ok(Object.values(prepared.unresolved).every(value => value === null));
assert.equal(prepared.oldFreeze.commit, '1bd1048b0075adf9ee1ebf041e299122f72c3459');
assert.equal(prepared.oldFreeze.manifestSha256, 'b180b9a384bdc3d257b243d315027a59ae792865a572b877dbe547f99149f6ff');
assert.equal(prepared.sourceCommit, 'b2b4604f09f351d8130c0f2a3349e85f4b4c45e1');
assert.equal(prepared.candidateCommit, '0895de2dc63014989f23912c3d48f7c4d0d35a47');
assert.equal(prepared.handoff.commit, 'f397901033d47537a5671bfc202cd8111902b526');
assert.equal(prepared.handoff.sha256, '1ff91fcf815f57a895bf46d4aeca8e5da488971d918009dbb1d24b356e7f5b8a');

for (const tool of prepared.staticTools) {
  assert.equal(realpathSync(tool.path), tool.realpath);
  assert.equal(sha256(regular(tool.realpath)), tool.sha256, tool.path);
}
assert.equal(realpathSync(process.execPath), prepared.staticTools.find(tool => tool.role === 'node').realpath);
assert.equal(process.version, prepared.staticTools.find(tool => tool.role === 'node').version);
const gitTool = prepared.staticTools.find(tool => tool.role === 'git');
const git = (...args) => execFileSync(gitTool.realpath, ['--no-replace-objects', '-C', repository, ...args], {
  env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' },
  maxBuffer: 64 * 1024 * 1024,
});
assert.equal(git('--version').toString().trim(), gitTool.version);

function entries(commit, selectors) {
  return git('ls-tree', '-rz', commit, '--', ...selectors).toString().split('\0').filter(Boolean).map(line => {
    const [metadata, filename] = line.split('\t');
    const [mode, type, blob] = metadata.split(' ');
    assert.equal(type, 'blob');
    assert.ok(['100644', '100755'].includes(mode), filename);
    assert.ok(!filename.startsWith('/') && !filename.split('/').some(part => ['', '.', '..', 'AGENTS.md'].includes(part)));
    return { path: filename, mode, type, gitBlob: blob };
  });
}

function reference(identity) {
  const selected = entries(identity.commit, [identity.path]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].path, identity.path);
  assert.equal(selected[0].mode, identity.mode);
  assert.equal(selected[0].gitBlob, identity.gitBlob);
  const bytes = git('cat-file', 'blob', identity.gitBlob);
  assert.equal(gitBlob(bytes), identity.gitBlob);
  assert.equal(sha256(bytes), identity.sha256);
  return bytes;
}

function oldFreeze() {
  const frozen = prepared.oldFreeze;
  const selected = entries(frozen.commit, [frozen.directory]);
  assert.equal(selected.length, 15);
  assert.deepEqual(walk(join(repository, frozen.directory)).map(filename => relative(repository, filename)), selected.map(entry => entry.path).sort());
  const records = selected.map(entry => {
    const bytes = regular(join(repository, entry.path));
    assert.equal(lstatSync(join(repository, entry.path)).mode & 0o111, 0);
    assert.equal(entry.mode, '100644');
    assert.equal(gitBlob(bytes), entry.gitBlob);
    assert.deepEqual(bytes, git('cat-file', 'blob', entry.gitBlob));
    return { path: entry.path, mode: entry.mode, sha256: sha256(bytes) };
  });
  assert.equal(sha256(regular(join(repository, frozen.directory, 'MANIFEST.json'))), frozen.manifestSha256);
  assert.equal(sha256(JSON.stringify(records)), frozen.treeRecordsSha256);
  return { files: selected.length, manifestSha256: frozen.manifestSha256, treeRecordsSha256: frozen.treeRecordsSha256 };
}

const pre = oldFreeze();
const handoff = JSON.parse(reference(prepared.handoff));
assert.equal(handoff.candidateCommit, prepared.candidateCommit);
assert.equal(handoff.sourceCommit, prepared.sourceCommit);
assert.equal(handoff.candidateTree, git('rev-parse', `${prepared.candidateCommit}^{tree}`).toString().trim());
assert.equal(handoff.admissionPolicy.mode, prepared.mode);
assert.equal(handoff.rootReplayAuthorization, null);
const inventory = handoff.sourceInventory;
assert.equal(inventory.length, 771);
assert.equal(prepared.inventory.pointer, '/sourceInventory');
assert.equal(prepared.inventory.count, inventory.length);
assert.equal(prepared.inventory.jsonSha256, sha256(JSON.stringify(inventory)));
assert.equal(new Set(inventory.map(entry => entry.path)).size, inventory.length);
assert.deepEqual(entries(prepared.candidateCommit, prepared.selectors), inventory.map(({ path, mode, type, gitBlob }) => ({ path, mode, type, gitBlob })));
for (const entry of inventory) {
  assert.equal(entry.mode, '100644');
  const bytes = git('cat-file', 'blob', entry.gitBlob);
  assert.equal(gitBlob(bytes), entry.gitBlob);
  assert.equal(sha256(bytes), entry.sha256, entry.path);
}
assert.deepEqual(entries(prepared.sourceCommit, prepared.productSelectors), entries(prepared.candidateCommit, prepared.productSelectors));
for (const identity of prepared.references) reference(identity);
assert.deepEqual(prepared.lifecycleMapping, handoff.outputOperationIntegration);
assert.equal(Object.keys(prepared.lifecycleMapping).length, 10);
const template = JSON.parse(regular(join(repository, prepared.oldFreeze.directory, 'bindings.template.json')));
assert.deepEqual(prepared.fixedScope, template.fixedScope);
assert.deepEqual(Object.keys(prepared.bindingMapping).sort(), Object.keys(template.required).sort());
assert.equal(Object.keys(prepared.bindingMapping).length, 14);
assert.equal(prepared.fullPack.sha256, handoff.package.tarballSha256);
assert.equal(prepared.fullPack.sha256, '4d4d071a0142ac950240f7c3aaacd5283777143d70cc2e3c245ba199fdd01c7d');
assert.equal(Object.keys(handoff.packageFiles).length, prepared.fullPack.packageFiles);
assert.equal(Object.keys(handoff.emittedFiles).length, prepared.fullPack.emittedFiles);
assert.equal(prepared.fullPack.reproductionExecuted, false);
const controls = json('controls.v1.json');
assert.equal(controls.role, 'frozen-control-specification-only');
assert.equal(controls.executed, false);
assert.equal(controls.controls.length, 11);
assert.equal(new Set(controls.controls.map(control => control.id)).size, 11);
for (const control of controls.controls) {
  assert.ok(['positive', 'negative'].includes(control.kind));
  assert.ok(control.input.length > 0 && control.expect.length > 0);
}
const post = oldFreeze();
assert.deepEqual(post, pre);
console.log(JSON.stringify({ kind: 'static-preparation-only', mode: prepared.mode, admitted: false, oldFreezePre: pre, oldFreezePost: post, pinnedInputsAuthenticated: inventory.length, heldDuCases: 29, actualDuCasesExecuted: 0, admissionControlsExecuted: 0, packReproductionExecuted: false, rssRerun: false, files: files.length, manifestSha256: sha256(readFileSync(join(directory, 'MANIFEST.json'))) }, null, 2));
