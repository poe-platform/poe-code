import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createFsFromVolume, Volume } from 'memfs';
import { admitPublicStagingPackages } from './object-staging-public-admission.mjs';

function fixture() {
  const fs = createFsFromVolume(new Volume());
  const root = '/case/consumer';
  const version = '0.0.0-candidate';
  const admission = { schemaVersion: 1, origin: 'locally-packed-candidates', version, packages: {} };
  const lock = { lockfileVersion: 3, packages: {} };
  for (const suffix of ['safe-bash', 'safe-fs', 'safe-js']) {
    const name = `@poe-platform/${suffix}`;
    const directory = `${root}/node_modules/${name}`;
    fs.mkdirSync(directory, { recursive: true });
    const metadata = JSON.stringify({ name, version,
      dependencies: suffix === 'safe-fs' ? {} : { '@poe-platform/safe-fs': version } });
    fs.writeFileSync(`${directory}/package.json`, metadata);
    fs.writeFileSync(`${directory}/index.js`, 'export const value = 1;');
    const bytes = Buffer.from(`archive ${suffix}`);
    fs.mkdirSync('/case/tarballs', { recursive: true });
    fs.writeFileSync(`/case/tarballs/${suffix}.tgz`, bytes);
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    const resolved = `file:../tarballs/${suffix}.tgz`;
    admission.packages[name] = { resolved, integrity, tarball: `../tarballs/${suffix}.tgz`, files: {
      'package.json': createHash('sha256').update(metadata).digest('hex'),
      'index.js': createHash('sha256').update('export const value = 1;').digest('hex'),
    } };
    lock.packages[`node_modules/${name}`] = { version, resolved, integrity };
  }
  function save() {
    const text = JSON.stringify(lock);
    fs.writeFileSync(`${root}/package-lock.json`, text);
    admission.lockSha256 = createHash('sha256').update(text).digest('hex');
    fs.writeFileSync('/case/admission.json', JSON.stringify(admission));
  }
  save();
  return { fs, root, admission, lock, save, options: { consumerRoot: root, admissionPath: '/case/admission.json', fileSystem: fs } };
}

test('admits independent matched public artifacts with explicit candidate provenance', () => {
  const selected = fixture();
  const result = admitPublicStagingPackages(selected.options);
  assert.equal(result.evidence.origin, 'locally-packed-candidates');
  assert.equal(result.evidence.version, '0.0.0-candidate');
  assert.equal(result.evidence.packages.length, 3);
  assert.equal(result.files.size, 6);
});

for (const [name, mutate] of [
  ['version mismatch', selected => { selected.admission.version = 'another-version'; selected.save(); }],
  ['receipt integrity mismatch', selected => { selected.lock.packages['node_modules/@poe-platform/safe-fs'].integrity = 'wrong'; selected.save(); }],
  ['registry provenance on file receipts', selected => { selected.admission.origin = 'registry-release'; selected.save(); }],
  ['unknown provenance', selected => { selected.admission.origin = 'source'; selected.save(); }],
  ['package byte mismatch', selected => { selected.fs.writeFileSync(`${selected.root}/node_modules/@poe-platform/safe-fs/index.js`, 'changed'); }],
  ['package metadata mismatch', selected => { selected.fs.writeFileSync(`${selected.root}/node_modules/@poe-platform/safe-fs/package.json`, '{}'); }],
  ['archive byte mismatch', selected => { selected.fs.writeFileSync('/case/tarballs/safe-fs.tgz', 'changed'); }],
  ['lock byte mismatch', selected => { selected.fs.writeFileSync(`${selected.root}/package-lock.json`, '{}'); }],
  ['symlinked package', selected => {
    selected.fs.renameSync(`${selected.root}/node_modules/@poe-platform/safe-fs`, '/case/borrowed');
    selected.fs.symlinkSync('/case/borrowed', `${selected.root}/node_modules/@poe-platform/safe-fs`);
  }],
  ['symlinked file', selected => {
    selected.fs.unlinkSync(`${selected.root}/node_modules/@poe-platform/safe-fs/index.js`);
    selected.fs.writeFileSync('/case/borrowed.js', 'export const value = 1;');
    selected.fs.symlinkSync('/case/borrowed.js', `${selected.root}/node_modules/@poe-platform/safe-fs/index.js`);
  }],
]) {
  test(`rejects ${name} without fallback`, () => {
    const selected = fixture();
    mutate(selected);
    assert.throws(() => admitPublicStagingPackages(selected.options));
  });
}

test('registry receipt mode is explicit, not inferred from a matching version', () => {
  const selected = fixture();
  selected.admission.origin = 'registry-release';
  for (const [name, entry] of Object.entries(selected.admission.packages)) {
    entry.resolved = `https://registry.npmjs.org/${name}/-/fixture.tgz`;
    selected.lock.packages[`node_modules/${name}`].resolved = entry.resolved;
  }
  selected.save();
  assert.equal(admitPublicStagingPackages(selected.options).evidence.origin, 'registry-release');
});
