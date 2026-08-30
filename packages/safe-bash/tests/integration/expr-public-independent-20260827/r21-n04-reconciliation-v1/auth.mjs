import assert from "node:assert/strict";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { directory, repository, prefix, candidate, read, json, digest, objectHash, inventory, putJson } from "./common.mjs";
import { git, inputs, bindAcceptedProof, metadataReceipts, treeEntries } from "../component-execution-v5/auth.mjs";
export { inputs, metadataReceipts, git };

export function authenticate(commit, phase) {
  const seal = json(join(directory, "RECIPE-SEAL.json")), pins = json(join(directory, "PINS.json"));
  for (const tool of pins.tools) { assert.equal(digest(read(tool.path)), tool.sha256); assert.equal(lstatSync(tool.path).mode & 0o777, tool.mode); }
  for (const row of seal.entries) {
    const path = join(directory, row.path), bytes = read(path);
    assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256); assert.equal(lstatSync(path).mode & 0o777, row.mode);
    assert.ok(git("ls-tree", commit, "--", `${prefix}/${row.path}`).toString().includes(objectHash(bytes)));
  }
  assert.ok(git("ls-tree", commit, "--", `${prefix}/RECIPE-SEAL.json`).toString().includes(objectHash(read(join(directory, "RECIPE-SEAL.json")))));
  const allowed = [...seal.entries.map(row => row.path), "RECIPE-SEAL.json", ...pins.generated];
  for (const name of readdirSync(directory)) assert.ok(allowed.includes(name), `undeclared entry ${name}`);
  for (const group of pins.history) {
    assert.deepEqual(treeEntries(group.commit, group.prefix), group.entries);
    assert.deepEqual(readdirSync(join(repository, group.prefix)).filter(name => name !== "work").sort(), group.entries.map(row => row.path.slice(group.prefix.length + 1)).sort());
  }
  for (const row of pins.bindings) {
    const path = join(repository, row.path), bytes = read(path);
    assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256); assert.equal(objectHash(bytes), row.objectId); assert.equal(lstatSync(path).mode & 0o777, 0o644);
    assert.ok(git("ls-tree", row.commit, "--", row.path).toString().includes(row.objectId));
  }
  for (const tool of inputs.toolRoots) assert.deepEqual(inventory(tool.source, tool.name === "npm"), tool.entries);
  assert.deepEqual(inventory(join(repository, "tests/integration/expr-public-independent-20260827/component-admission-v1")), inputs.admissionFiles);
  const proof = bindAcceptedProof();
  putJson(join(directory, `${phase}-BINDINGS.json`), { status: "pass", phase, commit, candidate, recipeManifestSha256: digest(read(join(directory, "RECIPE-SEAL.json"))), P01: proof.P01,
    sourceToolInputModeHashAndNewEntriesChecked: true, historicalGroups: pins.history.length, metadataReceipts: [...metadataReceipts], metadataChildren: metadataReceipts.length });
  return proof;
}
