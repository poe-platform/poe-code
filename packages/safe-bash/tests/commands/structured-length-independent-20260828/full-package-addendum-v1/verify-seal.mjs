import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scope = dirname(fileURLToPath(import.meta.url));
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const seal = JSON.parse(readFileSync(join(scope, 'SEAL.json')));
const actual = {};
function visit(folder) {
  for (const name of readdirSync(folder).sort()) {
    const path = join(folder, name), stat = lstatSync(path), key = relative(scope, path);
    assert.equal(stat.isSymbolicLink(), false, key);
    if (stat.isDirectory()) { assert.equal(key, 'result'); visit(path); }
    else { assert.ok(stat.isFile()); if (key !== 'SEAL.json') actual[key] = hash(readFileSync(path)); }
  }
}
visit(scope); assert.deepEqual(actual, seal);
const report = JSON.parse(readFileSync(join(scope, 'result/REPORT.json')));
const bytes = readFileSync(join(scope, 'result/virtual-bash-0.0.0.tgz'));
const metadata = report.package.npmMetadata, validation = report.package.validation;
assert.equal(hash(bytes), 'ff230f2e9079cc843198533e412f836abb62e4ade63f4fa210b7269f7deb4eff');
assert.equal(metadata.size, bytes.length);
assert.equal(metadata.shasum, hash(bytes, 'sha1'));
assert.equal(metadata.integrity, 'sha512-' + hash(bytes, 'sha512', 'base64'));
assert.equal(metadata.entryCount, 846); assert.equal(metadata.files.length, 846);
assert.equal(metadata.unpackedSize, Object.values(validation.files).reduce((sum, entry) => sum + entry.bytes, 0));
assert.deepEqual(Object.fromEntries(metadata.files.map(entry => [entry.path, { bytes: entry.size, mode: entry.mode }])), Object.fromEntries(Object.entries(validation.files).map(([path, entry]) => [path, { bytes: entry.bytes, mode: entry.mode }])));
assert.equal(metadata.id, `${validation.metadata.name}@${validation.metadata.version}`);
assert.equal(metadata.name, validation.metadata.name); assert.equal(metadata.version, validation.metadata.version);
assert.deepEqual(metadata.bundled, []);
assert.equal(Object.keys(validation.metadata.exports).length, 25); assert.equal(validation.exportTargets.length, 50);
assert.equal(report.stageBeforeAfterIdentical, true); assert.equal(report.toolInventoryBeforeAfterIdentical, true);
assert.equal(report.controls.length, 3); assert.ok(report.controls.every(control => control.rejected));
assert.equal(report.productEdits, false);
const verified = spawnSync(process.execPath, [join(scope, 'run.mjs'), '--verify'], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
assert.equal(verified.error, undefined); assert.equal(verified.signal, null); assert.equal(verified.status, 0, verified.stderr);
process.stdout.write(verified.stdout);
process.stdout.write(JSON.stringify({ sealedFiles: Object.keys(seal).length, metadataVerified: true, newBuildsOrProductTests: 0 }) + '\n');
