import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { holdouts } from './holdouts.mjs';

const scope = dirname(fileURLToPath(import.meta.url));
const parent = resolve(scope, '..');
const repository = resolve(scope, '../../../..');
const prefix = 'tests/commands/timeout-independent-20260828';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const get = target => JSON.parse(fs.readFileSync(target));
const nodePath = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const nodeSha = '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011';
const gitPath = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const gitSha = '10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9';
assert.equal(process.execPath, nodePath);
assert.equal(hash(fs.readFileSync(nodePath)), nodeSha);
assert.equal(hash(fs.readFileSync(gitPath)), gitSha);
const manifests = [
  { name: 'MANIFEST.json', commit: '8843c519c23ad529677d51811f3acd370e53dffb', sha256: '2ca5e729a8f9c1bb4aeee0d3420f55d9a897175be871fc2a8fd587907efae765' },
  { name: 'EVIDENCE-MANIFEST.json', commit: '0e83ced9ef58f95dc49e1ecbd5d18a7995d9f35f', sha256: '48f8fe43b57901023eed1363c5fea9cf8e06dff2bcdb3c017b9af2d86bdf9b73' },
];
let gitReturns = 0;
function gitBytes(commit, path) {
  assert.ok(!path.split('/').some(part => ['AGENTS.md', '.', '..', ''].includes(part)));
  const bytes = execFileSync(gitPath, ['--no-replace-objects', '--no-optional-locks', '-C', repository, 'show', `${commit}:${path}`], { timeout: 15000, maxBuffer: 1024 ** 2, env: { PATH: '/usr/bin:/bin', HOME: scope, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' } });
  gitReturns++;
  return bytes;
}
for (const manifest of manifests) {
  assert.equal(hash(fs.readFileSync(join(parent, manifest.name))), manifest.sha256);
  assert.equal(hash(gitBytes(manifest.commit, `${prefix}/${manifest.name}`)), manifest.sha256);
  for (const [path, digest] of Object.entries(get(join(parent, manifest.name)).files)) {
    assert.ok(fs.lstatSync(join(parent, path)).isFile());
    assert.equal(hash(fs.readFileSync(join(parent, path))), digest, path);
    assert.equal(hash(gitBytes(manifest.commit, `${prefix}/${path}`)), digest, path);
  }
}
const original = await import('../families.mjs');
assert.equal(original.families.length, 32);
assert.deepEqual(holdouts.map(row => row.id), ['PC01', 'PC02']);
for (const holdout of holdouts) {
  assert.equal(holdout.status, 'FROZEN-PROSPECTIVE-NOT-EXECUTED');
  for (const family of holdout.supplements) assert.ok(original.families.some(row => row.id === family));
}
const references = get(join(parent, 'BINDINGS.json')).references.filter(row => /\/(?:api|profile)\.json$/u.test(row.path) && row.commit === '257bf6d7fe51b03c224fbca7e91519e692bfadd3');
assert.equal(references.length, 2);
for (const row of references) {
  assert.equal(hash(fs.readFileSync(join(repository, row.path))), row.sha256);
  assert.equal(hash(gitBytes(row.commit, row.path)), row.sha256);
}
const names = ['README.md', 'holdouts.mjs', 'seal.mjs'];
assert.deepEqual(fs.readdirSync(scope).sort(), names.toSorted());
const files = Object.fromEntries(names.map(name => [name, hash(fs.readFileSync(join(scope, name)))]));
const receipt = { schema: 'timeout-independent-additive-priority-holdouts/1', sealedAt: new Date().toISOString(), chronology: 'post-author-release; timeout source not inspected; pre-source ordering unknown and not claimed; pre-independent-execution', originalManifests: manifests, originalCounts: { families: 32, numeric: 70, diagnostic: 14, developmentControls: 16 }, additiveHoldouts: 2, implementationInspections: 0, productExecutions: 0, nativeExecutions: 0, newHelperControlExecutions: 0, futureActivationUnproved: ['PC01', 'PC02'], references, tools: [{ path: nodePath, sha256: nodeSha }, { path: gitPath, sha256: gitSha }], naturalSynchronousGitReturns: gitReturns, actualCasesPassing: 0, files };
const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
const descriptor = fs.openSync(join(scope, 'MANIFEST.json'), 'wx');
try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
console.log(JSON.stringify({ sha256: hash(bytes), additiveHoldouts: 2, productExecutions: 0, originalFamiliesUnchanged: 32, gitReturns }));
