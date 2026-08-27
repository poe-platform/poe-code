import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const evidence = JSON.parse(readFileSync(new URL("./evidence.json", import.meta.url)));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const committed = path => execFileSync("git", ["--no-replace-objects", "show", `${evidence.sourceCommit}:${path}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
assert.equal(sha256(committed(evidence.harness.path)), evidence.harness.sha256);
const files = new Map();
for (const entry of evidence.captures) {
  assert.equal(files.has(entry.path), false);
  const bytes = gunzipSync(Buffer.from(entry.gzipBase64.join(""), "base64"));
  assert.equal(bytes.length, entry.bytes); assert.equal(sha256(bytes), entry.sha256);
  files.set(entry.path, JSON.parse(bytes));
}
const report = files.get("report.json"), combined = files.get("combined/report.json"), warm = files.get("binding-full-warm/report.json");
assert.equal(report.candidate, evidence.baseCommit); assert.equal(report.passed, true); assert.equal(report.cleaned, true);
assert.equal(report.checks.length, 22); assert.ok(report.checks.every(check => check.status === "pass"));
for (const entry of [...report.overlay, ...report.protectedInputs]) assert.equal(sha256(committed(entry.path)), entry.sha256, entry.path);
assert.equal(combined.builds, 1); assert.equal(combined.candidateBinding.declarations.length, 177);
assert.equal(combined.sourceConsumers.groups.length, 3); assert.equal(combined.sourceConsumers.passed, true);
assert.equal(combined.consumers.groups.length, 19); assert.equal(combined.consumers.passed, true);
assert.deepEqual(combined.consumers.negativeTypes.map(group => group.diagnostics), [1, 2, 5]);
assert.equal(combined.runtimeExecutions, 0); assert.equal(warm.builds, 0); assert.equal(warm.status, "typecheck-failed");
assert.equal(report.commands.find(command => command.label === "binding-full-warm").status, 2);
assert.equal(report.commands.find(command => command.label === "binding-mixed").status, 0);
const rejected = warm.consumers.groups.filter(group => group.status === "fail");
assert.equal(rejected.length, 1); assert.equal(rejected[0].name, "env-split-public-types");
assert.match(rejected[0].error, /foreign candidate declaration\/source fallback: virtual-bash\/contracts/u);
assert.equal(execFileSync("git", ["diff", "--name-only", evidence.baseCommit, evidence.sourceCommit, "--", "src", "package.json", "package-lock.json", "tsconfig.json"], { cwd: root, encoding: "utf8" }), "");
console.log(JSON.stringify({ sourceCommit: evidence.sourceCommit, captures: files.size, authorChecks: 22, actualWarmMixedStatus: 2, independentAcceptance: "pending", productRuntimeExecutions: 0 }));
