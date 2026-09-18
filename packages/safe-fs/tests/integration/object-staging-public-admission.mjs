import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { resolve } from 'node:path';

export function admitPublicStagingPackages({ consumerRoot, admissionPath, fileSystem = fs }) {
  const root = resolve(consumerRoot);
  assert.equal(fileSystem.realpathSync(root), root, 'Consumer must not be symlinked');
  const text = fileSystem.readFileSync(admissionPath, 'utf8');
  const admission = JSON.parse(text);
  assert.equal(admission.schemaVersion, 1);
  assert.ok(['locally-packed-candidates', 'registry-release'].includes(admission.origin), 'Explicit package provenance required');
  assert.equal(typeof admission.version, 'string');
  assert.ok(admission.version.length > 0);
  const lockBytes = fileSystem.readFileSync(resolve(root, 'package-lock.json'));
  assert.equal(createHash('sha256').update(lockBytes).digest('hex'), admission.lockSha256, 'Installation lock bytes mismatch');
  const lock = JSON.parse(lockBytes);
  assert.ok(lock.lockfileVersion >= 2);
  const files = new Map();
  const packages = [];
  for (const suffix of ['safe-bash', 'safe-fs', 'safe-js']) {
    const name = `@poe-platform/${suffix}`;
    const directory = resolve(root, 'node_modules', name);
    assert.equal(fileSystem.realpathSync(directory), directory, `${name} must be independently installed`);
    const entry = admission.packages[name];
    assert.ok(entry?.files?.['package.json'], `${name} artifact file hashes required`);
    const receipt = lock.packages[`node_modules/${name}`];
    assert.equal(receipt?.version, admission.version, `${name} receipt version mismatch`);
    assert.equal(receipt.resolved, entry.resolved, `${name} origin receipt mismatch`);
    assert.equal(receipt.integrity, entry.integrity, `${name} integrity receipt mismatch`);
    assert.equal(receipt.link, undefined, `${name} linked install is not admissible`);
    const archive = resolve(root, entry.tarball);
    assert.equal(fileSystem.realpathSync(archive), archive, 'Archive must not be symlinked');
    assert.equal(`sha512-${createHash('sha512').update(fileSystem.readFileSync(archive)).digest('base64')}`,
      entry.integrity, `${name} tarball integrity mismatch`);
    if (admission.origin === 'locally-packed-candidates') {
      assert.ok(entry.resolved.startsWith('file:'), 'Candidate mode requires local archive receipts');
      assert.equal(resolve(root, entry.resolved.slice(5)), archive);
    } else {
      const location = new URL(entry.resolved);
      assert.equal(location.origin, 'https://registry.npmjs.org', 'Registry mode requires npm registry receipts');
      assert.equal(location.username + location.password, '');
      assert.ok(location.pathname.startsWith(`/${name}/-/`));
    }
    for (const [path, digest] of Object.entries(entry.files)) {
      const filename = resolve(directory, path);
      assert.ok(filename.startsWith(directory + '/'), 'Artifact paths must remain in the package');
      assert.equal(fileSystem.realpathSync(filename), filename, 'Artifact files must not be symlinked');
      assert.ok(fileSystem.statSync(filename).isFile());
      assert.equal(createHash('sha256').update(fileSystem.readFileSync(filename)).digest('hex'), digest, `${name}/${path} byte mismatch`);
      files.set(filename, digest);
    }
    const metadata = JSON.parse(fileSystem.readFileSync(resolve(directory, 'package.json'), 'utf8'));
    assert.equal(metadata.name, name);
    assert.equal(metadata.version, admission.version, `${name} metadata version mismatch`);
    if (suffix !== 'safe-fs') assert.equal(metadata.dependencies?.['@poe-platform/safe-fs'], admission.version, 'Canonical SafeFS pairing mismatch');
    packages.push({ name, version: metadata.version, resolved: entry.resolved, integrity: entry.integrity,
      packageJsonSha256: entry.files['package.json'] });
  }
  return { files, evidence: { mode: 'installed-public-packages', origin: admission.origin, version: admission.version,
    admissionSha256: createHash('sha256').update(text).digest('hex'), lockSha256: admission.lockSha256, packages } };
}
