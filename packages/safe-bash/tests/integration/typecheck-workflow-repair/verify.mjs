import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("./evidence/manifest.json", import.meta.url)));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const committed = path => execFileSync("git", ["--no-replace-objects", "show", `${manifest.sourceCommit}:${path}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
assert.equal(sha256(committed(manifest.harness.path)), manifest.harness.sha256);
let captures = 0;
for (const attempt of manifest.attempts) {
  const bytes = readFileSync(join(root, attempt.path));
  assert.equal(sha256(bytes), attempt.sha256, attempt.path);
  const bundle = JSON.parse(bytes), files = new Map();
  for (const entry of bundle.files) {
    assert.equal(files.has(entry.path), false, "duplicate capture");
    const raw = gunzipSync(Buffer.from(entry.gzipBase64.join(""), "base64"));
    assert.equal(raw.length, entry.bytes); assert.equal(sha256(raw), entry.sha256);
    files.set(entry.path, JSON.parse(raw)); captures++;
  }
  const report = files.get("report.json"), combined = files.get("combined/report.json");
  assert.equal(report.candidate, attempt.candidate); assert.equal(report.archiveSha256, attempt.archiveSha256);
  assert.equal(report.passed, true); assert.equal(report.cleaned, true);
  assert.equal(report.checks.length, attempt.checks); assert.ok(report.checks.every(check => check.status === "pass"));
  assert.equal(combined.builds, 1); assert.equal(combined.phases.length, attempt.phaseCount);
  assert.equal(combined.runtimeExecutions, 0); assert.equal(combined.status, "typecheck-passed-not-runtime-acceptance");
  assert.equal(combined.consumers.groups.length, 19); assert.equal(combined.consumers.passed, true);
  assert.deepEqual(combined.consumers.negativeTypes.map(entry => entry.diagnostics), [1, 2, 5]);
  assert.equal(files.get("cold/report.json").status, "build-prerequisite-required");
  assert.equal(files.get("cold/report.json").phases.length, 0);
  assert.equal(files.get("source-error/report.json").phases.length, 1);
  assert.match(files.get("source-error/report.json").phases[0].stdout, /src\/contracts\/command.ts.*TS2322/u);
  if (attempt.name === "v3") {
    assert.equal(combined.sourceConsumers.groups.length, 3); assert.equal(combined.sourceConsumers.passed, true);
    for (const entry of report.overlay) assert.equal(sha256(committed(entry.path)), entry.sha256, entry.path);
    for (const entry of report.protectedInputs) assert.equal(sha256(committed(entry.path)), entry.sha256, entry.path);
    const productDelta = execFileSync("git", ["--no-replace-objects", "diff", "--name-only", attempt.candidate, manifest.sourceCommit, "--", "src", "package-lock.json"], { cwd: root, encoding: "utf8" });
    assert.equal(productDelta, "", "typing repair must not acquire product/dependency changes");
  }
}
console.log(JSON.stringify({ sourceCommit: manifest.sourceCommit, authenticatedCaptures: captures, attempts: manifest.attempts.length, finalChecks: 15, scope: "Frozen typing repair only; no current whole-product or service acceptance." }));
