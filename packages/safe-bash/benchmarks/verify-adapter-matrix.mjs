import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({ options: {
  revision: { type: "string", default: "HEAD" },
  output: { type: "string", default: "benchmarks/reports/adapter-matrix.json" },
} });
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const revision = git("rev-parse", "--verify", "--end-of-options", `${values.revision}^{commit}`);
const archive = execFileSync("git", ["archive", revision], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
const directory = mkdtempSync(join(tmpdir(), "safe-bash-adapter-matrix-"));
execFileSync("tar", ["-xf", "-", "-C", directory], { input: archive });
const digest = value => createHash("sha256").update(value).digest("hex");
const manifests = {};
for (const file of ["package.json", "package-lock.json"]) {
  const bytes = readFileSync(join(directory, file));
  assert.equal(digest(bytes), digest(readFileSync(join(root, file))), `Cached dependency manifest differs: ${file}`);
  manifests[file] = digest(bytes);
}
symlinkSync(join(root, "node_modules"), join(directory, "node_modules"), "dir");
const args = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", "tests/integration/adapter-tools/matrix.test.ts"];
const startedAt = new Date().toISOString();
const result = spawnSync(process.execPath, args, { cwd: directory, encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
const stdout = result.stdout ?? "";
const blocks = stdout.split(/(?=^# Subtest: )/m).filter(block => /^# Subtest:/m.test(block));
const cases = blocks.map(block => {
  const name = block.match(/^# Subtest: (.*)$/m)[1];
  const line = block.match(/^(?:not )?ok .*$/m)?.[0];
  return { name, status: !line ? "pending" : /# SKIP/u.test(line) ? "skip" : /# TODO/u.test(line) ? "todo" : line.startsWith("not ok") ? "fail" : "pass", raw: block };
});
const summary = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo|duration_ms) ([\d.]+)$/gm)].map(match => [match[1], Number(match[2])]));
const families = {};
for (const entry of cases) {
  const family = entry.name.split(":")[0];
  const count = families[family] ??= { total: 0, pass: 0, fail: 0, skip: 0, todo: 0, pending: 0 };
  count.total++; count[entry.status]++;
}
const report = {
  schemaVersion: 1, snapshot: { revision, directory, archiveSha256: digest(archive), manifests },
  startedAt, finishedAt: new Date().toISOString(), node: process.version,
  command: [process.execPath, ...args], exitCode: result.status, error: result.error?.message ?? null,
  summary, families, cases, stderr: result.stderr, stdoutSha256: digest(stdout),
  claims: { realCloudCredentialsTested: false, liveInternetWebDavTested: false, movingWorktreeTested: false, expectedValuesChanged: false, capabilitySkipsAccepted: false, fullGoalComplete: false },
};
writeFileSync(resolve(root, values.output), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ revision, summary, families, failures: cases.filter(entry => entry.status !== "pass").map(entry => entry.name) }));
process.exitCode = result.status === 0 ? 0 : 1;
