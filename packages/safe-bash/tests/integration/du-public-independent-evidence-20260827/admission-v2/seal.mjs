import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { release } from 'node:os';
import { repository, owned, recipeRoot, runRoot, nodeBinary, gitBinary, preparationCommit, originalSix, sha256, gitBlob, regular, json, census, entries, authenticateReference, git } from './common.mjs';

assert.deepEqual(process.argv.slice(2), ['--bind-read-only-inputs']);
assert.ok(!existsSync(join(recipeRoot, 'MANIFEST.json')), 'one seal only');
assert.ok(!existsSync(runRoot), 'no prefreeze run');
const prepared = json(join(repository, owned, 'preparation.v1.json'));
const handoff = JSON.parse(authenticateReference(prepared.handoff));
const protectedFiles = [];
for (const [commit, selectors, count] of [[preparationCommit, originalSix.map(name => `${owned}/${name}`), 6], [prepared.oldFreeze.commit, [prepared.oldFreeze.directory], 15]]) {
  const selected = entries(commit, selectors);
  assert.equal(selected.length, count);
  for (const entry of selected) {
    const bytes = regular(join(repository, entry.path));
    assert.equal(entry.mode, '100644');
    assert.equal(lstatSync(join(repository, entry.path)).mode & 0o777, 0o644);
    assert.equal(gitBlob(bytes), entry.gitBlob);
    assert.deepEqual(bytes, git('cat-file', 'blob', entry.gitBlob));
    protectedFiles.push({ ...entry, sha256: sha256(bytes), bytes: bytes.length });
  }
}
assert.equal(sha256(regular(join(repository, owned, 'MANIFEST.json'))), '60ccba645eb197746cd13ff2bd92d1b213affce9a896c275913e531a55b21763');
assert.equal(sha256(regular(join(repository, prepared.oldFreeze.directory, 'MANIFEST.json'))), prepared.oldFreeze.manifestSha256);
const binaries = [nodeBinary, gitBinary].map(filename => ({ path: filename, realpath: realpathSync(filename), mode: lstatSync(filename).mode & 0o777, bytes: lstatSync(filename).size, sha256: sha256(regular(filename)) }));
assert.equal(binaries[0].sha256, '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
binaries[0].version = process.version;
binaries[1].version = git('--version').toString().trim();
const packages = [
  ['npm', '/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm', 'tools/npm', true],
  ['typescript', join(repository, 'node_modules/typescript'), 'candidate/node_modules/typescript', false],
  ['@types/node', join(repository, 'node_modules/@types/node'), 'candidate/node_modules/@types/node', false],
  ['undici-types', join(repository, 'node_modules/undici-types'), 'candidate/node_modules/undici-types', false],
].map(([name, root, destination, allowLinks]) => ({ name, root, realpath: realpathSync(root), rootMode: lstatSync(root).mode & 0o777, destination, version: json(join(root, 'package.json')).version, records: census(root, allowLinks) }));
const npmLauncher = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/npm';
const closure = { host: { platform: process.platform, arch: process.arch, release: release() }, binaries, npmLauncher: { path: npmLauncher, mode: lstatSync(npmLauncher).mode & 0o777, link: readlinkSync(npmLauncher), realpath: realpathSync(npmLauncher), targetMode: lstatSync(realpathSync(npmLauncher)).mode & 0o777, targetSha256: sha256(regular(realpathSync(npmLauncher))) }, packages, aliasPolicy: 'Bind symlink metadata and regular target bytes; do not copy or execute npm launcher aliases. All candidate/build inputs must be regular files.' };
const pack = regular(handoff.package.authorArtifactPath);
assert.equal(pack.length, 726693);
assert.equal(sha256(pack), prepared.fullPack.sha256);
const controlsBytes = regular(join(repository, owned, 'controls.v1.json'));
const definitions = JSON.parse(controlsBytes).controls;
const held = ['A06', 'P03'];
const registry = { definitionsReference: { path: `${owned}/controls.v1.json`, commit: preparationCommit, sha256: sha256(controlsBytes) }, controls: definitions.map(definition => ({ definition, execution: held.includes(definition.id) ? 'HELD-unexecuted-no-pass' : 'applicable', body: held.includes(definition.id) ? null : `executor.mjs#${definition.id}` })), specified: 11, applicable: 9, held: 2, originalBindingMapping: prepared.bindingMapping, originalFixedScope: prepared.fixedScope, originalLifecycleMapping: prepared.lifecycleMapping };
const recipe = {
  schemaVersion: 2, mode: 'scoped-committed-archive', fullHistoryArchiveProof: false, oldValidatorDispatched: false, transientRelabel: false,
  authorization: { role: 'admission-only execution authorization from current user delegation, not HTML/public acceptance', preparationCommit, candidateCommit: prepared.candidateCommit, sourceCommit: prepared.sourceCommit, originalFreezeCommit: prepared.oldFreeze.commit, publicReplayAuthorized: false, acceptedHtml74: null, publicExecutor: null },
  outputDirectory: runRoot, isolation: `${runRoot}/node_modules/work`, protectedFiles,
  pack: { path: handoff.package.authorArtifactPath, bytes: pack.length, mode: lstatSync(handoff.package.authorArtifactPath).mode & 0o777, sha256: sha256(pack), packageMembers: 834, emittedFiles: 832 },
  bounds: { maxSingleFileBytes: 167772160, maxGitBufferBytes: 33554432, maxChildOutputBytes: 8388608, maxChildChunkBytes: 1048576, maxObservationBytes: 33554432, maxInflatedTarBytes: 33554432, maxDiskBytes: 536870912, maxTreeEntries: 12000, maxChildren: 4096, concurrentChildren: 1, gitTimeoutMs: 15000, buildTimeoutMs: 180000, packTimeoutMs: 120000, totalTimeoutMs: 900000, nodeOldSpaceMiB: 512, watchdogPollMs: 250, terminationGraceMs: 2000 },
  order: ['pre-authentication', 'S01', 'A01', 'A02', 'A03', 'A04', 'A05', 'A07', 'P01', 'P02', 'authenticate-all-771', 'materialize-all-771', 'stage-exact-tool-closure', 'build', 'compare-dist-832', 'pack', 'compare-whole-pack-834', 'post-authentication', 'archive-own-scratch', 'cleanup-settlement'],
  commands: { build: [nodeBinary, '--max-old-space-size=512', '--require', `${recipeRoot}/tool-observer.cjs`, '${work}/candidate/node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], pack: [nodeBinary, '--max-old-space-size=512', '--require', `${recipeRoot}/tool-observer.cjs`, '${work}/tools/npm/bin/npm-cli.js', 'pack', '--ignore-scripts', '--json', '--pack-destination', '${run}/pack'] },
  environment: { inherited: false, NODE_OPTIONS: 'absent', NODE_PATH: 'absent', HOME: '${work}/home', TMPDIR: '${work}/tmp', TMP: '${work}/tmp', TEMP: '${work}/tmp', PATH: '/Users/kjopek/.nvm/versions/node/v22.22.2/bin:/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC', npm_config_cache: '${work}/cache', npm_config_userconfig: '${work}/empty.npmrc', npm_config_globalconfig: '${work}/empty-global.npmrc', npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', npm_config_registry: 'http://127.0.0.1:9/', npm_config_prefix: '${work}/prefix', npm_config_logs_max: '0', npm_config_progress: 'false' },
  trustLimits: ['Node builtins, OS/kernel, shared libraries and actual Git binary are host trust, not recursively traced OS closure', 'Complete regular-file npm/TypeScript/@types/node/undici-types closure bound; unused npm alias symlinks authenticated but excluded from copying', 'CommonJS _compile records exact compile-input bytes and resolved module path; TypeScript synchronous file reads recorded separately; not product ESM actual-load or all opaque host I/O proof', 'Child subprocesses and network API use refused by injected tool observer; no product imports, public consumer types, installs or moves', 'Node heap bound is not process RSS; no RSS measurements or cause claims', 'Scoped committed selection only; unrelated live/index work neither enters nor vetoes selection; live selected trees are separately snapshotted for mutation detection', 'Watchdog failure terminates only owned process groups, waits close, records failure; no automatic retry', 'Synthetic negative guard vectors are not authentic positive root bindings or semantic DU/public results'],
};
function save(name, value) { writeFileSync(join(recipeRoot, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o644 }); }
save('closure.json', closure);
save('registry.json', registry);
save('recipe.json', recipe);
save('MANIFEST.json', { schemaVersion: 2, role: 'admission-only recipe seal; external Git commit required before execution', files: census(recipeRoot).filter(record => record.type === 'file') });
console.log(JSON.stringify({ manifestSha256: sha256(readFileSync(join(recipeRoot, 'MANIFEST.json'))), protectedFiles: protectedFiles.length, packages: packages.map(item => ({ name: item.name, version: item.version, regularFiles: item.records.filter(record => record.type === 'file').length, aliases: item.records.filter(record => record.type === 'symlink').length })), authorPackBytes: pack.length }));
