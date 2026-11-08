import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repository = "/Users/kjopek/Workspace/safe-bash";
const owner = "tests/integration/safejs-owned-output-prototype-review/lifecycle";
const original = "19da254941847de60e80ea18407332bbe10b5265";
const baseline = "c9b96263d1204bdf54e89324cc0c7d1ef6bd3f79";
const qualification = "e57b5aa16f749b6fac558877dff0712e64df05a8";
const sourceRoot = "/private/tmp/safe-bash-owned-output-receipt-review-zqBitE/source-route";
const packageRoute = "/private/tmp/safe-bash-owned-output-receipt-review-zqBitE/packaged-route";
const preparation = "/private/tmp/safe-bash-owned-output-prototype-preparation-rE94MK";
const packageRoot = `${preparation}/consumer/node_modules/virtual-bash`;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("/usr/bin/git", ["-C", repository, ...args], {
  env: { PATH: "/usr/bin:/bin", LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" },
  timeout: 20000, maxBuffer: 32 * 1024 * 1024,
});
const json = filename => JSON.parse(readFileSync(join(repository, filename), "utf8"));
const blob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
function regular(filename) {
  const stat = lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), filename);
  assert.equal(realpathSync(filename), resolve(filename));
  return { bytes: stat.size, sha256: sha(readFileSync(filename)), mode: stat.mode & 0o777,
    mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}
function inventory(root) {
  assert.equal(realpathSync(root), root);
  const entries = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const filename = join(directory, name);
      const stat = lstatSync(filename);
      assert.equal(stat.isSymbolicLink(), false, filename);
      if (stat.isDirectory()) visit(filename);
      else entries.push({ path: relative(root, filename), ...regular(filename) });
    }
  }
  visit(root);
  return entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
function checkOriginal() {
  const entries = git("ls-tree", "-r", original, "--", owner).toString().trim().split("\n");
  const records = entries.map(entry => {
    const [header, path] = entry.split("\t");
    const [mode, kind, oid] = header.split(" ");
    assert.equal(kind, "blob");
    const record = regular(join(repository, path));
    assert.equal(blob(readFileSync(join(repository, path))), oid, path);
    assert.equal(Boolean(record.mode & 0o111), mode === "100755");
    return { path, gitBlob: oid, ...record };
  });
  assert.equal(records.length, 74);
  return records;
}
function authenticatedDocument(commit, path) {
  const bytes = git("show", `${commit}:${path}`);
  assert.equal(sha(readFileSync(join(repository, path))), sha(bytes), path);
  return { path, commit, gitBlob: blob(bytes), bytes: bytes.length, sha256: sha(bytes) };
}
const started = new Date().toISOString();
const originalBefore = checkOriginal();
const sourceBefore = inventory(sourceRoot);
const packageBefore = inventory(packageRoute);
const consumerBefore = inventory(packageRoot);
const shared = json(`${owner}/execution-v1/evidence/attempt-01/shared-before.json`);
assert.deepEqual(sourceBefore, shared[sourceRoot]);
assert.deepEqual(packageBefore, shared[packageRoute]);
const expectedConsumer = shared[preparation].filter(entry => entry.path.startsWith("consumer/node_modules/virtual-bash/"))
  .map(entry => ({ ...entry, path: entry.path.slice("consumer/node_modules/virtual-bash/".length) }));
