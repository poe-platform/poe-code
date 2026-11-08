import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { own, repo, work, root, old, oldOwner, candidate, accepted, node, hash, json, git, write, save, inventory, immutable, oldBoundary, captures, protectedLive, privateShape, frozenFiles, fixtureBinding } from './common.mjs';

assert(!fs.existsSync(work), 'Use a new bounded capture; never overwrite');
assert(!fs.existsSync(path.join(own, 'FREEZE.json')));
const boundary = oldBoundary();
const fixture = fixtureBinding();
const protection = protectedLive();
const { manifest, binding, publicBinding } = captures();
assert.equal(binding.candidate, candidate);
assert.equal(git('rev-parse', `${candidate}^{tree}`).toString().trim(), publicBinding.candidateTree);
assert.equal(process.execPath, node);
assert.equal(hash(fs.readFileSync(node)), publicBinding.nodeSha256);
const dependencies = {};
const helper = path.join(work, 'helpers');
for (const name of ['harness/common.mjs', 'harness/safejs-binding.mjs', 'profiles/REFERENCES.json', 'profiles/SAFEJS.json', 'safejs-execution-v1/private-guard.mjs', 'safejs-execution-v1/loader.mjs']) {
  const original = git('show', `${candidate}:${oldOwner}/${name}`);
  let bytes = original;
  if (name === 'harness/safejs-binding.mjs') {
    const needle = 'assert.ok(root.startsWith("/private/tmp/"), "Use resolved regular TMP; never private source or live product roots");';
    assert.equal(original.toString().split(needle).length, 2);
    bytes = Buffer.from(original.toString().replace(needle, `assert.equal(root, ${JSON.stringify(root)}, "Exact owned regular root; no private/live fallback");`));
  }
  dependencies[name] = { originalSHA256: hash(original), copiedSHA256: hash(bytes), commit: candidate };
  write(path.join(helper, name), bytes);
}
const support = await import(pathToFileURL(path.join(helper, 'harness/common.mjs')));
const hostBinding = await import(pathToFileURL(path.join(helper, 'harness/safejs-binding.mjs')));
const guard = await import(pathToFileURL(path.join(helper, 'safejs-execution-v1/private-guard.mjs')));
const before = guard.privateSnapshot();
save(path.join(work, 'private-preparation-before.json'), before);
try {
guard.verifyPrivatePrecondition(before);
const shape = privateShape();
save(path.join(work, 'private-shape.json'), shape);
guard.copyActualEngine(before, path.join(root, 'engine'));
const archive = gunzipSync(fs.readFileSync(path.join(old, 'evidence-v1/candidate.tar.gz')));
assert.equal(hash(archive), binding.archiveSHA256);
assert.equal(hash(archive), manifest.candidateArchiveRawSHA256);
write(path.join(work, 'candidate.tar'), archive);
fs.mkdirSync(path.join(work, 'source'));
execFileSync('/usr/bin/tar', ['-xf', path.join(work, 'candidate.tar'), '-C', path.join(work, 'source')]);
const actualSource = inventory(path.join(work, 'source'));
assert.deepEqual(actualSource.map(entry => entry.path + (entry.kind === 'directory' ? '/' : '')).sort(), Object.keys(binding.sourceBefore).sort());
for (const entry of actualSource.filter(entry => entry.kind === 'file')) assert.equal(entry.sha256, binding.sourceBefore[entry.path].sha256, entry.path);
const packed = fs.readFileSync(path.join(old, 'evidence-v1/public-package.tgz'));
assert.equal(hash(packed), '08667ba7a67c5e9342c062007265279965138afe99c700f756df3e8ec97533f3');
write(path.join(work, 'public-package.tgz'), packed);
const pending = path.join(root, 'consumer-pending');
save(path.join(pending, 'package.json'), { private: true, type: 'module' });
for (const name of ['home', 'tmp', 'logs']) fs.mkdirSync(path.join(root, name), { recursive: true });
const environment = { PATH: `${path.dirname(node)}:/usr/bin:/bin`, HOME: path.join(root, 'home'), TMPDIR: path.join(root, 'tmp'), npm_config_cache: path.join(work, 'npm-cache'), npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
const npm = '/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm/bin/npm-cli.js';
const install = execFileSync(node, [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', path.join(work, 'public-package.tgz')], { cwd: pending, env: environment, timeout: 30000, maxBuffer: 1024 * 1024 });
write(path.join(work, 'install.stdout'), install);
dependencies.npm = { path: npm, sha256: hash(fs.readFileSync(npm)), use: 'Offline pre-execution install only; not engine dependency' };
fs.renameSync(pending, path.join(root, 'consumer'));
assert(!fs.existsSync(pending));
assert.deepEqual(inventory(path.join(root, 'consumer/node_modules/virtual-bash')), publicBinding.packageEntries);
support.copyTree(path.join(repo, 'node_modules/typescript'), path.join(root, 'node_modules/typescript'), publicBinding.compilerEntries);
write(path.join(root, 'tools/bin/node'), fs.readFileSync(node), 0o755);
for (const name of ['child.mjs', 'G2.guest.txt']) write(path.join(root, 'consumer/harness', name), fs.readFileSync(path.join(own, name)));
const guardPath = `${hostBinding.frozenAuthor}/lifecycle/guard.mjs`;
const capabilityGuard = hostBinding.referenceBytes(guardPath);
write(path.join(root, 'consumer/harness/guard.mjs'), capabilityGuard);
dependencies.capabilityGuard = { path: guardPath, sha256: hash(capabilityGuard), unchanged: true };
write(path.join(root, 'loader.mjs'), fs.readFileSync(path.join(helper, 'safejs-execution-v1/loader.mjs')));
write(path.join(root, 'witness-loader.mjs'), fs.readFileSync(path.join(own, 'witness-loader.mjs')));
const imports = hostBinding.makeCurrentImportBinding({ candidateCommit: candidate, candidateTree: publicBinding.candidateTree, authorCommit: accepted, root, productEntries: publicBinding.packageEntries, compilerEntries: publicBinding.compilerEntries, engineEntries: before.engine.map(({ path: filename, bytes, sha256 }) => ({ path: filename, bytes, sha256 })), driverEntries: inventory(path.join(root, 'consumer/harness')) });
for (const name of ['loader.mjs', 'witness-loader.mjs']) { const bytes = fs.readFileSync(path.join(root, name)); imports.files.push({ path: name, bytes: bytes.length, sha256: hash(bytes), kind: 'test-loader' }); }
save(path.join(root, 'CURRENT-IMPORTS.json'), imports);
const after = guard.privateSnapshot();
assert.deepEqual(after, before);
assert.deepEqual(privateShape(), shape);
save(path.join(work, 'private-preparation-after.json'), after);
const entries = immutable();
const freeze = { format: 'safejs-getopts-g2-correction-freeze-v1', candidate, accepted, frozenAt: new Date().toISOString(), productExecutionsBeforeFreeze: 0, engineExecutionsBeforeFreeze: 0, chronology: 'Existing component and guest API inspected first; dependencies copied but not executed', inputs: Object.fromEntries(frozenFiles.map(name => [name, hash(fs.readFileSync(path.join(own, name)))])), boundary, protection, dependencies, candidateTree: publicBinding.candidateTree, sourceArchiveSHA256: hash(archive), sourceFiles: actualSource.filter(entry => entry.kind === 'file').length, packageSHA256: hash(packed), packageInventorySHA256: hash(JSON.stringify(publicBinding.packageEntries)), compilerInventorySHA256: hash(JSON.stringify(publicBinding.compilerEntries)), nodeSHA256: publicBinding.nodeSha256, privateSnapshotSHA256: hash(JSON.stringify(before)), privateShapeSHA256: hash(JSON.stringify(shape)), immutableSHA256: hash(JSON.stringify(entries)), immutableEntries: entries.length, importBindingSHA256: hash(fs.readFileSync(path.join(root, 'CURRENT-IMPORTS.json'))), probes: [{ id: 'G2', guestAssertions: 7, builtinCalls: 5, bridgeCalls: 2 }], scope: 'Exactly one corrected G2 execution; previous G1/G2 outcomes untouched; no G1 replay, third case or generic25' };
save(path.join(own, 'FREEZE.json'), { ...freeze, fixture });
console.log(JSON.stringify({ prepared: true, productExecutions: 0, engineExecutions: 0, immutableEntries: entries.length, privateUnchanged: true }));
} catch (error) {
  const afterFailure = guard.privateSnapshot();
  save(path.join(work, 'private-preparation-failure.json'), afterFailure);
  assert.deepEqual(afterFailure, before);
  throw error;
}
