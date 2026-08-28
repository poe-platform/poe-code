import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const decode = (name, expected) => {
  const compressed = Buffer.from(readFileSync(path.join(own, name), "utf8"), "base64");
  assert.equal(hash(compressed), expected);
  return JSON.parse(gunzipSync(compressed));
};
const original = decode("observations-01.json.gz.base64", "fe150ca75f031031acc8e3591ed6add03ea24d669e7bcc63d97d2990d7452211");
const supplemental = decode("supplemental-observations-01.json.gz.base64", "4400c5f78510f39a8882480f2789caaff0e697b6b1569408f1f8f0f0d95b8d66");
assert.equal(original.completed, true);
assert.equal(original.native.length, 34);
assert.equal(original.virtual.length, 34);
assert.equal(original.directChildren, 70);
assert.equal(original.identities.length, 2);
assert.equal(original.temporaryRemoved, true);
assert.equal(original.sourceUnchanged, true);
assert.equal(original.binaryUnchanged, true);
assert.equal(original.nodeUnchanged, true);
assert.deepEqual(original.sourceAfter, original.seal.sourceBefore);
assert.deepEqual(original.packageAfter, original.packageBefore);
assert.equal(Object.keys(original.packageBefore).length, 834);
for (const [name, expected] of Object.entries(original.seal.fixtures)) assert.equal(hash(readFileSync(path.join(own, name))), expected);
assert.equal(supplemental.completed, true);
assert.equal(supplemental.rows.length, 4);
assert.equal(supplemental.binaryUnchanged, true);
assert.equal(supplemental.temporaryRemoved, true);
for (const [name, expected] of Object.entries(supplemental.seal.files)) assert.equal(hash(readFileSync(path.join(own, name))), expected);
for (const record of [...original.native, ...original.identities, ...supplemental.rows]) {
  assert.equal(record.signal, null);
  assert.ok(!record.error);
}
for (const record of original.virtual) {
  assert.equal(record.status, 0);
  assert.equal(record.signal, null);
  assert.equal(record.error, null);
  assert.equal(record.observed.disposed, true);
  assert.equal(record.observed.rejection, undefined);
  assert.equal(record.productLoads, 204);
  assert.equal(record.stdoutAndStatusMatchNative, false);
  const prefix = `${original.root}/consumer/node_modules/virtual-bash/`;
  assert.equal(record.observed.rootResolution, `file://${prefix}dist/index.js`);
  for (const load of record.loads) {
    const expected = load.filename.startsWith(prefix) ? original.packageBefore[load.filename.slice(prefix.length)]?.sha256 : original.seal.fixtures["worker.mjs"];
    assert.equal(load.sha256, expected);
  }
}
assert.equal(existsSync(original.root), false);
assert.equal(existsSync(supplemental.root), false);
console.log(JSON.stringify({ status: "PRECODE_OBSERVATIONS_AUTHENTICATED_NOT_FEATURE_ACCEPTANCE", originalFreeze: original.freezeCommit,
  supplementalFreeze: supplemental.freezeCommit, nativeScriptObservations: 34, virtualScriptObservations: 34,
  virtualStdoutAndStatusMatches: 0, additionalNativeOnlyQuestions: 4, nativeIdentityInvocations: 2,
  directlyAwaitedChildren: 74, packedProductModulesPerVirtualCase: 204, sourceUnchanged: true, binaryUnchanged: true,
  ownedTemporaryRootsRemoved: 2, newExecutionsByVerifier: 0,
  qualifications: ["Original bundled dirs snapshot failure retained", "Supplemental four are not original34 rescore", "DIRSTACK/tilde case explicitly deferred", "Darwin Bash5.3 only; no Linux/Bash3.2 claim", "No production changes"] }, null, 2));
