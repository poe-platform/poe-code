import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { own, hash, objectHash, treeBlob, unpack, inventory, originalFreeze } from "./common.mjs";

originalFreeze();
const sealName = process.argv[2] === "--pre" ? "DRIVER-SEAL.json" : "FINAL-MANIFEST.json";
const seal = JSON.parse(fs.readFileSync(path.join(own, sealName)));
const actual = inventory(own);
const selected = Object.fromEntries(Object.entries(actual).filter(([name]) => name !== sealName && !name.startsWith("scratch/")));
assert.deepEqual(Object.keys(selected).sort(), Object.keys(seal.files).sort(), "review member additions/removals");
for (const [name, record] of Object.entries(seal.files)) assert.deepEqual(selected[name], record, name);
if (sealName === "FINAL-MANIFEST.json") assert.equal(fs.existsSync(path.join(own, "scratch")), false);
else {
  const expected = unpack(path.join(own, "PREPARED-INVENTORY.json.gz"));
  assert.deepEqual(inventory(path.join(own, "scratch")), expected);
}
const binding = JSON.parse(fs.readFileSync(path.join(own, "BINDING.json")));
const composition = unpack(path.join(own, "composition.json.gz"));
assert.equal(hash(fs.readFileSync(path.join(own, "composition.json.gz"))), binding.composition.archiveSha256);
for (const record of Object.values(composition.commits)) {
  const bytes = Buffer.from(record.base64, "base64");
  assert.equal(objectHash("commit", bytes), record.commit);
  assert.equal(bytes.toString().match(/^tree (\w+)$/m)[1], record.tree);
}
const candidate = unpack(path.join(own, "CANDIDATE-PROOF.json.gz"));
assert.equal(objectHash("commit", Buffer.from(candidate.commit.base64, "base64")), composition.commits.candidate.commit);
for (const [name, record] of Object.entries(composition.files)) {
  const bytes = Buffer.from(record.base64, "base64");
  assert.equal(hash(bytes), record.sha256);
  assert.equal(objectHash("blob", bytes), record.blob);
  assert.equal(treeBlob(composition.commits.baseline.tree, name, composition.treeProof), record.baselineBlob);
  assert.equal(treeBlob(composition.composedTree, name, composition.treeProof), record.blob);
  if (binding.composition.overrides[name]) {
    assert.equal(treeBlob(candidate.commit.tree, name, candidate.treeProof), record.blob);
    assert.equal(record.sha256, binding.composition.overrides[name]);
  } else assert.equal(record.blob, record.baselineBlob);
}
console.log(JSON.stringify({ status: "authenticated", phase: sealName, originalSevenUnchanged: true,
  ownEntries: Object.keys(seal.files).length + 1, composedTree: composition.composedTree,
  sourceFiles: Object.keys(composition.files).length, additionAware: true, productExecution: false }));
