import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function load(directory, filename, meter, json = true) {
  meter.charge(128, 128);
  const location = path.join(directory, filename);
  const stat = lstatSync(location);
  assert(stat.isFile() && !stat.isSymbolicLink());
  assert(stat.size <= 1048576);
  meter.charge(stat.size * 32 + 1, stat.size * 32 + 1);
  const bytes = readFileSync(location);
  return json ? JSON.parse(bytes.toString('utf8')) : bytes;
}

export function inventory(directory, meter, relative = '') {
  meter.charge(65536, 65536);
  const names = readdirSync(path.join(directory, relative));
  assert(names.length <= 128);
  meter.charge(names.length * names.length * 512);
  names.sort();
  const entries = meter.array(0);
  for (const name of names) {
    meter.charge(1024, 1024);
    assert(name.length <= 256);
    const filename = relative ? `${relative}/${name}` : name;
    const stat = lstatSync(path.join(directory, filename));
    assert(!stat.isSymbolicLink());
    if (stat.isDirectory()) {
      assert(relative.split('/').length < 8);
      entries.push(meter.record(() => ({ path: filename, kind: 'directory' })));
      const children = inventory(directory, meter, filename);
      for (const child of children) { meter.charge(16, 16); entries.push(child); }
    } else {
      assert(stat.isFile() && stat.size <= 1048576);
      meter.charge(stat.size * 4 + 128, stat.size * 2 + 128);
      const bytes = readFileSync(path.join(directory, filename));
      assert.equal(bytes.length, stat.size);
      entries.push(meter.record(() => ({ path: filename, kind: 'file', bytes: bytes.length, sha256: hash(bytes) })));
    }
  }
  return entries;
}

export function authenticateInputs(directory, meter) {
  const manifest = load(directory, 'RUN-INPUTS.data', meter);
  for (const entry of manifest.entries) {
    meter.charge(256, 256);
    const bytes = load(directory, entry.path, meter, false);
    assert.equal(bytes.length, entry.bytes);
    assert.equal(hash(bytes), entry.sha256, entry.path);
  }
  const auth = load(directory, 'AUTHENTICATION.data', meter);
  assert.equal(hash(load(directory, 'frozen/MANIFEST.json', meter, false)), auth.freezeManifestSha256);
  assert.equal(hash(load(directory, 'inherited-model.mjs', meter, false)), auth.inheritedModelSha256);
  return manifest;
}
