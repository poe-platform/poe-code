import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const own = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const receiptBytes = fs.readFileSync(path.join(own, 'BUILD-RECEIPT.json'));
const receipt = JSON.parse(receiptBytes);
const executionBytes = fs.readFileSync(path.join(own, 'EXECUTION-SEAL.json'));
assert.equal(sha256(executionBytes), 'ec2f19e1825970b662d60a99f2128158ab7ab494b4161ce2a4b0f121f4dcc8e5');
const execution = JSON.parse(executionBytes);
assert.equal(receipt.runtimeStatus, 'AWAITING_COMMITTED_RUNTIME_SEAL');
assert.equal(receipt.compiler, 'build-source');
assert.equal(fs.existsSync(path.join(own, 'RUNTIME-START.json')), false);
assert.equal(fs.existsSync(path.join(own, 'RUNTIME-SEAL.json')), false);
assert.equal(receipt.facts.product.length, 0);
assert.equal(receipt.facts.types.length, 0);
assert.equal(Object.values(receipt.packageInventory).filter(entry => entry.kind === 'file').length, 882);
const inventory = directory => {
  const output = {};
  const walk = relative => {
    for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
      assert.notEqual(name, 'AGENTS.md');
      const key = relative ? `${relative}/${name}` : name;
      const filename = path.join(directory, key);
      const stat = fs.lstatSync(filename);
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) { output[key + '/'] = { kind: 'directory', mode: stat.mode & 0o777 }; walk(key); }
      else {
        assert.ok(stat.isFile());
        output[key] = { kind: 'file', bytes: stat.size, mode: stat.mode & 0o777, sha256: sha256(fs.readFileSync(filename)) };
      }
    }
  };
  walk('');
  return output;
};
assert.deepEqual(inventory(path.join(own, '.work-v2/source')), receipt.sourceInventory);
assert.deepEqual(inventory(path.join(own, '.work-v2/installed/node_modules/virtual-bash')), receipt.packageInventory);
const harness = {};
for (const name of ['bootstrap.mjs', 'loader.mjs', 'worker.mjs', 'ORIGINAL32-v1.json', 'SUPPLEMENT-v1.json']) {
  const fixture = name.endsWith('.json');
  const expected = execution.files[fixture ? `../matrix/${name}` : name];
  for (const directory of [fixture ? path.resolve(own, '../matrix') : own, path.join(own, '.work-v2/source-consumer'), path.join(own, '.work-v2/installed')]) {
    const filename = path.join(directory, name);
    const stat = fs.lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(stat.size, expected.bytes);
    assert.equal(stat.mode & 0o777, expected.mode);
    assert.equal(sha256(fs.readFileSync(filename)), expected.sha256);
  }
  harness[name] = expected;
}
for (const mutation of receipt.facts.mutations) for (const variant of Object.values(mutation.variants)) {
  const filename = path.join(own, variant.path);
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.size, variant.bytes);
  assert.equal(stat.mode & 0o777, variant.mode);
  assert.equal(sha256(fs.readFileSync(filename)), variant.sha256);
}
const result = {
  schema: 'apply-patch-independent-actual-runtime-seal-v3',
  sealedAt: new Date().toISOString(),
  candidate: '58be2d6c5706f3e90f01d48e695ecfd9daa52669',
  grantCommit: '2bca8eafcd55453fc2fee6a7e677108f306e096f',
  executionSealSha256: sha256(executionBytes),
  buildReceiptSha256: sha256(receiptBytes),
  packageSha256: sha256(JSON.stringify(receipt.packageInventory)),
  workerSha256: execution.files['worker.mjs'].sha256,
  loaderSha256: execution.files['loader.mjs'].sha256,
  bootstrapSha256: execution.files['bootstrap.mjs'].sha256,
  mutationsSha256: sha256(JSON.stringify(receipt.facts.mutations)),
  sourceInventorySha256: sha256(JSON.stringify(receipt.sourceInventory)),
  app: Object.fromEntries(Object.entries(receipt.packageInventory).filter(([name, entry]) => name.startsWith('dist/commands/apply-patch/') && entry.kind === 'file')),
  harness,
  mutations: receipt.facts.mutations,
  sourceInventory: receipt.sourceInventory,
  packageInventory: receipt.packageInventory,
  observedPackageFiles: 882,
  productLoadsBeforeSeal: 0,
  qualification: 'Actual build emissions and offline assembled files authenticated at the controller barrier; not a product runtime result, public export, service acceptance or source-metadata substitute.',
};
const bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n');
const filename = path.join(own, 'RUNTIME-SEAL.json');
const descriptor = fs.openSync(filename, 'wx', 0o644);
try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
finally { fs.closeSync(descriptor); }
console.log(JSON.stringify({ runtimeSealSha256: sha256(bytes), buildReceiptSha256: result.buildReceiptSha256, packageSha256: result.packageSha256, sourceInventorySha256: result.sourceInventorySha256, mutationsSha256: result.mutationsSha256, appFiles: Object.keys(result.app).length, packageFiles: result.observedPackageFiles, controllerPid: receipt.facts.controllerPid, started: receipt.facts.started }));
