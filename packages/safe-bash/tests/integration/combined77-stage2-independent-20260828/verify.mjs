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
  assert.equal(hash(compressed), expected); return JSON.parse(gunzipSync(compressed));
};
const actual = decode("actual-01.json.gz.base64", "88fadf81a9ab984e4c25ff26f9f1d13331967549c0dbe08fbce268ee7ed1da12");
const types = decode("type-observations-v2.json.gz.base64", "347bbc5de17818610a33c0bcef24b8f05fbbeee28abe0c184bb9582bf9ebd4a1");
assert.equal(actual.candidate, "5137a74ec855a32d8a8860eb66b62eb44d11e290");
assert.equal(actual.base, "284857d7aa9b0ee0df2b6fdd1a71f41115d7b909");
assert.equal(actual.completed, true);
assert.equal(actual.scopedPass, false, "Original type-binding failure remains recorded");
assert.equal(actual.temporaryRemoved, true);
assert.equal(types.completed, true);
assert.equal(types.temporaryRemoved, true);
assert.equal(types.runtimeExecutions, 0);
assert.equal(hash(Buffer.from(actual.archiveBase64, "base64")), actual.archiveSha256);
assert.equal(hash(Buffer.from(actual.package.base64, "base64")), "13fe54de1cf900d587855e276375fdf72ed1ed0d0e0625cf7ef00730f2bb74c9");
assert.equal(types.packageSha256, actual.package.sha256);
assert.equal(Object.keys(actual.sourceHashes).length, 271);
assert.equal(Object.keys(actual.packageInventory).length, 846);
assert.equal(Object.keys(actual.emitted).length, 844);
assert.equal(actual.node.sha256, "5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011");
for (const [name, expected] of Object.entries(actual.sourceHashes)) assert.equal(actual.sourceBefore[name].sha256, expected);
for (const [name, entry] of Object.entries(actual.emitted)) assert.deepEqual(actual.packageInventory[`dist/${name}`], entry);
for (const entry of actual.binding.changes) assert.equal(actual.sourceHashes[entry.path], entry.sha256);
for (const [name, bytes] of Object.entries(actual.harness)) assert.equal(hash(readFileSync(path.join(own, name))), hash(Buffer.from(bytes, "base64")));
for (const [name, expected] of Object.entries(types.seal.hashes)) assert.equal(hash(readFileSync(path.join(own, name))), expected);
const originalTypes = readFileSync(path.join(own, "types.mts.fixture"), "utf8");
assert.equal(originalTypes.replace('from "virtual-bash/shell";', 'from "virtual-bash";'), readFileSync(path.join(own, "types-v2.mts.fixture"), "utf8"));
const ids = JSON.parse(readFileSync(path.join(own, "CASES.json"), "utf8")).cases.map(entry => entry.id);
const summaries = [];
for (const layout of ["installed", "moved"]) {
  const record = actual.records.find(record => record.label === `${layout}-runtime`);
  assert.equal(record.status, 0); assert.equal(record.productLoads, 207);
  assert.deepEqual(record.observed.rows.map(row => row.id), ids);
  assert.ok(record.observed.rows.every(row => row.status === "PASS"));
  const packagePrefix = `${record.cwd}/node_modules/virtual-bash/`;
  const productLoads = record.loads.filter(load => load.filename.startsWith(packagePrefix));
  assert.equal(new Set(productLoads.map(load => load.filename)).size, 207);
  for (const load of record.loads) {
    const expected = load.filename.startsWith(packagePrefix) ? actual.packageInventory[load.filename.slice(packagePrefix.length)]?.sha256
      : actual.executionFreeze.hashes["runtime.mjs"];
    assert.equal(load.sha256, expected);
  }
  for (const row of record.observed.rows.filter(row => ["C02", "C03", "C04", "C07"].includes(row.id))) {
    assert.equal(row.details.activeListeners, 0); assert.equal(row.details.cleanupCalls, 1); assert.equal(row.details.exactInnerReason, true);
    assert.equal(row.details.parentLive, row.id !== "C04");
  }
  const du = record.observed.rows.find(row => row.id === "C08").details;
  assert.equal(du.owned, true); assert.equal(du.contentReads, 0); assert.equal(du.mutations, 0);
  const html = record.observed.rows.find(row => row.id === "C09").details;
  assert.equal(html.acquisitions, 1); assert.equal(html.releases, 1); assert.equal(html.owned, true);
  const initialType = actual.records.find(record => record.label === `${layout}-types`);
  assert.equal(initialType.status, 2); assert.equal((initialType.stdout.match(/error TS2307:/gu) ?? []).length, 1);
  assert.equal(types.layouts[`${layout}-types`].status, 0);
  assert.deepEqual(types.layouts[`${layout}-negative`], { status: 2, diagnostics: ["error TS2540:", "error TS2322:", "error TS2353:"] });
  summaries.push({ layout, runtimeFamilies: 10, passed: 10, productModules: 207, typeFamilies: 4, correctedTypeCompileStatus: 0, exactNegativeTypeDiagnostics: 3 });
}
assert.equal(actual.mutations.length, 3);
for (const mutation of actual.mutations) {
  assert.equal(mutation.status, 1); assert.ok(mutation.rows.some(row => row.status === "FAIL"));
  assert.equal(mutation.beforeSha256, actual.packageInventory[mutation.file].sha256);
  const record = actual.records.find(record => record.label === `${mutation.id}-runtime`);
  assert.equal(record.loads.find(load => load.filename.endsWith(`/node_modules/virtual-bash/${mutation.file}`)).sha256, mutation.afterSha256);
}
assert.match(actual.mutations[0].rows[0].error.message, /INDEPENDENT_TEST_WATCHDOG/u);
assert.equal(actual.controls.length, 3);
for (const record of actual.records) { assert.equal(record.signal, null); assert.equal(record.error, undefined); assert.equal(record.childGone, true); }
for (const record of types.records) { assert.equal(record.signal, null); assert.equal(record.error, undefined); }
assert.equal(existsSync(actual.temporary), false); assert.equal(existsSync(types.root), false);
console.log(JSON.stringify({ verdict: "Recommend scoped combined77 + Stage2 composition acceptance; not full77 gate", candidate: actual.candidate,
  semanticFreeze: "1445dd79", executableFreeze: "b076eba4", typeBindingAmendment: "3c8a93d5", packageSha256: actual.package.sha256,
  archiveSha256: actual.archiveSha256, selectedInputs: 271, packageFiles: 846, emittedFiles: 844, layouts: summaries,
  behavioralMutationsRejected: 3, admissionControls: 3, supervisedMainChildren: actual.records.length, typeOnlyChildren: types.records.length,
  knownTemporaryRootsRemoved: 2, initialTypeBindingFailureRetained: true, newProductDefectsDemonstrated: 0,
  newExecutionsByDataVerifier: 0, qualifications: ["Post-candidate pre-inspection semantic freeze", "M01 requires bounded test watchdog; no forced process kill", "No source/API changes", "No component26/18/SafeJS25 rerun", "Node22 Darwin only", "Not a whole76/77 gate or private-engine proof"] }, null, 2));
