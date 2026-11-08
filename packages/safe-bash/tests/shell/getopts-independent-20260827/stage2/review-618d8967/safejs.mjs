import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { own, work, candidate, hash, git, write, save, run } from './harness.mjs';

const packed = JSON.parse(fs.readFileSync(path.join(work, 'PACKAGE.json')));
const sourceBinding = JSON.parse(fs.readFileSync(path.join(work, 'BINDING.json')));
const root = path.join(work, 'safejs');
assert(!fs.existsSync(root));
fs.mkdirSync(root);
const owner = 'tests/integration/owned-output-production-rebase/author-public';
const originals = {};
for (const name of ['harness/common.mjs', 'profiles/REFERENCES.json', 'profiles/SAFEJS.json', 'execution-v1/archive-binding.mjs', 'safejs-execution-v1/loader.mjs', 'safejs-execution-v1/private-guard.mjs', 'safejs-execution-v1/surface-assessment.mjs']) {
  const bytes = git('show', `${candidate}:${owner}/${name}`);
  originals[name] = hash(bytes);
  write(path.join(root, name), bytes);
}
const bindingOriginal = git('show', `${candidate}:${owner}/harness/safejs-binding.mjs`).toString();
originals['harness/safejs-binding.mjs'] = hash(bindingOriginal);
const locationGuard = 'assert.ok(root.startsWith("/private/tmp/"), "Use resolved regular TMP; never private source or live product roots");';
assert.equal(bindingOriginal.split(locationGuard).length, 2);
const bindingAdapted = bindingOriginal.replace(locationGuard, `assert.ok(root.startsWith(${JSON.stringify(root + '/')}), "Exact owned regular replay root required; no private/live fallback");`);
write(path.join(root, 'harness/safejs-binding.mjs'), bindingAdapted);
const original = git('show', `${candidate}:${owner}/safejs-execution-v1/supervisor.mjs`).toString();
originals['safejs-execution-v1/supervisor.mjs'] = hash(original);
const start = original.indexOf('export function verifySafeJsFreeze()');
const end = original.indexOf('function auditImports(');
assert(start > 0 && end > start);
let adapted = original.slice(0, start) + `export function verifySafeJsFreeze() {
  const freeze = json(join(current, "ADAPTED-INPUTS.json"));
  for (const entry of freeze.files) assert.equal(sha256(regular(join(current, "..", entry.path))), entry.sha256, entry.path);
  return { commit: freeze.candidate, manifestSha256: sha256(regular(join(current, "ADAPTED-INPUTS.json"))), qualification: freeze.qualification };
}
function publicGuards(binding) {
  assert.equal(git("rev-parse", binding.candidateCommit + "^{tree}").toString().trim(), binding.candidateTree);
  assert.equal(hashFile(binding.nodePath), binding.nodeSha256);
  assert.equal(hashFile(binding.archivePath), binding.archiveSha256);
  assert.deepEqual(inventory(binding.sourceRoot), binding.sourceEntries);
  assert.deepEqual(inventory(binding.packageRoot), binding.packageEntries);
  assert.deepEqual(inventory(binding.compilerRoot), binding.compilerEntries);
  return { candidateCommit: binding.candidateCommit, candidateTree: binding.candidateTree, sourceManifestSha256: binding.sourceManifestSha256, selectedArchiveSourceAndInstalledMovedPackageUnchangedIncludingNewEntries: true };
}
` + original.slice(end);
const oldTemp = 'mkdtempSync(`/tmp/safe-bash-author-current-safejs-${family}-`)';
assert.equal(adapted.split(oldTemp).length, 2);
adapted = adapted.replace(oldTemp, 'mkdtempSync(join(binding.work, `cohort-${family}-`))');
write(path.join(root, 'safejs-execution-v1/supervisor.mjs'), adapted);
const { inventory } = await import(pathToFileURL(path.join(root, 'harness/common.mjs')));
const node = '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node';
const compilerRoot = path.join(work, 'source/node_modules/typescript');
const sourceRoot = path.join(work, 'source/src');
const sourceEntries = inventory(sourceRoot);
const binding = { candidateCommit: candidate, candidateTree: sourceBinding.candidateTree, sourceRoot, sourceEntries, sourceManifestSha256: hash(JSON.stringify(sourceEntries)), packageRoot: packed.product, packageEntries: inventory(packed.product), compilerRoot, compilerEntries: inventory(compilerRoot), nodePath: node, nodeSha256: hash(fs.readFileSync(node)), archivePath: path.join(work, 'candidate.tar'), archiveSha256: sourceBinding.archiveSHA256, work: root };
save(path.join(root, 'safejs-execution-v1/PUBLIC-BINDING.json'), binding);
const files = inventory(root).filter(entry => entry.kind === 'file').map(({ path, sha256 }) => ({ path, sha256 }));
save(path.join(root, 'safejs-execution-v1/ADAPTED-INPUTS.json'), { candidate, qualification: 'INDEPENDENT_REPLAY_OF_EXISTING_QUALIFIED_PROFILES_NOT_BLIND_GUEST_CAPABILITY_PROOF', originalFiles: originals, adaptations: ['Exact immutable current candidate/archive/installed-moved-package/compiler/node binding instead of historical author-release guard', 'Task-only regular scratch under owned subtree', 'Narrow original temporary-prefix precondition to exact owned replay prefix; loader/private/guest/case/closure/worker guards unchanged'], files });
const rows = [];
for (const family of ['surface', 'lifecycle', 'controls']) {
  const result = await run(`safejs-${family}`, [node, path.join(root, 'safejs-execution-v1/supervisor.mjs'), family], root, { timeout: 180000 });
  rows.push(result);
  if (result.status !== 0) break;
}
save(path.join(work, 'SAFEJS.json'), { candidate, rows, originals, beforeAfterGuardLocation: path.join(root, 'cohort-*/evidence'), noPrivateWrites: true, qualification: 'Existing profiles replayed independently; inspect actual guest results separately from qualified refusal/control PASS.' });
if (rows.length !== 3 || rows.some(row => row.status !== 0)) process.exitCode = 1;
