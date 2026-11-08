import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshot, sha256, requireAuthority } from "./integrity.mjs";
import { describeCase } from "./adapters.mjs";
import { inversions, invert } from "./types.mjs";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const owned = fileURLToPath(new URL("../", import.meta.url));
const preparation = "executor-preparation-v1/";
const prefix = "tests/shell/directory-stack-independent-20260828/";
const argumentsList = process.argv.slice(2);
assert(argumentsList.length === 0 || (argumentsList.length === 2 && argumentsList[0] === "--commit" && /^[a-f0-9]{40}$/.test(argumentsList[1])));
const sealedCommit = argumentsList[1];
const git = (args) => execFileSync("git", args, { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
const json = (path) => JSON.parse(readFileSync(resolve(owned, path), "utf8"));
const binding = json(preparation + "BINDING.json");
const readiness = json(preparation + "READINESS.json");
const authorityTemplate = json(preparation + "AUTHORIZATION-TEMPLATE.json");
const seal = json(preparation + "SEAL.json");
const cases = json("freeze-v1/cases.json").cases;
const proofs = json("freeze-v1/proofs.json");
const originalNames = ["README.md", "freeze-v1/BINDING.json", "freeze-v1/CONTRACT.md", "freeze-v1/SEAL.json", "freeze-v1/STATIC-ATTEMPTS.json", "freeze-v1/cases.json", "freeze-v1/controls.json", "freeze-v1/proofs.json", "freeze-v1/verify.mjs", "ratification-v1/BINDING.json", "ratification-v1/HANDOFF.md", "ratification-v1/SEAL.json", "ratification-v1/STATIC-ATTEMPTS.json", "ratification-v1/verify.mjs"].sort();
const newNames = ["ATTEMPTS.json", "AUTHORIZATION-TEMPLATE.json", "BINDING.json", "READINESS.json", "README.md", "SEAL.json", "adapters.mjs", "child-process.mjs", "executor.mjs", "import-probe.mjs", "integrity.mjs", "lifecycle.mjs", "load-hook.mjs", "mechanisms.mjs", "public-cases.mjs", "public-driver.mjs", "raw/JS-SYNTAX-01.json", "raw/JS-SYNTAX-02.json", "raw/JS-SYNTAX-03.json", "raw/STATIC-01.json", "raw/STATIC-02.json", "raw/STATIC-03.json", "raw/SYNTHETIC-01.json", "raw/SYNTHETIC-02.json", "raw/SYNTHETIC-03.json", "synthetic.mjs", "types-negative.mts.fixture", "types-positive.mts.fixture", "types.mjs", "verify.mjs"].map((name) => preparation + name).sort();
const allNames = [...originalNames, ...newNames].sort();
const directories = ["executor-preparation-v1", "executor-preparation-v1/raw", "freeze-v1", "ratification-v1"];

function validate(data, descriptor, template) {
  assert.equal(data.freezeCommit, "302351279c8ca6122c618e72768782c8ad118878");
  assert.equal(data.ratificationBindingCommit, "8a930834c606f6a6688abb9eb0edeb3ba76924cb");
  assert.equal(data.authorityCommit, "232c2f357a1049cbf096dbef3051445c8f7c476b");
  assert.equal(data.candidate, null); assert.equal(data.acceptedLet, null); assert.equal(data.rootStackGo, false); assert.equal(data.stackWindowReleased, false);
  assert.equal(data.noOriginalFilesModified, true);
  const counts = { rows: 138, invariants: 24, positiveTypes: 8, negativeTypes: 8, mutationFamilies: 16, importNegativeFamilies: 6 };
  assert.deepEqual(data.originalCounts, counts); assert.deepEqual(descriptor.originalCounts, counts);
  assert.deepEqual(descriptor.cases, cases.map(describeCase));
  assert.deepEqual(descriptor.statusCounts, { prepared: 124, gaps: 14 });
  assert.deepEqual(descriptor.invariants.map((entry) => entry.id), proofs.sourceInvariants.map((entry) => entry.id));
  for (const entry of descriptor.invariants) { assert.equal(entry.role, "pinned-source-proof-pending-exact-candidate"); assert.equal(entry.dynamicMeasurement, false); }
  assert.equal(descriptor.mutations.length, 16); assert.equal(descriptor.importControls.length, 6);
  assert.deepEqual(descriptor.types.negativeSites, inversions);
  assert.equal(descriptor.types.productCompilation, "gated-unrun");
  assert.deepEqual(data.history, { nativeOriginal: 34, virtualOriginal: 34, virtualMatches: 0, topologyNativeOnly: 4, grammarNativeOnly: 8, grammarVirtualRuns: 0 });
  assert.equal(template.kind, "NOT-AUTHORIZED-TEMPLATE"); assert.equal(template.rootStackGo, false); assert.equal(template.stackWindowReleased, false);
  assert.throws(() => requireAuthority(template), { name: "AssertionError" });
}
function membership(tree) {
  assert.deepEqual(Object.keys(tree.files).sort(), allNames);
  assert.deepEqual(tree.directories, directories);
  for (const metadata of Object.values(tree.files)) assert.equal(metadata.mode, 0o644);
}
function local() {
  const tree = snapshot(owned);
  membership(tree);
  assert.deepEqual(seal.files, newNames);
  assert.deepEqual(Object.keys(seal.sha256).sort(), newNames.filter((path) => path !== preparation + "SEAL.json"));
  for (const [path, expected] of Object.entries(seal.sha256)) assert.equal(tree.files[path].sha256, expected, path);
  for (const reference of binding.originalFiles) { const path = reference.path.slice(prefix.length); assert.equal(tree.files[path].sha256, reference.sha256); assert.deepEqual(readFileSync(resolve(owned, path)), git(["show", `${reference.commit}:${reference.path}`])); }
  if (sealedCommit) {
    const committed = git(["ls-tree", "-r", sealedCommit, "--", prefix]).toString("utf8").trim().split("\n");
    assert.deepEqual(committed.map((entry) => entry.slice(entry.indexOf("\t") + 1).slice(prefix.length)).sort(), allNames);
    for (const entry of committed) assert.match(entry, /^100644 blob /);
    for (const path of newNames) assert.deepEqual(readFileSync(resolve(owned, path)), git(["show", `${sealedCommit}:${prefix}${path}`]));
  }
  return tree;
}
local();
validate(binding, readiness, authorityTemplate);
assert.equal(binding.originalFiles.length, 14); assert.equal(binding.acceptedApiReferences.length, 10);
assert.deepEqual(binding.originalFiles.map((entry) => entry.path.slice(prefix.length)).sort(), originalNames);
for (const reference of [...binding.originalFiles, ...binding.acceptedApiReferences]) {
  const bytes = git(["show", `${reference.commit}:${reference.path}`]); assert.equal(bytes.length, reference.bytes); assert.equal(sha256(bytes), reference.sha256);
  assert.equal(git(["ls-tree", reference.commit, "--", reference.path]).toString("utf8").trim(), `${reference.mode} blob ${reference.blob}\t${reference.path}`);
}
const positive = readFileSync(resolve(owned, preparation, "types-positive.mts.fixture"), "utf8");
const negative = readFileSync(resolve(owned, preparation, "types-negative.mts.fixture"), "utf8");
assert.equal([...positive.matchAll(/export const TP\d\d/g)].length, 8); assert.equal([...negative.matchAll(/export const TN\d\d/g)].length, 8);
assert(!positive.includes("@ts-") && !negative.includes("@ts-"));
for (const entry of inversions) assert.notEqual(invert(negative, entry.id), negative);
const latest = json(preparation + "raw/SYNTHETIC-03.json");
const report = JSON.parse(latest.stdout);
for (const [name, expected] of Object.entries(latest.inputHashes)) if (name !== "verify.mjs") assert.equal(sha256(readFileSync(resolve(owned, preparation, name))), expected, `synthetic helper/fixture bytes changed since capture: ${name}`);
assert.equal(latest.exitStatus, 0); assert.equal(report.passed, 42); assert.equal(report.failed, 0); assert.equal(report.scratchRemoved, true);
assert.deepEqual(report.checks.map((entry) => entry.id), Array.from({ length: 42 }, (_, index) => "Y" + String(index + 1).padStart(2, "0")));
for (const key of ["productBuilds", "productImports", "productTypeCompiles", "nativeOracleRuns", "providerRequests", "cohortRuns"]) assert.equal(report[key], 0);
const syntax = json(preparation + "raw/JS-SYNTAX-03.json"); assert.equal(syntax.passed, 13); assert.equal(syntax.failed, 0);
for (const [name, expected] of Object.entries(syntax.inputHashes)) if (name !== "verify.mjs") assert.equal(sha256(readFileSync(resolve(owned, preparation, name))), expected, `syntax helper/fixture bytes changed since capture: ${name}`);
const rejected = [];
function rejects(id, operation) { assert.throws(operation, { name: "AssertionError" }); rejected.push(id); }
const initialTree = snapshot(owned);
rejects("P01", () => membership({ ...initialTree, files: { ...initialTree.files, "extra.txt": { mode: 0o644 } } }));
rejects("P02", () => membership({ ...initialTree, files: Object.fromEntries(Object.entries(initialTree.files).filter(([name]) => name !== "README.md")) }));
rejects("P03", () => assert.equal(sha256(Buffer.from("changed original")), binding.originalFiles[0].sha256));
const changedCase = structuredClone(readiness); changedCase.cases[0].status = "runtime-pass"; rejects("P04", () => validate(binding, changedCase, authorityTemplate));
const changedRole = structuredClone(readiness); changedRole.invariants[0].dynamicMeasurement = true; rejects("P05", () => validate(binding, changedRole, authorityTemplate));
rejects("P06", () => validate(binding, readiness, { ...authorityTemplate, rootStackGo: true }));
rejects("P07", () => validate({ ...binding, originalCounts: { ...binding.originalCounts, rows: 139 } }, readiness, authorityTemplate));
rejects("P08", () => validate({ ...binding, candidate: "HEAD" }, readiness, authorityTemplate));
local();
process.stdout.write(JSON.stringify({ status: "static-only-pass", at: new Date().toISOString(), sealedCommit: sealedCommit ?? null, immutableOriginalFiles: 14, preparationFiles: 30, apiReferencesAuthenticated: 10, originalCountsUnchanged: binding.originalCounts, preparedAdaptersUnexecuted: 124, boundedAdapterGaps: 14, sourceProofsPending: 24, typedFixtures: { positive: 8, negative: 8, inversions: 8, productCompiles: 0 }, latestSynthetic: { passed: 42, failed: 0 }, latestJavaScriptSyntax: { passed: 13, failed: 0 }, staticNegativesRejected: rejected, appendAwareBeforeAfter: true, productBuilds: 0, productImports: 0, productTypeCompiles: 0, nativeOracleRuns: 0, providerRequests: 0, cohortRuns: 0, stackAuthorized: false }, null, 2) + "\n");
