import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const { values } = parseArgs({ options: {
  revision: { type: "string", default: "HEAD" },
  output: { type: "string", default: "/tmp/safe-bash-s3-policy.json" },
  repeat: { type: "string", default: "1" },
  suite: { type: "string", default: "policy" },
} });
assert.ok(values.suite === "policy" || values.suite === "bounded");
const repeat = Number(values.repeat);
assert.ok(Number.isInteger(repeat) && repeat >= 1 && repeat <= 100);
const digest = value => createHash("sha256").update(value).digest("hex");
const revision = execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${values.revision}^{commit}`], { cwd: root, encoding: "utf8" }).trim();
const archive = execFileSync("git", ["archive", revision], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
const directory = mkdtempSync(join(tmpdir(), "safe-bash-s3-policy-"));
execFileSync("tar", ["-xf", "-", "-C", directory], { input: archive });
const manifests = {};
for (const file of ["package.json", "package-lock.json"]) {
  manifests[file] = digest(readFileSync(join(directory, file)));
  assert.equal(manifests[file], digest(readFileSync(join(root, file))), `cached dependencies differ: ${file}`);
}
symlinkSync(join(root, "node_modules"), join(directory, "node_modules"), "dir");
const testPath = `tests/stress/s3-policy/${values.suite === "bounded" ? "bounded-races" : "rename"}.test.ts`;
const tests = readFileSync(join(root, testPath));
mkdirSync(dirname(join(directory, testPath)), { recursive: true });
writeFileSync(join(directory, testPath), tests);
const observationPath = `tests/stress/s3-policy/${values.suite === "bounded" ? "bounded-observe" : "observe"}.ts`;
const observationBytes = readFileSync(join(root, observationPath));
writeFileSync(join(directory, observationPath), observationBytes);
const helperHashes = {};
if (values.suite === "bounded") {
  const helperPath = "tests/stress/s3-policy/profile-fixture.ts";
  const helper = readFileSync(join(root, helperPath));
  writeFileSync(join(directory, helperPath), helper);
  helperHashes[helperPath] = digest(helper);
}
const sourceHashes = {};
for (const file of ["filesystem.ts", "mock.ts", "transport.ts", "index.ts"]) {
  sourceHashes[file] = digest(readFileSync(join(directory, "src/fs/s3", file)));
}
const command = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", testPath];
const runs = [];
for (let iteration = 0; iteration < repeat; iteration++) {
  const result = spawnSync(process.execPath, command, { cwd: directory, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  const stdout = result.stdout ?? "";
  const summary = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo|duration_ms) ([\d.]+)$/gm)].map(match => [match[1], Number(match[2])]));
  const failures = [...stdout.matchAll(/^not ok \d+ - (.*)$/gm)].map(match => match[1]);
  runs.push({ iteration: iteration + 1, exitCode: result.status, error: result.error?.message ?? null, summary, failures, stdout, stderr: result.stderr });
}
const observed = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", observationPath], { cwd: directory, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
const report = {
  schemaVersion: 1, createdAt: new Date().toISOString(), node: process.version,
  snapshot: { revision, directory, archiveSha256: digest(archive), sourceHashes, manifests },
  testOverlay: { path: testPath, sha256: digest(tests), source: "current owned test only; all product source from archived revision" },
  helperHashes,
  limitations: { path: observationPath, sha256: digest(observationBytes), exitCode: observed.status, stdout: observed.stdout, stderr: observed.stderr },
  command: [process.execPath, ...command], runs,
  claims: { providerCredentialsUsed: false, productionAdapterEdited: false, globalSuiteRun: false, atomicRenameGuaranteed: false },
};
writeFileSync(resolve(root, values.output), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ revision, repeat, runs: runs.map(({ summary, failures }) => ({ summary, failures })) }));
process.exitCode = observed.status === 0 && runs.every(run => run.exitCode === 0 && run.summary.tests > 0 && run.summary.skipped === 0 && run.summary.todo === 0 && run.summary.cancelled === 0) ? 0 : 1;
