import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../..");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const blob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const seal = JSON.parse(fs.readFileSync(path.join(own, "SYNTAX-SEAL.json")));
const records = seal.captures.map(capture => {
  const artifact = fs.readFileSync(path.join(own, capture.path));
  assert.equal(sha(artifact), capture.artifactSha256);
  const json = gunzipSync(Buffer.from(artifact.toString(), "base64"));
  assert.equal(sha(json), capture.jsonSha256);
  const report = JSON.parse(json);
  assert.equal(report.success, true);
  assert.equal(report.baseTree, seal.baseTree);
  assert.equal(report.basePackageSha256, seal.basePackageSha256);
  assert.equal(report.baseInputs.length, 265);
  assert.equal(report.commands.length, capture.commands);
  assert.equal(report.ownedChildrenSettled, true);
  assert.equal(report.sourceStableIncludingNewEntries, true);
  for (const command of report.commands) {
    assert.equal(command.signal, null);
    assert.equal(command.error, null);
    assert(command.settledAt !== undefined);
    assert.equal(command.status, command.label.startsWith("loaded-private-mutant-") ? 1 : 0);
  }
  const tests = report.commands.find(command => command.label === "source-private-syntax-tests");
  for (const line of ["# tests 4", "# pass 4", "# fail 0", "# cancelled 0", "# skipped 0", "# todo 0"]) assert(tests.stdout.includes(line + "\n"));
  for (const binding of Object.values(report.overlays)) {
    const bytes = Buffer.from(binding.base64, "base64");
    assert.equal(sha(bytes), binding.sha256);
    assert.equal(blob(bytes), binding.blob);
  }
  return report;
});
const final = records.at(-1);
assert.equal(final.revision, "094d2ba1cc021ea4f07dc07a30062b5922bc336e");
for (const [name, binding] of Object.entries(final.overlays)) {
  const result = spawnSync("git", ["show", `${final.revision}:${name}`], { cwd: repository, timeout: 10000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0);
  assert.equal(sha(result.stdout), binding.sha256);
}
const driver = spawnSync("git", ["show", `${final.revision}:tests/shell/indexed-arrays-author-20260828/validate-syntax.mjs`], { cwd: repository, timeout: 10000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
assert.equal(driver.status, 0);
assert.equal(sha(driver.stdout), final.driver.sha256);
assert.deepEqual(driver.stdout, Buffer.from(final.driver.base64, "base64"));
for (const entry of final.sourceLoads) assert.equal(entry.sha256, final.buildInventory[entry.key]);
assert.equal(new Set(final.sourceLoads.map(entry => entry.key)).size, 5);
assert.equal(final.mutationControls.length, 2);
for (const control of final.mutationControls) {
  const original = Buffer.from(final.overlays["src/shell/arrays/syntax.ts"].base64, "base64").toString();
  assert.equal(original.split(control.from).length, 2);
  assert.equal(sha(original.replace(control.from, control.to)), control.transformedSha256);
  assert.equal(control.rejectedByExecutedAssertion, true);
  assert(control.loads.some(entry => entry.key === "src/shell/arrays/syntax.ts" && entry.sha256 === control.transformedSha256));
  for (const entry of control.loads) assert.equal(entry.sha256, entry.key === "src/shell/arrays/syntax.ts" ? control.transformedSha256 : final.buildInventory[entry.key]);
}
assert.equal(seal.foundationCandidate, null);
assert.equal(seal.publicShellExecRuns, 0);
process.stdout.write(JSON.stringify({ status: "static-syntax-evidence-authenticated", attempts: records.length, committedHelperTests: "4/4", executedPrivateGuardMutants: 2, integratedFoundation: false, runtimeReplay: false }) + "\n");
