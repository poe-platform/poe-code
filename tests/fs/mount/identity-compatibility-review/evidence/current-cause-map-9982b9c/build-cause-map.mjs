import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const output = dirname(fileURLToPath(import.meta.url));
const owned = resolve(output, "../..");
const repository = resolve(owned, "../../../..");
const ownedPath = "tests/fs/mount/identity-compatibility-review";
const revision = "9982b9c8810f13d4a2d8dc6c4a70fca9154e4bc1";
const git = (...args) => execFileSync("git", args, { cwd: repository });
const hash = value => createHash("sha256").update(value).digest("hex");
const load = async path => JSON.parse(await readFile(path, "utf8"));
const previous = await load(resolve(owned, "evidence/frozen-59b1269-compatibility/observations.json"));
const earlierMoving = await load(resolve(owned, "evidence/moving-traversal-followup/observations.json"));
const current = await load(resolve(output, "observations.json"));
const manifest = await load(resolve(output, "manifest.json"));
assert.equal(manifest.revision, revision);
assert.equal(current.length, 43);
assert.equal(manifest.testSha256, "9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734");
assert.equal(hash(await readFile(resolve(owned, "compatibility.test.ts"))), manifest.testSha256);
assert.equal(hash(await readFile(resolve(output, "source-9982b9c.tar.gz"))), manifest.archiveSha256);
const historical = git("ls-tree", "-r", "--name-only", "6f04859", "--", ownedPath).toString().trim().split("\n");
for (const path of historical) assert.equal(hash(await readFile(resolve(repository, path))), hash(git("show", `6f04859:${path}`)), path);

const contract = git("show", `${revision}:src/contracts/filesystem.ts`).toString();
assert.equal(contract.includes("compareEntry"), false);
const phases = {
  copy: { phase: "FS existing-target identity preflight", owner: "Curie authority decision; filesystem owner mount/backend integration", source: "src/fs/mount/index.ts:422" },
  mv: { phase: "Core move planning, existing-target identity preflight", owner: "Curie authority decision and core proof consumer; filesystem owner proof implementation", source: "src/commands/move.ts:68" },
  recovered: { phase: "Previously core EXDEV; copy and guarded cleanup now complete", owner: "Committed Curie core fix; no reproduced remaining issue", source: "src/commands/filesystem.ts:169" },
};
const metadata = new Set(["PROPFIND", "headObject", "listObjectsV2"]);
const oldFailures = previous.filter(row => row.outcome && row.outcome.status !== "success");
assert.equal(oldFailures.length, 15);
const cases = oldFailures.map(before => {
  const now = current.find(row => row.case === before.case);
  const moving = earlierMoving.find(row => row.case === before.case);
  assert.ok(now && moving);
  const recovered = now.outcome.status === "success";
  const phase = recovered ? phases.recovered : phases[now.action];
  assert.ok(phase);
  const operationCounts = Object.fromEntries([...new Set(now.operations.map(entry => entry.operation))]
    .map(operation => [operation, now.operations.filter(entry => entry.operation === operation).length]));
  if (!recovered) {
    assert.deepEqual(now.after, now.before, now.case);
    assert.ok(now.operations.length > 0);
    assert.ok(now.operations.every(entry => metadata.has(entry.operation)), now.case);
    if (now.action === "copy") {
      assert.equal(now.outcome.code, "ENOTSUP");
      assert.equal(now.outcome.cause, "ENOTSUP: operation not supported");
    } else {
      assert.equal(now.outcome.exitCode, 1);
      assert.equal(now.outcome.stderr, "mv: ENOTSUP: existing move destination lacks authoritative distinctness '/left/source' -> '/right/target'\\n");
      assert.ok(git("show", `${revision}:src/commands/move.ts`).toString().includes("existing move destination lacks authoritative distinctness"));
    }
  }
  return {
    case: now.case, previousFrozen59: before.outcome, earlierMoving: moving.outcome, current: now.outcome,
    ...phase, needsApprovedAuthority: !recovered, separateUnblockedFsDefectObserved: false,
    operationCounts, operations: now.operations,
    namespaceBefore: now.before, namespaceAfter: now.after,
    zeroDataOrRemovalOperations: recovered ? null : true,
    localDataCallsInstrumented: false,
  };
});
const success = rows => rows.filter(row => row.outcome?.status === "success").length;
const regressionNames = previous.filter(row => row.outcome?.status === "success"
  && current.find(now => now.case === row.case)?.outcome?.status !== "success").map(row => row.case);
const movingOutcomeChanges = earlierMoving.filter(row => JSON.stringify(row.outcome ?? row.expectedCode)
  !== JSON.stringify(current.find(now => now.case === row.case)?.outcome ?? current.find(now => now.case === row.case)?.expectedCode)).map(row => row.case);
assert.deepEqual(regressionNames, []);
assert.deepEqual(movingOutcomeChanges, []);
assert.equal(cases.filter(row => row.needsApprovedAuthority).length, 10);
assert.equal(cases.filter(row => !row.needsApprovedAuthority).length, 5);
assert.equal(success(current), 28);
const missingCopyControls = current.filter(row => row.action === "copy" && row.case.endsWith("target missing"));
assert.equal(missingCopyControls.length, 10);
assert.ok(missingCopyControls.every(row => row.outcome.status === "success"));
const result = {
  revision, fixtureSha256: manifest.testSha256, archiveSha256: manifest.archiveSha256,
  sourceSetSha256: manifest.sourceSetSha256, sourceHashes: manifest.sourceHashes,
  authoritativeContractRevision: manifest.authoritativeContract, compareEntryInCurrentContract: false,
  proposalOnlyRevision: git("rev-parse", "29fe1bf").toString().trim(),
  separateS3PolicyEvidenceRevision: git("rev-parse", "d0948bb").toString().trim(),
  historicalFilesVerifiedUnchanged: historical.length,
  priorFrozen59Positive: { total: 38, pass: success(previous), fail: 38 - success(previous) },
  earlierMovingPositive: { total: 38, pass: success(earlierMoving), fail: 38 - success(earlierMoving), notRelabeledAsCommitted: true },
  current: { counts: manifest.counts, positive: { total: 38, pass: success(current), fail: 38 - success(current) }, rejection: { total: 5, pass: 5 }, typecheckExitCode: manifest.typecheckExitCode, cohortExecutionsThisAssignment: 1 },
  classification: { fsUnknownCopyPreflight: 8, coreUnknownMovePreflight: 2, formerlyCoreExdevNowRecovered: 5, sourceAcquisitionOrDeletionGuardFailures: 0, separateUnblockedFsDefects: 0 },
  regressionNames, movingOutcomeChanges,
  meaningfulDefaultMissingCopyControls: missingCopyControls.map(row => ({ case: row.case, outcome: row.outcome })),
  cases,
};
await writeFile(resolve(output, "cause-map.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ revision, current: result.current, classification: result.classification, historicFilesUnchanged: historical.length, archiveSha256: manifest.archiveSha256, sourceSetSha256: manifest.sourceSetSha256, hashes: Object.fromEntries(["src/fs/mount/index.ts", "src/commands/move.ts", "src/commands/filesystem.ts", "src/contracts/filesystem.md", "src/contracts/filesystem.ts"].map(path => [path, manifest.sourceHashes[path]])) }, null, 2));
