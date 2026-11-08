import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const output = dirname(fileURLToPath(import.meta.url));
const owned = resolve(output, "../..");
const repository = resolve(owned, "../../../..");
const hash = value => createHash("sha256").update(value).digest("hex");
const read = async name => JSON.parse(await readFile(join(output, name), "utf8"));
const save = (name, value) => writeFile(join(output, name), `${JSON.stringify(value, null, 2)}\n`);
const before = await read("manifest-before.json");
const after = await read("manifest-after.json");
const summary = await read("summary.json");
const cleanup = await read("leaf-process-cleanup.json");
assert.equal(before.revision, "b02bbe855b6b45d635b521e3dc2f31ea2b04e215");
assert.deepEqual(before.inputHashes, after.inputHashes);
assert.equal(hash(await readFile(join(output, "source-b02bbe8.tar.gz"))), before.archiveSha256);
for (const [path, expected] of Object.entries(before.inputHashes)) {
  assert.equal(hash(execFileSync("git", ["show", `${before.revision}:${path}`], { cwd: repository })), expected, path);
}
for (const entry of before.historical) assert.equal(hash(await readFile(join(repository, entry.path))), entry.sha256, entry.path);
for (const result of summary.results) {
  assert.equal(result.sourceStability.revision, before.revision);
  assert.equal(result.sourceStability.beforeSha256, before.sourceSetSha256);
  assert.equal(result.sourceStability.afterSha256, before.sourceSetSha256);
  assert.equal(result.sourceStability.stable, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.residualGroup, false);
  assert.equal(hash(await readFile(join(output, `${result.name}.stdout`))), result.stdoutSha256);
  assert.equal(hash(await readFile(join(output, `${result.name}.stderr`))), result.stderrSha256);
}
assert.equal(cleanup.allRecordedCommandsClosed, true);
assert.deepEqual(cleanup.residualGroups, []);
assert.deepEqual(cleanup.remainingOwnedScratchEntries, []);
assert.equal(cleanup.ownedNativeRootRemoved, true);
const original = await read("original43.observations.json");
const qualified = await read("diagnostic-qualified43.observations.json");
const baseline = JSON.parse(await readFile(join(owned, "evidence/qualified-checkpoint-307938f/original43.observations.json"), "utf8"));
const failures = observations => observations.filter(entry => entry.outcome && entry.outcome.status !== "success");
assert.equal(original.length, 43);
assert.equal(qualified.length, 43);
assert.equal(original.filter(entry => entry.outcome?.status === "success").length, 31);
assert.equal(qualified.filter(entry => entry.outcome?.status === "success").length, 38);
assert.equal(original.filter(entry => !entry.outcome).length, 5);
assert.deepEqual(failures(original).map(entry => entry.case), failures(baseline).map(entry => entry.case));
assert.equal(failures(original).length, 7);
for (const entry of failures(original)) {
  assert.deepEqual(entry.after, entry.before, entry.case);
  assert.ok(entry.operations.length > 0);
  assert.ok(entry.operations.every(operation => ["listObjectsV2", "headObject", "PROPFIND"].includes(operation.operation)), entry.case);
}
const qualifiedByName = new Map(qualified.map(entry => [entry.case, entry]));
const caseMap = original.map(entry => {
  const diagnostic = qualifiedByName.get(entry.case);
  assert.ok(diagnostic, entry.case);
  if (!entry.outcome) {
    assert.deepEqual(entry.before, entry.after);
    assert.deepEqual(diagnostic.before, diagnostic.after);
  } else assert.equal(diagnostic.outcome.status, "success");
  return { case: entry.case, original: entry.outcome ?? { status: "guard-passed", expectedCode: entry.expectedCode },
    qualifiedDiagnostic: diagnostic.outcome ?? { status: "guard-passed", expectedCode: diagnostic.expectedCode },
    originalOperations: entry.operations ?? [], diagnosticOperations: diagnostic.operations ?? [],
    ...(entry.outcome && entry.outcome.status !== "success" ? {
      phase: entry.action === "mv" ? "core existing-target authoritative-distinctness guard" : "mount existing-target unknown-identity guard",
      classification: "required ordinary overwrite unresolved for original unqualified transport; not old core EXDEV defect",
      expected: "success with exact target payload; move also removes source",
      originalBefore: entry.before, originalAfter: entry.after, diagnosticAfter: diagnostic.after,
    } : {}),
  };
});
await save("case-map.json", caseMap);
const originalFixture = await readFile(join(output, "original43.fixture.ts.txt"), "utf8");
const diagnosticFixture = await readFile(join(output, "diagnostic-qualified.fixture.ts.txt"), "utf8");
const delta = await read("diagnostic-qualified-input.json");
let reconstructed = originalFixture;
for (const [from, to] of delta.replacements) {
  assert.equal(reconstructed.split(from).length, 2);
  reconstructed = reconstructed.replace(from, to);
}
assert.equal(reconstructed, diagnosticFixture);
const assertions = source => {
  const parsed = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
  const calls = [];
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(parsed).startsWith("assert.")) calls.push(node.getText(parsed));
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return calls;
};
assert.deepEqual(assertions(originalFixture), assertions(diagnosticFixture));
assert.equal(hash(originalFixture), before.fixtureSha256);
assert.equal(hash(await readFile(join(owned, "compatibility.test.ts"))), before.fixtureSha256);
assert.equal(hash(diagnosticFixture), delta.diagnosticSha256);
assert.equal((await read("scoped-fs-types.json")).code, 0);
assert.equal((await read("diagnostic-qualified-types.json")).code, 0);
await save("integrity-audit.json", { revision: before.revision, auditedAt: new Date().toISOString(),
  committedInputsVerified: Object.keys(before.inputHashes).length, sources: Object.keys(before.sourceHashes).length,
  stableSourceCohorts: summary.results.length, historicalFilesUnchanged: before.historical.length,
  originalPositivePass: 31, originalPositiveFail: 7, originalGuardsPass: 5, diagnosticPositivePass: 38, diagnosticGuardsPass: 5,
  assertionCallsByteIdentical: assertions(originalFixture).length, originalAndQualifiedTypesExit: [0, 0],
  allRecordedChildrenClosed: true, ownScratchRemoved: true,
  ownedStatus: execFileSync("git", ["status", "--porcelain=v1", "--", "tests/fs/mount/identity-compatibility-review"], { cwd: repository, encoding: "utf8" }) });
const artifactHashes = {};
for (const name of (await readdir(output)).sort()) if (name !== "artifact-sha256.json") artifactHashes[name] = hash(await readFile(join(output, name)));
artifactHashes["../../checkpoint-b02bbe8.mjs"] = hash(await readFile(join(owned, "checkpoint-b02bbe8.mjs")));
await save("artifact-sha256.json", artifactHashes);
console.log(JSON.stringify({ revision: before.revision, artifactsSealed: Object.keys(artifactHashes).length, original: "31/38 + 5/5", diagnosticOnly: "38/38 + 5/5, types exit 0" }));
