import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { owned, repository, freeze, candidate, overlayCommit, frozenPath, overlayPath, hash, json, record, inventory, sort, identifiers, exactBytes, toolsSnapshot } from "./common.mjs";

const pre = JSON.parse(await readFile(join(owned, "PRE.json")));
const delta = pre.delta;

export function validatePatch(bytes) {
  exactBytes(bytes, delta.patch, "patch");
}

export function validateInventory(actual, phase) {
  assert(["base", "overlay"].includes(phase));
  assert.deepEqual(sort(actual), sort([delta.changedFile[phase], ...delta.untouchedFiles]), `${phase} complete inventory mismatch`);
}

export function overlayReceipt(phase) {
  return { phase, baseCommit: freeze, baseManifestSha256: delta.base.manifestSha256, overlayCommit, manifestDeltaSha256: pre.overlay.records.find(entry => entry.path === "manifest-delta.json").sha256, patchSha256: delta.patch.sha256, baseHarness: delta.changedFile.base, patchedHarness: delta.changedFile.overlay, untouchedFiles: 22, oldManifestAuthenticatesPatchedBytes: false };
}

export async function admitAdapter(base, product) {
  identifiers(base, product);
  const execution = JSON.parse(await readFile(join(owned, "EXECUTION-PRE.json")));
  for (const entry of execution.files) exactBytes(await readFile(join(owned, entry.path)), entry, "reviewer execution artifact");
  for (const binding of [pre.base, pre.overlay]) {
    assert.deepEqual(await inventory(join(repository, binding.root)), binding.records, "immutable input tree changed before execution");
  }
  validatePatch(await readFile(join(repository, overlayPath, "verify-v5.patch.data")));
  assert.deepEqual(await toolsSnapshot(), JSON.parse(await readFile(join(owned, "PRE-TOOLS.json"))), "tool bytes changed before execution");
  const expected = JSON.parse(await readFile(join(repository, frozenPath, "config/static-tooling.json")));
  const tools = JSON.parse(await readFile(join(owned, "PRE-TOOLS.json")));
  assert.equal(process.version, expected.node);
  assert.equal(tools.packages.npm.version, expected.npm);
  assert.equal(tools.packages.typescript.version, expected.typescript);
}

export function expectedFixtureFiles(files, phase) {
  assert.deepEqual(sort(files), sort(pre.base.records.filter(entry => entry.path !== "MANIFEST.json")));
  return phase === "bootstrap-materialized-pristine-before-overlay" ? files : files.map(entry => entry.path === delta.changedFile.base.path ? delta.changedFile.overlay : entry);
}

export async function applyAuthenticatedOverlay(root, resultDirectory) {
  const pristine = await inventory(root);
  validateInventory(pristine, "base");
  await writeFile(join(resultDirectory, "PRISTINE-V9-BEFORE-PATCH.json"), json({ ...overlayReceipt("pristine-before-patch"), records: pristine, verifiedAgainstOriginalManifest: true }), { flag: "wx" });
  const patch = await readFile(join(repository, overlayPath, "verify-v5.patch.data"));
  validatePatch(patch);
  const helper = await import(pathToFileURL(join(repository, overlayPath, "overlay.mjs")));
  await helper.applyOverlay(root, repository);
  const applied = await inventory(root);
  validateInventory(applied, "overlay");
  await writeFile(join(resultDirectory, "PATCHED-V9-AFTER-PATCH.json"), json({ ...overlayReceipt("patched-after-application"), records: applied, verifiedAgainstOriginalManifest: false, verifiedAgainstManifestDelta: true }), { flag: "wx" });
}
