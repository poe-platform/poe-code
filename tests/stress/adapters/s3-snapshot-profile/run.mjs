import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const owned = "tests/stress/adapters/s3-snapshot-profile";
const output = resolve(process.argv[2] ?? "");
assert.equal(process.argv.length, 3, "usage: node run.mjs <new owned evidence directory>");
assert.ok(output.startsWith(join(root, owned, "evidence") + "/"));
assert.equal(existsSync(output), false, "immutable evidence output already exists");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim();
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const require = createRequire(join(root, "package.json"));
const loader = require.resolve("tsx/esm");
const compiler = require.resolve("typescript/bin/tsc");
const fixture = "tests/stress/adapters/remote-safe-workflows.test.ts";
const controls = [
  ["marker-controls", "tests/fs/s3/rmdir.test.ts", "^(snapshot rmdir deletes only the empty marker with conditionalDelete=(false|true)|a child created after the empty listing survives successful marker removal|rmdir rejects (explicit|implicit) directory containing (file|nested/file|child/)|pre-abort, read-only mode, and root protection make no requests)$", 10],
  ["inspection-controls", "tests/fs/s3/rmdir-real-service/snapshot-profile/rmdir-profile.test.ts", "^(snapshot capability is frozen and does not enable atomic rename or conditional DELETE|removal requests at least two keys and paginates with configured pageSize=1|an empty intermediate page is not completion; deletion waits for the marker and final page|(missing completeness flag|missing continuation token|disappeared marker) refuses before deletion|file-prefix ambiguity is unchanged and not deleted|late byte child, nested marker and nested bytes survive; no rollback or ENOTEMPTY after delete|an implicit directory losing its final child does not authorize marker deletion)$", 9],
  ["authority-refusal", "tests/fs/s3/constructor-comparison.test.ts", "^serialized SDK alias and existing target with unknown authority$", 1],
  ["stock-webdav-refusal", "tests/fs/webdav/rmdir.test.ts", "^(empty rmdir is unsupported with (lock|etag) policy and never locks or deletes|a child created after the empty PROPFIND survives without DELETE)$", 3],
];
const sourceCommit = git("rev-parse", "HEAD");
const configs = git("ls-files", "package.json", "package-lock.json", ":(glob)tsconfig*.json").split("\n");
assert.equal(git("diff", "HEAD", "--name-only", "--", "src", ...configs), "", "source/config must match the committed freeze");
const helperPaths = ["tests/fs/conformance/fixtures.ts", "tests/fs/webdav/mock.ts"];
const ownedInputs = ["assertions.ts", "profile-guards.test.ts", "preservation.test.ts", "run.mjs", "historical/manifest.json", "historical/README.md", "historical/author-start-inputs.json", "historical/classification-report.md.data", "historical/remote-safe-workflows.test.ts.data"].map(path => `${owned}/${path}`);
const historical = JSON.parse(readFileSync(join(root, owned, "historical/manifest.json"), "utf8"));
const referencedEvidence = [historical.originalFailure.raw.path, historical.originalFailure.routing.path, historical.originalFailure.repositoryManifest.path];
const immutablePaths = [...new Set([...git("ls-files", "src").split("\n"), ...configs, ...helperPaths, ...controls.map(control => control[1]), ...referencedEvidence])].sort();
const inputPaths = [...new Set([...immutablePaths, fixture, ...ownedInputs])].sort();
const inputHashes = inputPaths.map(path => ({ path, sha256: sha256(readFileSync(join(root, path))) }));
const report = {
  classification: "fresh bounded author replay; not historical raw, full gate, provider acceptance or independent review",
  startedAt: new Date().toISOString(), sourceCommit,
  candidate: { fixtureSha256: inputHashes.find(input => input.path === fixture).sha256, ownedDiff: git("diff", "HEAD", "--name-only", "--", fixture, owned), ownedUntracked: git("ls-files", "--others", "--exclude-standard", "--", owned) },
  runtime: { node: process.version, executable: process.execPath, platform: process.platform, arch: process.arch, loader, loaderSha256: sha256(readFileSync(loader)), tsx: require("tsx/package.json").version },
  sourceConfigAndInputHashes: inputHashes, statusBefore: git("status", "--porcelain=v1"), indexBefore: git("diff", "--cached", "--name-only"), runs: [],
};
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), "s3-snapshot-author-"));
report.temporary = temporary;
const run = (name, args, expectedStatus, expectedTests) => {
  const result = spawnSync(process.execPath, args, { cwd: temporary, env: { ...process.env, TSX_DISABLE_CACHE: "1" }, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  writeFileSync(join(output, `${name}.stdout.log.data`), stdout);
  writeFileSync(join(output, `${name}.stderr.log.data`), stderr);
  const counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  const record = { name, executable: process.execPath, args, cwd: temporary, envOverride: { TSX_DISABLE_CACHE: "1" }, status: result.status, signal: result.signal, error: result.error?.message, counts, stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr) };
  report.runs.push(record);
  console.log(JSON.stringify({ name, status: result.status, counts }));
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, expectedStatus, stdout + stderr);
  if (expectedTests !== undefined) {
    assert.equal(counts.tests, expectedTests);
    assert.equal(counts.fail, expectedStatus === 1 ? 1 : 0);
    assert.equal(counts.pass, expectedTests - counts.fail);
    for (const key of ["cancelled", "skipped", "todo"]) assert.equal(counts[key], 0);
  }
  return stdout;
};
const testArgs = (files, pattern) => ["--import", loader, "--test", "--test-reporter=tap", "--test-concurrency=1", ...(pattern ? [`--test-name-pattern=${pattern}`] : []), ...files];
try {
  const archive = execFileSync("git", ["archive", sourceCommit, ...immutablePaths, fixture], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  const unpacked = spawnSync("tar", ["-x", "-C", temporary], { input: archive });
  assert.equal(unpacked.status, 0);
  for (const path of immutablePaths) assert.equal(sha256(readFileSync(join(temporary, path))), inputHashes.find(input => input.path === path).sha256, `committed input differs: ${path}`);
  for (const path of ownedInputs) {
    mkdirSync(dirname(join(temporary, path)), { recursive: true });
    copyFileSync(join(root, path), join(temporary, path));
  }
  copyFileSync(join(temporary, owned, "historical/remote-safe-workflows.test.ts.data"), join(temporary, fixture));
  report.baselineFixtureSha256 = sha256(readFileSync(join(temporary, fixture)));
  assert.equal(report.baselineFixtureSha256, historical.originalFixture.sha256);
  const baseline = run("fresh-old-assertion", testArgs([fixture], "^s3: named-file cleanup leaves parents and unsupported empty rmdir has no effects$"), 1, 1);
  assert.ok(baseline.includes("Missing expected rejection."));
  copyFileSync(join(root, fixture), join(temporary, fixture));
  run("migrated-workflows", testArgs([fixture]), 0, 6);
  run("new-guards", testArgs([`${owned}/profile-guards.test.ts`, `${owned}/preservation.test.ts`]), 0, 20);
  for (const [name, file, pattern, count] of controls) run(name, testArgs([file], pattern), 0, count);
  const scopedConfig = { extends: "./tsconfig.json", compilerOptions: { noEmit: true, typeRoots: [join(root, "node_modules/@types")] }, files: [fixture, `${owned}/assertions.ts`, `${owned}/profile-guards.test.ts`, `${owned}/preservation.test.ts`], include: [], exclude: [] };
  writeFileSync(join(temporary, "tsconfig.scoped.json"), JSON.stringify(scopedConfig, null, 2) + "\n");
  report.scopedTypeConfig = scopedConfig;
  run("scoped-types", [compiler, "-p", "tsconfig.scoped.json"], 0);
  for (const input of inputHashes) {
    assert.equal(sha256(readFileSync(join(root, input.path))), input.sha256, `working input changed during replay: ${input.path}`);
    assert.equal(sha256(readFileSync(join(temporary, input.path))), input.sha256, `isolated input changed during replay: ${input.path}`);
  }
  report.status = "bounded-pass-with-preserved-old-failure";
} catch (error) {
  report.status = "author-run-failed";
  report.error = String(error);
  process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
  report.cleaned = !existsSync(temporary);
  report.finishedAt = new Date().toISOString();
  report.headAfter = git("rev-parse", "HEAD");
  report.statusAfter = git("status", "--porcelain=v1");
  report.indexAfter = git("diff", "--cached", "--name-only");
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: report.status, cleaned: report.cleaned, output: relative(root, output), error: report.error }));
}
