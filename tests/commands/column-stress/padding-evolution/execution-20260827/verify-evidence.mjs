import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const base = fileURLToPath(new URL("../", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (name) => JSON.parse(await readFile(join(directory, name)));
const manifest = await json("MANIFEST.json");
const actualPaths = [];
async function enumerate(root, prefix) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await enumerate(join(root, entry.name), path);
    else { assert(entry.isFile(), `Unexpected evidence link: ${path}`); if (path !== "execution-20260827/MANIFEST.json") actualPaths.push(path); }
  }
}
await enumerate(directory, "execution-20260827");
await enumerate(join(base, "current-contract-revision"), "current-contract-revision");
assert.deepEqual(actualPaths.sort(), manifest.files.map((row) => row.path).sort());
for (const file of manifest.files) {
  const bytes = await readFile(join(base, file.path)); assert.equal(bytes.length, file.bytes, file.path); assert.equal(hash(bytes), file.sha256, file.path);
}
const prep = JSON.parse(await readFile(join(base, "seal.json")));
assert.equal(hash(await readFile(join(base, "seal.json"))), "93894eafdc02cc8bdee171f1301cbdf21a74b0c448697edffd3573de6f28ae8c");
for (const file of prep.files) assert.equal(hash(await readFile(join(base, file.path))), file.sha256);
const summary = await json("SUMMARY.json"), final = await json("captures/final-integrity.json");
assert.equal(summary.sourceDigest, "e4f9a8d1690600807d496ae8bc42409cc98344ee7bba10ea702a136d52cd370e");
assert.equal(summary.sourceDigest, final.sourceDigest);
assert.equal(final.archive.sha256, "6c707cc82366675b7e39282847a3b5365a916ad9d8c48694861e7f9f99e48bad");
assert.equal(final.package.tarSha256, "529496a1e75423c0de50415afca2098b421c11617447ba155799e2afdbd4a684");
assert.equal(final.ownedGroupsRemaining, 0);
const before = await json("captures/tree-before-runtime-summary.json"), after = await json("captures/tree-after-runtime-summary.json");
assert.equal(before.inventorySha256, after.inventorySha256); assert.equal(before.entryCount, 27390); assert.equal(after.originalGitBlobsVerified, 26647);
const input = await json("captures/run1/cohort-inputs.json");
for (const [path, expected] of Object.entries(input.harnessHashesBefore)) assert.equal(hash(await readFile(join(directory, path.slice(path.lastIndexOf("/") + 1)))), expected);
const literals = await json("captures/run1/literals.json");
assert.deepEqual(literals.counts, { total: 17, pass: 17, fail: 0 });
const golden = JSON.parse(await readFile(join(base, "expectations.json")));
for (const row of literals.cases) {
  const expected = golden.rows.find((item) => item.id === row.name), observed = row.observations[0];
  assert.equal(observed.stdoutHex, expected.stdoutHex); assert.equal(observed.stderrHex, expected.stderrHex); assert.equal(observed.status, expected.status);
}
let safetyTotal = 0;
const nested = [2, 1, 1, 1, 1, 2, 2, 2, 5, 1, 3, 2, 8, 4, 1, 2];
for (let index = 1; index <= 16; index++) {
  const result = await json(`captures/run1/E${String(index).padStart(2, "0")}.json`);
  assert.equal(result.counts.fail, 0); assert.equal(result.counts.total, nested[index - 1]); assert.equal(result.unhandled.length, 0); safetyTotal += result.counts.total;
}
assert.equal(safetyTotal, 38);
for (const [name, total] of [["author148", 148], ["owned-six-regressions", 6]]) {
  const result = await json(`captures/run1/${name}-process.json`), stdout = Buffer.from(result.stdoutHex, "hex").toString();
  assert.equal(result.status, 0); assert(stdout.includes(`# tests ${total}\n`)); assert(stdout.includes(`# pass ${total}\n`)); assert(stdout.includes("# fail 0\n")); assert(stdout.includes("# skipped 0\n")); assert(stdout.includes("# todo 0\n"));
}
const old = await json("captures/run1/unchanged-old40.json");
assert.equal(old.counts.topLevelPass, 39); assert.equal(old.counts.topLevelFail, 1); assert.equal(old.counts.originalRecipeVariants, 84); assert.equal(old.counts.variantPass, 87); assert.equal(old.counts.variantFail, 1);
assert.deepEqual(old.cases.filter((row) => row.verdict === "fail").map((row) => row.recipe), ["S38"]);
assert.equal((await json("captures/run1/unchanged-old40-process.json")).status, 1);
const packed = await json("captures/packed-runtime.json");
assert.equal(packed.passed, 7); assert.equal(packed.failed, 1); assert.equal((await json("captures/packed-runtime-process.json")).status, 1);
assert.equal(packed.results.find((row) => row.verdict === "fail").name, "external-hidden-return-root-boundary-remains-blocking");
assert.equal(packed.packageInventory.length, 738); assert.equal(hash(JSON.stringify(packed.packageInventory)), packed.packageInventorySha256);
assert.equal(summary.decisions.rootPublicIntegration, "HOLD");
assert(summary.decisions.currentContractRevision.includes("Prepared only"));
for (const path of ["captures/build.json", "captures/run1/scoped-types-process.json", "captures/packed-types-process.json"]) assert.equal((await json(path)).status, 0);
const trace = Buffer.from((await json("captures/packed-types-process.json")).stdoutHex, "hex").toString();
assert(trace.includes("Module name 'virtual-bash' was successfully resolved to '/private/tmp/safe-bash-column-padding-MmS9An/moved/node_modules/virtual-bash/dist/index.d.ts'"));
assert(trace.includes("Module name './node_modules/virtual-bash/dist/commands/column/index.js' was successfully resolved to '/private/tmp/safe-bash-column-padding-MmS9An/moved/node_modules/virtual-bash/dist/commands/column/index.d.ts'"));
for (const name of ["negative-wrong-padding", "negative-no-output-admission", "negative-rectangle", "negative-scan", "negative-work"]) {
  const result = await json(`captures/run1/${name}.json`), process = await json(`captures/run1/${name}-process.json`);
  assert(result.counts.fail > 0); assert.equal(process.status, 1); assert.equal(process.termination, null); assert.equal(process.groupAliveAfterRetirement, false);
}
assert.equal((await json("captures/run1/scan-probe-reference.json")).counts.fail, 0);
for (const process of final.processes) {
  assert.equal(process.groupAlive, false);
  if (process.termination) assert(["negative-hang-process.json", "negative-output-flood-process.json", "negative-worker-leak-process.json"].some((suffix) => process.capture.endsWith(suffix)));
}
assert.equal(final.processes.length, 35);
process.stdout.write(JSON.stringify({ staticEvidenceIntegrity: "PASS", scopedPadding: "GO", oldHoldoutRawFailures: 1, packedRawFailures: 1, rootPublicIntegration: "HOLD", currentContractRevision: "PREPARED_NOT_RUN", productExecutionByThisValidator: false }, null, 2) + "\n");