assert.deepEqual(consumerBefore, expectedConsumer);
assert.equal(sourceBefore.length, 940);
assert.equal(packageBefore.length, 940);
assert.equal(consumerBefore.length, 709);
const identityOnly = entries => entries.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
assert.deepEqual(identityOnly(sourceBefore), identityOnly(packageBefore));
const manifestPath = "tests/shell-stress/first-read-contract-review/owned-output-streaming-prototype/tested-manifest.json";
const manifestIdentity = authenticatedDocument(qualification, manifestPath);
const manifest = json(manifestPath);
assert.deepEqual(identityOnly(sourceBefore.filter(entry => entry.path.startsWith("src/"))), manifest.source);
assert.deepEqual(identityOnly(sourceBefore.filter(entry => entry.path.startsWith("dist/"))), manifest.compiled);
assert.deepEqual(identityOnly(sourceBefore.filter(entry => entry.path.startsWith("tests/"))), manifest.tests);
assert.equal(manifest.sourceManifestSha256, "6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea");
const pins = json(`${owner}/SOURCE-PINS.json`);
const documents = pins.receiptInputs.filter(entry => /CONTRACT\.md$|ordering-replay-q1\/REPORT\.md$/.test(entry.path))
  .map(entry => {
    const record = authenticatedDocument(entry.commit, entry.path);
    assert.equal(record.sha256, entry.sha256);
    return record;
  });
for (const path of ["REPORT.md", "SELECTED-BINDING-PRE-RUN.md"]) documents.push(authenticatedDocument(qualification,
  `tests/shell-stress/first-read-contract-review/owned-output-qualified-prototype/${path}`));
const receipt = "tests/integration/safejs-owned-output-prototype-review/receipt-review";
for (const [commit, path] of [
  ["07a7dae5db51612a23e74d1d164d33723d4d61b6", `${receipt}/attempts/r2/proof.json`],
  ["07a7dae5db51612a23e74d1d164d33723d4d61b6", `${receipt}/verification.json`],
  ["db139ae983ad66364e0367f9fb1ed0262ee61f63", `${receipt}/REPORT.md`],
]) documents.push(authenticatedDocument(commit, path));
assert.equal(json(`${receipt}/attempts/r2/proof.json`).status, "QUALIFIED_ACCEPT_ASSEMBLY_ONLY");
const relevant = ["src/contracts/command.md", "src/contracts/output.ts", "src/shell/shell.ts", "src/shell/runtime.ts",
  "src/shell/cleanup.ts", "src/shell/parser.ts", "src/shell/types.ts", "src/commands/safejs/README.md",
  "src/commands/safejs/index.ts", "src/commands/safejs/io.ts", "src/commands/network/README.md",
  "src/commands/network/types.ts", "src/commands/network/shared.ts", "src/commands/network/args.ts",
  "src/commands/network/curl.ts", "src/commands/network/index.ts", "dist/commands/network/types.d.ts",
  "dist/commands/network/shared.js", "dist/commands/network/args.js", "dist/commands/network/curl.js",
  "dist/shell/shell.js", "dist/shell/runtime.js", "dist/commands/safejs/index.js", "dist/contracts/output.d.ts"];
const relevantIdentities = relevant.map(path => {
  const found = sourceBefore.find(entry => entry.path === path);
  assert.ok(found, path);
  if (path.startsWith("dist/")) assert.equal(regular(join(packageRoot, path)).sha256, found.sha256);
  return found;
});
const unchangedNetworkInputs = ["src/commands/network/README.md", "src/commands/network/shared.ts", "src/commands/network/args.ts"]
  .map(path => {
    const bytes = git("show", `${baseline}:${path}`);
    assert.equal(sha(bytes), regular(join(sourceRoot, path)).sha256, path);
    return { path, commit: baseline, gitBlob: blob(bytes), sha256: sha(bytes) };
  });
const historicalTests = git("ls-tree", "-r", "--name-only", baseline, "--", "tests/commands/network").toString()
  .trim().split("\n").filter(path => path.endsWith(".ts"));
historicalTests.push("tests/shell/invocation-cleanup-lifecycle.test.ts");
const pattern = /maxRedirects|maxRetries|Invalid network limit|limitsFor|--max-redirs|--retry|execution rejection wins|ordinary command throw/;
const historicalInspection = historicalTests.map(path => {
  const bytes = git("show", `${baseline}:${path}`);
  return { path, commit: baseline, gitBlob: blob(bytes), bytes: bytes.length, sha256: sha(bytes),
    matches: bytes.toString().split("\n").flatMap((text, index) => pattern.test(text) ? [{ line: index + 1, text }] : []) };
});
const cases = json(`${owner}/CASES.json`);
const reports = Object.fromEntries(["L05-execution-error", "L06-curl-open"].map(id => [id,
  json(`${owner}/execution-v1/evidence/attempt-01/${id}.json`)]));
