import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const directory = "tests/commands/metadata-stress/canonical-env";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = args => {
  const result = spawnSync("git", args, { maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const classificationPath = "tests/integration/full-gate-20260827/evidence/classification.json";
const classification = JSON.parse(readFileSync(classificationPath));
const failures = classification.failures.filter(row => /^tests\/commands\/(metadata-stress|table-text-stress)\//u.test(row.path));
assert.equal(failures.filter(row => row.classification === "native-prerequisite").length, 22);
assert.equal(failures.filter(row => row.classification === "artifact-hash-expectation").length, 1);
const testPaths = [...new Set(failures.map(row => row.path))];
const inputs = [...new Set([...testPaths,
  "tests/commands/metadata-stress/helpers.ts",
  "tests/commands/metadata-stress/oracle-evidence.json",
  "tests/commands/table-text-stress/support.ts",
  "tests/commands/table-text-stress/first-discrepancy.json",
  "tests/commands/table-text-stress/frozen-corpus.json",
  "tests/commands/table-text-stress/shared-stdin-fix/support.ts",
  "tests/commands/table-text/gnu-evidence.json",
  ...git(["ls-files", "src", "tests/commands/metadata", "tests/commands/table-text"]).toString().trim().split("\n"),
  "package.json", "package-lock.json",
])];
const historicalPaths = new Set(git(["ls-tree", "-r", "--name-only", classification.revision]).toString().trim().split("\n"));
const files = inputs.map(path => {
  const captured = historicalPaths.has(path) ? git(["show", `${classification.revision}:${path}`]) : undefined;
  const current = readFileSync(path);
  return { path, capturedSha256: captured ? hash(captured) : null, currentSha256: hash(current), capturedBlob: captured ? git(["rev-parse", `${classification.revision}:${path}`]).toString().trim() : null };
});
const snapshots = testPaths.map(path => ({ path, captured: git(["show", `${classification.revision}:${path}`]).toString(), current: readFileSync(path, "utf8") }));
const startedAt = new Date().toISOString();
const head = git(["rev-parse", "HEAD"]).toString().trim();
const status = git(["status", "--short"]).toString();
const argv = ["--import", "tsx", "--test", "--test-reporter=tap", "--test-concurrency=1", ...testPaths];
const result = spawnSync(process.execPath, argv, { cwd: process.cwd(), env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" }, timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
const record = { startedAt, finishedAt: new Date().toISOString(), head, status, node: process.version, platform: process.platform, arch: process.arch, cwd: process.cwd(), classificationPath, classificationSha256: hash(readFileSync(classificationPath)), capturedRevision: classification.revision, originalCounts: { metadataPrerequisites: 20, tablePrerequisites: 2, provenanceMismatch: 1 }, failures, files, snapshots, argv: [process.execPath, ...argv], environment: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" }, result: { status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout?.toString(), stderr: result.stderr?.toString() } };
const output = resolve(directory, "original.json");
assert.equal(existsSync(output), false, "capture is immutable");
const patch = `*** Begin Patch\n*** Add File: ${output}\n${JSON.stringify(record, null, 2).split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
const saved = spawnSync("apply_patch", [], { input: patch, encoding: "utf8", maxBuffer: 1024 * 1024 });
assert.equal(saved.status, 0, saved.stderr);
console.log(JSON.stringify({ output, status: result.status, summary: result.stdout?.toString().match(/^# (tests|pass|fail|skipped|todo|cancelled).*$/gmu) }));
