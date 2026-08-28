import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("/usr/bin/git", ["--no-replace-objects", "-C", repository, "-c", "core.fsmonitor=false", ...args],
  { env: { PATH: "/usr/bin:/bin", LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" }, maxBuffer: 64 * 1024 * 1024 });
const decode = (bytes, expected) => {
  const compressed = Buffer.from(bytes.toString(), "base64");
  assert.equal(sha256(compressed), expected);
  return JSON.parse(gunzipSync(compressed));
};
const actual = decode(readFileSync(path.join(own, "actual-01.json.gz.base64")), "15c632dfc66434239fec65b4efc0b26c7f535988ffc57a2fcb8681e2c8a40959");
const preflight = decode(readFileSync(path.join(own, "private-preflight-01.json.gz.base64")), "3b78f73be6b442945a8219a363ccb1a1d69d4884fc22208729f7a649e023ebe7");
const preparationFailure = decode(readFileSync(path.join(own, "preparation-failure-01.json.gz.base64")), "1389752f8e4f8f57cef566987c95ecd00ef1b8491cea4e5365455080ae726885");
assert.equal(preparationFailure.guestRuns, 0);
assert.equal(preparationFailure.privateQueries, 0);
assert.equal(preparationFailure.status, 1);
assert.equal(sha256(Buffer.from(preparationFailure.sourceBase64, "base64")), preparationFailure.sourceSha256);
const prior = decode(git("show", "7ca45f2decea9faab958b15577a55aac2be1c40c:tests/shell/cancellation-stage2-independent-20260827/review-fd1/focused-02.json.gz.base64"),
  "0b8d23c455983c196f95d44334aca0300570150faf28e8cd361c24a44ef06cd1");
const entryBytes = entry => {
  const bytes = Buffer.from(entry.base64, "base64");
  assert.equal(bytes.length, entry.bytes);
  assert.equal(sha256(bytes), entry.sha256);
  return bytes;
};
const entryJson = entry => JSON.parse(entryBytes(entry));
const recipePrefix = "tests/integration/owned-output-production-rebase/author-public";
const recipe = name => git("show", `${actual.recipeCommit}:${recipePrefix}/${name}`);
assert.equal(actual.sourceOrigin, "fd1daa123298568546d9ea4e95f8c81dde9c52ff");
assert.equal(prior.candidate, actual.sourceOrigin);
assert.equal(actual.recipeCommit, "7204b9e01752c700dd791afd332e7f1b5fd8ba73");
assert.equal(actual.sourceArchiveSha256, sha256(Buffer.from(prior.archiveBase64, "base64")));
assert.equal(actual.packageSha256, sha256(Buffer.from(prior.package.base64, "base64")));
assert.equal(actual.binding.sourceManifestSha256, sha256(JSON.stringify(prior.sourceInventory)));
assert.equal(Object.keys(prior.sourceInventory).length, 254);
assert.deepEqual(actual.publicBefore, actual.publicAfter);
assert.equal(actual.publicBefore.selectedInputTreeUnchanged, true);
assert.equal(actual.publicBefore.newEntriesChecked, true);
assert.equal(actual.completed, true);
assert.equal(actual.temporaryRemoved, true);
assert.deepEqual(actual.counts, { intended: 25, pass: 25, engineRuns: 25, nonpass: 0 });
assert.deepEqual(preflight.before, preflight.expected);
assert.deepEqual(preflight.after, preflight.before);
assert.equal(preflight.guestRuns, 0);
assert.equal(preflight.engineCopies, 0);
assert.equal(preflight.before.head, "bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e");
assert.equal(preflight.before.engine.length, 264);
assert.equal(Object.keys(preflight.before.metadata).length, 6);
for (const entry of actual.recipeInputs) assert.equal(sha256(recipe(entry.name)), entry.sha256);
for (const [name, bytes] of Object.entries(actual.harness)) assert.equal(sha256(readFileSync(path.join(own, name))), sha256(Buffer.from(bytes, "base64")));
for (const entry of Object.values(actual.preparedDriver)) entryBytes(entry);
const configuration = entryJson(actual.preparedDriver["FD1-INPUTS.json"]);
assert.deepEqual(configuration.binding, actual.binding);
for (const entry of configuration.generatedInputs) assert.equal(actual.preparedDriver[entry.name].sha256, entry.sha256);
for (const entry of configuration.productEntries.filter(entry => entry.kind === "file")) assert.equal(entry.sha256, prior.sourceInventory[entry.path].sha256);
assert.equal(configuration.productEntries.filter(entry => entry.kind === "file").length, 254);
const packed = actual.binding.packageEntries.filter(entry => entry.kind === "file");
assert.equal(packed.length, 834);
assert.equal(packed.filter(entry => entry.path.startsWith("dist/")).length, 832);
for (const entry of packed.filter(entry => entry.path.startsWith("dist/"))) assert.equal(entry.sha256, prior.emittedInventory[entry.path.slice(5)].sha256);
let supervisor = recipe("safejs-execution-v1/supervisor.mjs").toString();
assert.equal(sha256(supervisor), actual.supervisorBinding.originalSha256);
const unchangedSection = text => text.slice(text.indexOf("function auditImports("), text.indexOf("export async function runCohort("));
assert.equal(sha256(unchangedSection(supervisor)), actual.supervisorBinding.auditAndChildExecutionSha256);
for (const replacement of actual.supervisorBinding.replacements) {
  assert.equal(supervisor.split(replacement.before).length, 2);
  supervisor = supervisor.replace(replacement.before, replacement.after);
}
assert.equal(sha256(supervisor), actual.supervisorBinding.effectiveSha256);
assert.equal(supervisor, entryBytes(actual.preparedDriver["supervisor.mjs"]).toString());
assert.equal(sha256(unchangedSection(supervisor)), actual.supervisorBinding.auditAndChildExecutionSha256);
assert.equal(actual.supervisorBinding.assertionChanges, 0);
assert.equal(sha256(recipe("safejs-execution-v1/loader.mjs")), actual.preparedDriver["loader.mjs"].sha256);
const gitObject = (kind, bytes) => createHash("sha1").update(`${kind} ${bytes.length}\0`).update(bytes).digest("hex");
assert.equal(gitObject("commit", Buffer.from(actual.selectedGitSnapshot.commitBody, "base64")), actual.selectedGitSnapshot.commit);
for (const tree of actual.selectedGitSnapshot.treeObjects) assert.equal(gitObject("tree", Buffer.from(tree.bytes, "base64")), tree.sha1);
assert.equal(actual.binding.candidateCommit, actual.selectedGitSnapshot.commit);
assert.equal(actual.binding.candidateTree, actual.selectedGitSnapshot.tree);
const rows = [];
for (const cohort of actual.cohorts) {
  const report = cohort.report;
  for (const entry of [...Object.values(cohort.evidence), ...Object.values(cohort.logs)]) entryBytes(entry);
  assert.deepEqual(entryJson(cohort.evidence["report.json"]), report);
  const before = entryJson(cohort.evidence["private-before.json"]);
  assert.deepEqual(before, preflight.expected);
  assert.deepEqual(entryJson(cohort.evidence["private-after.json"]), before);
  assert.deepEqual(entryJson(cohort.evidence["immutable-after.json"]), entryJson(cohort.evidence["immutable-before.json"]));
  assert.deepEqual(report.publicBefore, report.publicAfter);
  assert.equal(report.privateBeforeAfter, "EXACTLY_UNCHANGED");
  assert.equal(report.copiedInputsBeforeAfter, "UNCHANGED_INCLUDING_NEW_ENTRIES");
  assert.equal(report.publicBeforeAfter, "UNCHANGED_INCLUDING_NEW_ENTRIES");
  assert.equal(report.candidateCommit, actual.binding.candidateCommit);
  assert.deepEqual(report.knownLiveChildren, []);
  assert.equal(cohort.temporaryRemoved, true);
  const binding = entryJson(cohort.evidence["current-import-binding.json"]);
  const permitted = new Map(binding.files.map(entry => [entry.path, entry]));
  assert.equal(binding.allowedEnginePaths.length, 63);
  assert.equal(report.knownChildren.length, report.rows.length);
  for (const row of report.rows) {
    assert.equal(row.classification, "PASS");
    assert.equal(row.engineRuns, 1);
    assert.equal(row.containment, false);
    assert.equal(row.naturalExit, true);
    const child = report.knownChildren.find(child => child.id === row.id);
    assert.equal(child.closed, true);
    assert.equal(child.code, 0);
    assert.equal(child.signal, null);
    assert.equal(child.containment, null);
    const audit = entryJson(cohort.logs[`${row.id}/import-audit.json`]);
    assert.deepEqual(audit.failures, []);
    assert.equal(audit.engineSourceFiles, 63);
    assert.equal(audit.productFiles, 204);
    const enginePaths = new Set();
    const productPaths = new Set();
    for (const load of audit.raw) {
      assert.equal(load.candidateCommit, actual.binding.candidateCommit);
      assert.equal(load.sha256, permitted.get(load.path)?.sha256, load.path);
      if (load.kind === "actual-engine-source-copy") {
        enginePaths.add(load.path);
        assert.equal(load.sha256, before.engine.find(entry => `engine/${entry.path}` === load.path)?.sha256);
      }
      if (load.kind === "packed-public-product") {
        productPaths.add(load.path);
        assert.ok(load.path.startsWith("consumer/node_modules/virtual-bash/dist/"));
        assert.equal(load.sha256, prior.emittedInventory[load.path.slice("consumer/node_modules/virtual-bash/dist/".length)]?.sha256);
      }
    }
    assert.deepEqual([...enginePaths].sort(), [...binding.allowedEnginePaths].sort());
    assert.equal(productPaths.size, 204);
    const observed = entryJson(cohort.logs[cohort.family === "surface" ? `${row.id}/actual.json` : `${row.id}.json`]);
    const assessment = entryJson(cohort.logs[`${row.id}/assessment.json`]);
    if (cohort.family === "surface") {
      assert.equal(assessment.outcome, "PASS");
      assert.ok(assessment.checks.every(check => check.pass));
      assert.equal(observed.runtimeCalls, 1);
      assert.deepEqual(observed.cleanupFailures, []);
    } else {
      assert.equal(observed.classification, "PASS");
      assert.equal(observed.engineRuns, 1);
      assert.equal(observed.disposed, true);
      assert.equal(observed.disposeSettled, true);
      assert.deepEqual(observed.unhandled, []);
    }
    if (observed.network) {
      assert.equal(observed.network.authorizationJournal.length, 1);
      assert.equal(observed.network.transportCalls, 1);
      assert.equal(observed.network.transportCleanupCalls, 1);
      assert.equal(observed.network.responseDisposeCalls, 1);
      assert.equal(observed.network.additionalTransportEntries, 0);
    }
    rows.push({ family: cohort.family, id: row.id, outcome: "PASS", engineRuns: 1, packedModules: 204,
      engineModules: 63, publicKind: observed.publicOutcome?.kind, exitCode: observed.publicOutcome?.result?.exitCode,
      category: assessment.category, naturalExit: true });
  }
}
assert.equal(rows.length, 25);
for (const root of [actual.root, ...actual.cohortRoots]) assert.equal(existsSync(root), false, root);
console.log(JSON.stringify({ status: "QUALIFIED_EXISTING_SAFEJS25_FD1_REGRESSION_PASS", sourceOrigin: actual.sourceOrigin,
  selectedCommit: actual.selectedGitSnapshot.commit, selectedTree: actual.selectedGitSnapshot.tree,
  sourceArchiveSha256: actual.sourceArchiveSha256, packageSha256: actual.packageSha256,
  actualCaptureCompressedSha256: "15c632dfc66434239fec65b4efc0b26c7f535988ffc57a2fcb8681e2c8a40959",
  counts: actual.counts, privateGuardPairs: 3, privateGuard: "EXACTLY_UNCHANGED", childrenNaturallyClosed: 25,
  temporaryRootsAbsent: 4, actualGuestExecutionsByThisDataVerifier: 0, privateAccessByThisDataVerifier: false,
  qualification: actual.qualification, rows }, null, 2));