assert.equal(reports["L05-execution-error"].classification, "FAIL");
assert.equal(reports["L05-execution-error"].publicOutcome.kind, "rejection");
assert.equal(reports["L05-execution-error"].atSettlement.cleanupIdentity, true);
assert.equal(reports["L05-execution-error"].atSettlement.executionIdentity, false);
assert.equal(reports["L05-execution-error"].atSettlement.callerAborted, false);
assert.equal(reports["L05-execution-error"].events.find(entry => entry.event === "safejs-invoke-settled").status, 1);
assert.equal(reports["L06-curl-open"].classification, "INVALID_FIXTURE");
assert.equal(reports["L06-curl-open"].engineRuns, 0);
assert.deepEqual(reports["L06-curl-open"].publicOutcome.result,
  { exitCode: 1, stdout: "", stderr: "shell: line 1: Invalid network limit: maxRedirects\n" });
assert.equal(cases.curlInputs.limits.maxRedirects, 0);
assert.equal(cases.curlInputs.limits.maxRetries, 0);
assert.deepEqual(checkOriginal(), originalBefore);
assert.deepEqual(inventory(sourceRoot), sourceBefore);
assert.deepEqual(inventory(packageRoute), packageBefore);
assert.deepEqual(inventory(packageRoot), consumerBefore);
console.log(JSON.stringify({
  status: "STATIC_RECONCILIATION_INPUTS_VERIFIED_NOT_RUNTIME_ACCEPTANCE", started, finished: new Date().toISOString(),
  threadId: "01a04292-c8dd-7331-9dac-619c9861b11b", noPromotion: true,
  newExecutions: { guest: 0, engine: 0, product: 0, nativeCurl: 0, privateQueries: 0, privateReads: 0, builds: 0, installs: 0 },
  original: { commit: original, files: originalBefore.length, inputInventorySha256: sha(JSON.stringify(originalBefore)),
    beforeAfterIdentical: true, originalPreparation: "c8df5cf2819d7ad9d54c2a70800258c7c200665a",
    runnerCommit: "91464989ff4c563195330cc3a7cacc4500c0bad0", rawCounts: json(`${owner}/execution-v1/evidence/attempt-01/report.json`).counts },
  source: { root: sourceRoot, files: 940, sourceFiles: 213, compiledFiles: 708, fixtureFiles: 15,
    sourceManifestSha256: manifest.sourceManifestSha256, compiledManifestSha256: manifest.compiledManifestSha256,
    fullInventorySha256: sha(JSON.stringify(sourceBefore)), sourceAndPackageRoutesEqual: true,
    packageRoute, packageRoot, packageFiles: 709, beforeAfterIdentical: true, comparedToOriginalExecutionMetadata: true,
    newRegularEntriesCovered: true, symlinksRejected: true, emptyDirectoryAdditionsCovered: false,
    metadataScope: "bytes, length, mode, mtimeMs, ctimeMs; not atime, directory metadata or atomic/intervening state",
    manifestIdentity, relevantIdentities, unchangedNetworkInputs },
  documents, historicalInspection,
  historicalTestScope: "Six canonical network TypeScript files and one cleanup-lifecycle test from c9b; not executions or all current tests. Frozen candidate's 15 test/helper files matched separately.",
  originalObservations: Object.fromEntries(Object.entries(reports).map(([id, report]) => [id, {
    classification: report.classification, selected: report.selected, engineRuns: report.engineRuns,
    events: report.events, publicOutcome: report.publicOutcome, atSettlement: report.atSettlement, files: report.files,
  }])),
  originalCurlInputs: cases.curlInputs,
  executionCaveat: "JSON records are original 19da observations, not new execution. Serialized identity booleans rely on original in-child reference checks.",
}, null, 2));
