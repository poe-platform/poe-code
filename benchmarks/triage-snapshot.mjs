import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({ options: {
  revision: { type: "string", default: "HEAD" },
  original: { type: "string", default: "benchmarks/reports/aggregate-head-integration.json" },
  output: { type: "string", default: "benchmarks/reports/full-snapshot-triage.json" },
} });
const original = JSON.parse(readFileSync(resolve(root, values.original), "utf8"));
const failures = original.exceptionalTests.filter(block => /^not ok /m.test(block) && !/^not ok .* # TODO/m.test(block)).map((block, index) => ({
  id: index + 1,
  title: block.match(/^# Subtest: (.*)$/m)[1],
  file: block.match(/location: '.*\/(tests\/.*?):\d+:\d+'/u)[1],
  originalFailure: block,
}));
assert.equal(failures.length, original.tapSummary.fail);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const revision = git("rev-parse", "--verify", "--end-of-options", `${values.revision}^{commit}`);
const archive = execFileSync("git", ["archive", revision], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
const directory = mkdtempSync(join(tmpdir(), "safe-bash-triage-head-"));
execFileSync("tar", ["-xf", "-", "-C", directory], { input: archive });
const digest = value => createHash("sha256").update(value).digest("hex");
const manifests = {};
for (const file of ["package.json", "package-lock.json"]) {
  const bytes = readFileSync(join(directory, file));
  assert.equal(digest(bytes), digest(readFileSync(join(root, file))), `Cached dependencies differ from archived ${file}`);
  manifests[file] = digest(bytes);
}
symlinkSync(join(root, "node_modules"), join(directory, "node_modules"), "dir");
const files = [...new Set(failures.map(failure => failure.file))].sort();
const args = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=2", ...files];
const startedAt = new Date().toISOString();
const result = spawnSync(process.execPath, args, { cwd: directory, encoding: "utf8", timeout: 180000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env } });
const stdout = result.stdout ?? "";
const stderr = result.stderr ?? "";
writeFileSync(join(directory, "focused.tap"), stdout);
const blocks = stdout.split(/(?=^# Subtest: )/m).filter(block => /^# Subtest:/m.test(block));
const seen = new Map();
for (const failure of failures) {
  const occurrence = seen.get(failure.title) ?? 0;
  seen.set(failure.title, occurrence + 1);
  const matching = blocks.filter(block => block.match(/^# Subtest: (.*)$/m)?.[1] === failure.title);
  const block = matching[occurrence];
  const line = block?.match(/^(?:not )?ok .*$/m)?.[0];
  failure.current = {
    status: !line ? "not-found" : /# TODO/u.test(line) ? "todo" : /# SKIP/u.test(line) ? "skip" : line.startsWith("not ok") ? "fail" : "pass",
    occurrence: occurrence + 1, matchingTests: matching.length,
    result: block ?? null,
  };
}
const summary = Object.fromEntries([...stdout.matchAll(/^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ([\d.]+)$/gm)].map(match => [match[1], Number(match[2])]));
const report = {
  schemaVersion: 1, originalRevision: original.snapshot.revision,
  snapshot: { revision, directory, archiveSha256: digest(archive), manifests },
  startedAt, finishedAt: new Date().toISOString(), node: process.version,
  command: [process.execPath, ...args], exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
  environment: { DIFF_PATCH_NATIVE_DIFF: process.env.DIFF_PATCH_NATIVE_DIFF ?? null, DIFF_PATCH_NATIVE_PATCH: process.env.DIFF_PATCH_NATIVE_PATCH ?? null, DIFF_WHITESPACE_ORACLE: process.env.DIFF_WHITESPACE_ORACLE ?? null },
  summary, originalOutcomeCounts: failures.reduce((counts, failure) => { const status = failure.current.status; counts[status] = (counts[status] ?? 0) + 1; return counts; }, {}),
  failures, currentFailures: blocks.filter(block => /^not ok /m.test(block)),
  stdoutSha256: digest(stdout), stderr, worktreeHeadAfter: git("rev-parse", "HEAD"),
  claims: { expectedValuesChanged: false, missingCasesArePasses: false, movingWorktreeValidated: false, scope: "All current tests in the files containing the historical failures; isolated committed source, concurrency two" },
};
const output = resolve(root, values.output);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, revision, summary, originalOutcomeCounts: report.originalOutcomeCounts }));
process.exitCode = result.status === 0 ? 0 : 1;
