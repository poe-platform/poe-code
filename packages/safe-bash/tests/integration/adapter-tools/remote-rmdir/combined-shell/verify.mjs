import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../../../..");
const matrix = resolve(directory, "../combined-0487969");
const cohort = process.argv[2];
assert.equal(process.argv.length, 3);
assert.match(cohort, /^[a-z][a-z0-9-]*$/);
const evidence = join(directory, cohort);
assert.equal(existsSync(evidence), false);
mkdirSync(evidence);
const snapshot = mkdtempSync(join(directory, ".frozen-"));
const testPath = "tests/integration/adapter-tools/remote-rmdir/combined-shell/snapshot.test.ts";
const testBytes = readFileSync(join(root, testPath));
const sha256 = value => createHash("sha256").update(value).digest("hex");
const save = (name, value) => writeFileSync(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const capture = JSON.parse(readFileSync(join(matrix, "capture.json")));
const originalInputs = JSON.parse(readFileSync(join(matrix, "inputs.json")));
assert.equal(capture.sourceRevision, "04879692a66d88eee129b8ffd6e7ca93c7a9476a");
assert.equal(capture.inputRevision, "debb29ead94ae387f359d9d04b333ee4380f88d6");
assert.equal(sha256(JSON.stringify(originalInputs)), capture.inputHash);
const results = [];
function git(...args) {
  const result = spawnSync("git", args, { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
function verifyInputs() {
  for (const entry of originalInputs) assert.equal(sha256(readFileSync(join(snapshot, entry.path))), entry.sha256, entry.path);
  assert.deepEqual(readFileSync(join(snapshot, testPath)), testBytes);
}
function run(name, args, testCount) {
  verifyInputs();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const result = spawnSync(process.execPath, args, { cwd: snapshot, encoding: "utf8", timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", TSX_DISABLE_CACHE: "1", TMPDIR: snapshot } });
  writeFileSync(join(evidence, `${name}.stdout.log`), result.stdout ?? "", { flag: "wx" });
  writeFileSync(join(evidence, `${name}.stderr.log`), result.stderr ?? "", { flag: "wx" });
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key =>
    [key, Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(result.stdout ?? "")?.[1] ?? -1)]));
  verifyInputs();
  const receipt = { name, argv: [process.execPath, ...args], cwd: snapshot, startedAt, elapsedMs: performance.now() - started,
    status: result.status, signal: result.signal, error: result.error?.message ?? null, counts,
    sourceHash: capture.groupHashes.source, originalInputHash: capture.inputHash, testSha256: sha256(testBytes), unchangedInputs: true };
  save(`${name}.json`, receipt);
  results.push(receipt);
  console.log(JSON.stringify(receipt));
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  if (testCount !== undefined) assert.deepEqual(counts, { tests: testCount, pass: testCount, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
}
try {
  for (const archive of capture.archives) {
    const archivePath = join(matrix, archive.file);
    assert.equal(sha256(readFileSync(archivePath)), archive.sha256);
    const result = spawnSync("tar", ["-xzf", archivePath, "-C", snapshot]);
    assert.equal(result.status, 0);
  }
  mkdirSync(dirname(join(snapshot, testPath)), { recursive: true });
  writeFileSync(join(snapshot, testPath), testBytes);
  writeFileSync(join(evidence, "snapshot.test.ts.txt"), testBytes, { flag: "wx" });
  const compared = ["tests/integration/adapter-tools/fixtures.ts", "tests/integration/adapter-tools/matrix.test.ts",
    "tests/integration/adapter-tools/preflight-review/preflight.ts", "tests/integration/adapter-tools/preflight-review/preflight.test.ts",
    "src/fs/s3/mock.ts", "tests/fs/webdav/mock.ts"].map(path => {
    const original = git("show", `${capture.inputRevision}:${path}`);
    const combined = git("show", `${capture.sourceRevision}:${path}`);
    assert.deepEqual(combined, original, `no fixture/helper delta: ${path}`);
    return { path, originalSha256: sha256(original), combinedSha256: sha256(combined), unchanged: true };
  });
  save("provenance.json", { capturedAt: new Date().toISOString(), sourceRevision: capture.sourceRevision,
    inputRevision: capture.inputRevision, helperRevision: capture.helperRevision, sourceTree: capture.sourceTree,
    sourceHash: capture.groupHashes.source, originalInputHash: capture.inputHash, archives: capture.archives,
    node: capture.node.version, platform: capture.platform, arch: capture.arch, toolchain: capture.toolchain,
    runnerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))), testSha256: sha256(testBytes), compared,
    cleanupOperation: { operation: "rmSync", path: snapshot, recursive: true, force: true },
    policy: "Original79 unchanged; new6 separate. Actual S3FileSystem and unchanged MockS3Client; only new tests inject a late put via the public mock delete method. No real service, install, production edit or original-fixture waiver." });
  writeFileSync(join(evidence, "contract-profile.diff"), git("diff", capture.inputRevision, capture.sourceRevision, "--", "src/contracts/filesystem.md", "src/contracts/filesystem.ts"), { flag: "wx" });
  const compiler = join(root, "node_modules/typescript/bin/tsc");
  run("archived-build", [compiler, "-p", "tsconfig.build.json"]);
  run("new6", ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", testPath], 6);
  run("scoped-types", [compiler, "--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext",
    "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax",
    "--forceConsistentCasingInFileNames", "--skipLibCheck", "--types", "node", testPath]);
  save("summary.json", { sourceRevision: capture.sourceRevision, sourceHash: capture.groupHashes.source, results });
} finally {
  rmSync(snapshot, { recursive: true, force: true });
  save("cleanup.json", { operation: "rmSync", path: snapshot, recursive: true, force: true, existsAfter: existsSync(snapshot), observedAt: new Date().toISOString() });
}
