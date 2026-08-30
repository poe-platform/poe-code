import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("./", import.meta.url);
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const json = async (name: string) => JSON.parse(await readFile(new URL(name, directory), "utf8"));

test("routed review preserves the exact five historical recipes and the remaining tmp mismatch", async () => {
  const captured = await json("five-replay.json");
  assert.deepEqual(captured.counts, { rows: 5, exact: 4, streamsAndStatus: 5, nativeFrozenExact: 5 });
  assert.equal(captured.results.length, 5);
  for (const row of captured.results) {
    assert.equal(hash(JSON.stringify(row.recipe)), row.recipeSha256);
    assert.equal(row.frozenProduct.comparison.pass, false);
    for (const field of ["stdout", "stderr", "exitCode", "entries"]) assert.deepEqual(row.native[field], row.frozenNative[field]);
    for (const field of ["stdout", "stderr", "exitCode"]) assert.deepEqual(row.current.observation[field], row.frozenNative[field]);
    if (row.id === "command/patch/dry-run") {
      assert.equal(row.comparison.pass, false);
      assert.deepEqual(row.namespaceDifferences, [{ path: "tmp", native: { type: "directory" }, current: null }]);
    } else {
      assert.equal(row.comparison.pass, true);
      assert.deepEqual(row.namespaceDifferences, []);
    }
  }
  assert.equal(captured.historicalFailureCount, 18);
  assert.deepEqual(captured.snapshotDrift, []);
  assert.deepEqual(captured.processExit, { code: 0, signal: null });
});

test("routed review distinguishes source fixes, legacy profile conflict and semantic controls", async () => {
  const checkpoint = await json("source-checkpoint.json");
  const inputs = await json("snapshot-inputs.json");
  assert.equal(checkpoint.sourceFixCommits, 2);
  assert.equal(checkpoint.reviewerProductionChanges, 0);
  for (const [path, digest] of Object.entries(checkpoint.sourceHashes)) assert.equal(inputs.hashes[path], digest);
  assert.equal(inputs.beforeDigest, inputs.afterDigest);
  assert.equal(inputs.afterDigest, inputs.frozenDigest);
  assert.equal(hash(JSON.stringify(inputs.hashes)), inputs.frozenDigest);
  for (const control of checkpoint.mutationControls) {
    assert.equal(control.baseline.pass, 3);
    assert.equal(control.mutation.fail, 3);
    assert.equal(control.mutation.exitCode, 1);
    assert.equal(control.restored.pass, 3);
  }
  const correction = await json("profile-correction.json");
  assert.equal(correction.pass, 4);
  assert.equal(correction.fail, 1);
  assert.equal(correction.incident.unintendedNativeInvocation.executable, "/usr/bin/stat");
});

test("routed review verifies both unchanged historical archives without rerunning SGID", async () => {
  const captured = await json("five-replay.json");
  assert.equal(captured.archiveChecks.length, 10);
  for (const record of captured.archiveChecks) {
    const bytes = await readFile(new URL(`../routed-five-checkpoint/${record.archive}`, directory));
    assert.equal(bytes.length, record.bytes);
    assert.equal(hash(bytes), record.sha256);
  }
  const sgid = await json("sgid-archive-check.json");
  assert.equal(sgid.checks.length, 10);
  assert.equal(sgid.unresolvedCases, 6);
  assert.equal(sgid.historicalInputHashes, 97);
  assert.equal(sgid.freshSGIDExecutionCount, 0);
  for (const record of sgid.checks) {
    const bytes = await readFile(new URL(`../../metadata-stress/sgid-feasibility/${record.destination}`, directory));
    assert.equal(bytes.length, record.bytes);
    assert.equal(hash(bytes), record.sha256);
  }
});

test("routed review retains the table profile and the strict original-helper load blocker", async () => {
  const captured = await json("table-verification.json");
  const commands = new Map<string, { pass: number; fail: number; exitCode: number }>();
  for (const command of captured.commands) commands.set(command.name, command);
  assert.equal(commands.get("table-existing104")?.pass, 104);
  assert.equal(commands.get("table-existing104")?.fail, 0);
  assert.equal(commands.get("table-existing311")?.pass, 291);
  assert.equal(commands.get("table-existing311")?.fail, 3);
  assert.equal(commands.get("table-current-public-built71x2")?.exitCode, 0);
  assert.equal(captured.cohorts.frozenNativeInputs, 71);
  assert.equal(captured.cohorts.knownCommGap, 1);
  assert.equal(captured.cohorts.priorMutationControls, 4);
  assert.equal(captured.cleaned.length, 71);
  assert.deepEqual(captured.snapshotDrift, []);
  assert.equal(captured.restoredInputs.length, 1);
  assert.equal(captured.restoredInputs[0].path, "tests/fs/webdav/mock.ts");
  const current = await json("table-current-helper-verification.json");
  assert.equal(current.command.pass, 311);
  assert.equal(current.command.fail, 0);
  assert.equal(current.compatibility.exitCode, 0);
  assert.equal(current.helper.historicalSha256, captured.restoredInputs[0].historicalSha256);
  assert.equal(current.helper.currentSha256, captured.restoredInputs[0].snapshotSha256);
  assert.deepEqual(current.snapshotDrift, []);
});

test("routed review raw logs retain exact bytes, including failed and corrected attempts", async () => {
  const logs = await json("execution-logs.json");
  const names = new Set<string>();
  for (const log of logs) {
    assert.equal(hash(Buffer.from(log.stdoutBase64, "base64")), log.stdoutSha256);
    assert.equal(hash(Buffer.from(log.stderrBase64, "base64")), log.stderrSha256);
    assert.equal(names.has(log.name), false);
    names.add(log.name);
  }
  for (const name of ["stat-original-author-profile", "stat-original-author-profile-corrected", "mutation-patch-historical", "mutation-stat-historical", "table-existing311"]) assert.equal(names.has(name), true);
});
