import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { identity, tree, verifyTree, durable, hash, json, NODE } from '../actual-review-v2/common.mjs';
export { identity, tree, verifyTree, durable, hash, json, NODE };
export const ROOT = fileURLToPath(new URL('.', import.meta.url));
export const REVIEW = path.resolve(ROOT, '..');
export const REPO = path.resolve(REVIEW, '../../..');
export const relative = filename => path.relative(REPO, filename);
export const gitBytes = (commit, filename) => execFileSync('git', ['show', `${commit}:${relative(filename)}`], { cwd: REPO, maxBuffer: 10000000 });
export const helpers = ['actual-review-v2/common.mjs', 'actual-review-v1/a01.mjs', 'actual-review-v1/loader.mjs', 'preparation-v2/supervisor.mjs', 'core.mjs'];
export const ownCode = ['common.mjs', 'recipe.mjs', 'worker.mjs', 'prepare.mjs', 'run.mjs', 'finish.mjs', 'PROTOCOL.md'];
export async function inputsIdentity() {
  const inputs = [];
  for (const filename of [...ownCode.map(name => path.join(ROOT, name)), ...helpers.map(name => path.join(REVIEW, name))]) inputs.push({ path: filename, ...await identity(filename) });
  return inputs;
}
export async function checkInputs(inputs) {
  for (const { path: filename, ...expected } of inputs) assert.deepEqual(await identity(filename), expected, filename);
}
export async function authenticate() {
  const inputs = [];
  const bind = async (filename, sha256) => {
    const current = await identity(filename); if (sha256) assert.equal(current.sha256, sha256, filename);
    inputs.push({ path: filename, ...current }); return json(filename);
  };
  const auditPath = path.join(REVIEW, 'source-audit-v1/SEAL.json');
  assert.equal(hash(gitBytes('e3d2cec5f4e3dbe2e06b40caf2b35f0811f0bebf', auditPath)), '9eba7bee0cc59ae4daa894f645f3f5bf341e6b5daf23bbfd719ed825f08bccd7');
  const audit = await bind(auditPath, '9eba7bee0cc59ae4daa894f645f3f5bf341e6b5daf23bbfd719ed825f08bccd7');
  for (const entry of audit.artifacts) {
    const filename = path.join(REVIEW, 'source-audit-v1', entry.path);
    assert.equal(hash(gitBytes('e3d2cec5f4e3dbe2e06b40caf2b35f0811f0bebf', filename)), entry.sha256);
    const current = await identity(filename); assert.equal(current.sha256, entry.sha256); inputs.push({ path: filename, ...current });
  }
  const pinned = await json(path.join(REVIEW, 'source-audit-v1/PINNED-INPUTS.json'));
  for (const item of pinned.inputs) {
    const bytes = gitBytes(item.revision, path.join(REPO, item.path)); assert.equal(bytes.length, item.bytes); assert.equal(hash(bytes), item.sha256);
  }
  const admissionSeal = await bind(path.join(REVIEW, 'actual-review-v1/ADMISSION-EVIDENCE-SEAL.json'), 'a7a2814fb74306da8f78fb4f8e4498ee520615e8ab011c60e7cec465cf302fd4');
  const admission = await bind(path.join(REVIEW, 'actual-review-v1/evidence/ADMISSION.json'), admissionSeal.entries.find(item => item.path === 'ADMISSION.json').sha256);
  assert.equal(admission.compositionIdentity, '4ec398bc4ae2bbbc15eb0a63b796192619087e9d0e25b8c87524ac7dff9f7df0');
  assert.equal(admission.sourceCommit, '0ec84fc38c3fafd75776d80148d4f3c2d77e6247');
  assert.equal(admission.base, '5137a74ec855a32d8a8860eb66b62eb44d11e290');
  const previousSealPath = path.join(REVIEW, 'actual-review-v2/CONTINUATION-EVIDENCE-SEAL.json');
  assert.equal(hash(gitBytes('dad2b08ce6bba02d3c404e7a55da5f4163b39d77', previousSealPath)), 'eea014240354ae976117e87f4f35fc19eaf27e7c27f0052174a1f2224b9a5ec7');
  const previousSeal = await bind(previousSealPath, 'eea014240354ae976117e87f4f35fc19eaf27e7c27f0052174a1f2224b9a5ec7');
  const emission = await bind(path.join(REVIEW, 'actual-review-v2/evidence-continuation/EMISSION.json'), previousSeal.entries.find(item => item.path === 'EMISSION.json').sha256);
  assert.equal(emission.comparisons.length, 442); assert.ok(emission.comparisons.every(item => item.equal));
  const packedPath = path.join(REVIEW, 'actual-review-v1/evidence/virtual-bash-0.0.0.tgz');
  const packed = await identity(packedPath); assert.equal(packed.sha256, '324268096450f0133265b7003140139fc5118e9e4a39d43ca856ce214918bac7'); inputs.push({ path: packedPath, ...packed });
  assert.equal((await identity(NODE)).sha256, '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
  inputs.push({ path: NODE, ...await identity(NODE) });
  const previousRecipe = await bind(path.join(REVIEW, 'actual-review-v2/PRE-SEAL.json'), '788160ad07652b3c6f71915348a91ad01d1a6ef042b2572e71b3d51819d648c1');
  for (const helper of helpers) {
    const filename = path.join(REVIEW, helper); const expected = previousRecipe.inputs.find(item => item.path === filename);
    assert.ok(expected, `previously sealed helper ${helper}`); const { path: ignored, ...details } = expected; assert.deepEqual(await identity(filename), details);
  }
  const roots = [
    { name: 'source', root: path.join(REVIEW, 'actual-review-v1/work/source'), entries: admission.source },
    { name: 'tools', root: path.join(REVIEW, 'actual-review-v1/work/tools'), entries: admission.tools },
    { name: 'INSTALLED_MOVED', root: path.join(REVIEW, 'actual-review-v1/work/installed-moved'), entries: admission.installed },
    { name: 'SOURCE', root: path.join(REVIEW, 'actual-review-v2/build-continuation'), entries: emission.entries },
  ];
  for (const root of roots) await verifyTree(root.root, root.entries);
  const sourceFiles = admission.source.filter(item => !item.directory); assert.equal(sourceFiles.length, 225);
  for (const item of sourceFiles) assert.equal(hash(gitBytes(item.path.startsWith('src/commands/xan/') ? admission.sourceCommit : admission.base, path.join(REPO, item.path))), item.sha256);
  assert.equal(admission.tools.filter(item => !item.directory).length, 313);
  assert.equal(admission.installed.filter(item => !item.directory).length, 885);
  const layouts = [];
  for (const root of roots.filter(item => ['SOURCE', 'INSTALLED_MOVED'].includes(item.name))) {
    const builtinMap = {};
    for (const entry of root.entries.filter(item => item.path.endsWith('.js'))) {
      const text = await readFile(path.join(root.root, entry.path), 'utf8');
      builtinMap[entry.path] = [...new Set([...text.matchAll(/(?:from\s*|import\s*\()?["'](node:[^"']+)["']/g)].map(match => match[1]))];
    }
    const leaf = await identity(path.join(root.root, 'dist/commands/xan/index.js'));
    assert.equal(leaf.bytes, 6090); assert.equal(leaf.sha256, '24ad84b3992640bb386e6205c6eccccac21e2a1b8b1f888dd9d30c0fe702a2b3');
    layouts.push({ ...root, builtinMap, leaf });
  }
  return { inputs, roots, layouts, audit: audit.candidate, inventory: admission.compositionIdentity, packed, sourceFiles: 225, toolFiles: 313, movedFiles: 885, matchedEmission: 442 };
}
