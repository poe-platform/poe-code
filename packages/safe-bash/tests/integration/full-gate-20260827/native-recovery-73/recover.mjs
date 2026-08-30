import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, constants, copyFileSync, lstatSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assessNative } from '../preflight-repair/preflight.mjs';

export const acceptedSha256 = '4298efd414836892c913b2e87401d62fdd7c6ec4026d9bad8e3fab10557e411f';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function copyAcceptedAsset(source, destination) {
  assert.ok(lstatSync(source).isFile() && !lstatSync(source).isSymbolicLink(), 'retained native asset must be a regular file');
  assert.equal(hash(readFileSync(source)), acceptedSha256, 'retained rg differs from accepted native profile');
  copyFileSync(source, destination, constants.COPYFILE_EXCL);
  assert.equal(hash(readFileSync(destination)), acceptedSha256, 'recovered rg changed during copy');
  chmodSync(destination, 0o555);
  return { path: realpathSync(destination), sha256: hash(readFileSync(destination)) };
}

export function recover(source) {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const policyPath = 'tests/integration/full-gate-20260827/combined-8670ebe8/policy.json';
  const policyBytes = readFileSync(join(repository, policyPath));
  const policy = JSON.parse(policyBytes);
  const requirement = policy.native.find(asset => asset.name === 'rg');
  assert.equal(requirement.sha256, acceptedSha256);
  const originBytes = readFileSync(requirement.origin);
  const output = realpathSync(mkdtempSync(join(tmpdir(), 'safe-bash-rg-recovered-')));
  const retained = { path: realpathSync(source), sha256: hash(readFileSync(source)), size: lstatSync(source).size };
  const recovered = copyAcceptedAsset(source, join(output, 'rg'));
  const tree = JSON.parse(readFileSync(join(repository, 'tests/commands/filesystem-inspection-stress/tree/EXTERNAL-ARTIFACTS.json'))).artifacts.find(asset => asset.externalBasename === 'tree');
  const requirements = policy.native.map(asset => asset.name === 'rg' ? { ...asset, originEnv: 'RG_NATIVE_BIN' } : asset);
  const environment = { ...process.env, RG_NATIVE_BIN: recovered.path, TREE_NATIVE_BIN: tree.externalPath };
  const assessed = assessNative(requirements, repository, environment);
  assert.deepEqual(assessed.issues, []);
  assert.equal(assessed.assets.length, 49);
  const installedPackage = resolve(dirname(requirement.origin), '../../..', 'package.json');
  const report = { at: new Date().toISOString(), policy: { path: policyPath, sha256: hash(policyBytes), candidate: policy.candidate, unchanged: true },
    origin: { path: requirement.origin, sha256: hash(originBytes), size: originBytes.length, version: execFileSync(requirement.origin, ['--version'], { encoding: 'utf8' }) },
    installedPackage: { path: installedPackage, sha256: hash(readFileSync(installedPackage)), metadata: JSON.parse(readFileSync(installedPackage)) },
    retained, recovered: { ...recovered, version: execFileSync(recovered.path, ['--version'], { encoding: 'utf8' }) },
    environment: { RG_NATIVE_BIN: environment.RG_NATIVE_BIN, TREE_NATIVE_BIN: environment.TREE_NATIVE_BIN },
    successorRequirement: requirements.find(asset => asset.name === 'rg'), native: assessed,
    qualification: 'Exact retained accepted bytes, not version-equivalence approval; future successor may select this explicit originEnv with unchanged hash. No historical policy changed or suite launched.' };
  writeFileSync(join(output, 'receipt.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return { output, report };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, 'recover.mjs EXACT_RETAINED_BINARY');
  const { output, report } = recover(process.argv[2]);
  console.log(JSON.stringify({ output, recovered: report.recovered, nativeAssets: report.native.assets.length, suiteLaunched: false }));
}
