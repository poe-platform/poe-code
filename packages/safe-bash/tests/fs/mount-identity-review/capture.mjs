import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const owned = fileURLToPath(new URL(".", import.meta.url));
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const [revisionInput, label] = process.argv.slice(2);
assert.ok(revisionInput && label && /^[a-z0-9-]+$/.test(label), "usage: node tests/fs/mount-identity-review/capture.mjs REVISION LABEL");
const git = (...parameters) => execFileSync("git", parameters, { cwd: repository, encoding: "utf8" }).trim();
const revision = git("rev-parse", `${revisionInput}^{commit}`);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inputs = ["src/contracts", "src/fs/memory", "src/fs/real", "src/fs/mount", "src/fs/readonly", "src/fs/overlay", "tests/fs/mount/copy-identity.test.ts", "tsconfig.json", "package.json", "package-lock.json"];
const files = git("ls-tree", "-r", "--name-only", revision, "--", ...inputs).split("\n");
const statusBefore = git("status", "--porcelain=v1");
const originalRepro = "d4f5e53d20c7c748ee6a3fc1d867f94ae7ca42db";
const originalPath = "tests/fs/mount/copy-identity.test.ts";
const originalBytes = execFileSync("git", ["show", `${originalRepro}:${originalPath}`], { cwd: repository });
const archive = execFileSync("git", ["archive", "--format=tar", revision, ...inputs], { cwd: repository });
const temporary = mkdtempSync(join(owned, ".archive-"));
const started = new Date().toISOString();
const independentPaths = ["identity-review.test.ts", "tsconfig.json"];

function command(parameters, environment = {}) {
  const started = new Date().toISOString();
  const result = spawnSync(process.execPath, parameters, {
    cwd: temporary, env: { ...process.env, ...environment }, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
  });
  return { executable: process.execPath, argv: parameters, started, ended: new Date().toISOString(), exit: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
}

function summary(result) {
  return Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((field) => {
    const match = result.stdout.match(new RegExp(`^# ${field} (\\d+)$`, "m"));
    assert.ok(match, `missing TAP summary ${field}`);
    return [field, Number(match[1])];
  }));
}

function addEvidence(name, content) {
  const path = join(owned, "evidence", name);
  assert.equal(existsSync(path), false, `refusing to rewrite historical evidence: ${path}`);
  const patch = `*** Begin Patch\n*** Add File: ${relative(repository, path)}\n${content.trimEnd().split("\n").map((line) => `+${line}`).join("\n")}\n*** End Patch\n`;
  execFileSync("apply_patch", [], { cwd: repository, input: patch, maxBuffer: 1024 * 1024 });
}

try {
  const tarPath = join(temporary, "committed.tar");
  writeFileSync(tarPath, archive);
  execFileSync("tar", ["-xf", tarPath, "-C", temporary]);
  const manifest = files.map((path) => ({ path, blob: git("rev-parse", `${revision}:${path}`), sha256: sha256(readFileSync(join(temporary, path))) }));
  assert.equal(sha256(readFileSync(join(temporary, originalPath))), sha256(originalBytes), "historical three-red repro must remain byte-identical");
  const testDirectory = join(temporary, "tests/fs/mount-identity-review");
  mkdirSync(testDirectory, { recursive: true });
  const independent = independentPaths.map((name) => {
    copyFileSync(join(owned, name), join(testDirectory, name));
    return { path: `tests/fs/mount-identity-review/${name}`, sha256: sha256(readFileSync(join(owned, name))) };
  });
  symlinkSync(join(repository, "node_modules"), join(temporary, "node_modules"), "dir");
  const observationPath = join(temporary, "observations.json");
  const original = command(["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", originalPath]);
  const review = command(["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "tests/fs/mount-identity-review/identity-review.test.ts"], { MOUNT_IDENTITY_REVIEW_EVIDENCE: observationPath });
  const typecheck = command(["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tests/fs/mount-identity-review/tsconfig.json"]);
  const observations = JSON.parse(readFileSync(observationPath, "utf8"));
  assert.equal(observations.length, 19);
  const finalManifest = manifest.map(({ path }) => ({ path, sha256: sha256(readFileSync(join(temporary, path))) }));
  assert.deepEqual(finalManifest, manifest.map(({ path, sha256 }) => ({ path, sha256 })));
  const originalSummary = summary(original);
  const reviewSummary = summary(review);
  const historicalReportPath = "/tmp/safe-bash-fs-3731587-refresh-kMXBVH/REPORT.md";
  const evidence = {
    label, revision, originalRepro, originalReproSha256: sha256(originalBytes), started, ended: new Date().toISOString(),
    archiveSha256: sha256(archive), archiveWasUnmodified: true, manifest, independent,
    tooling: {
      node: process.version, platform: process.platform, architecture: process.arch,
      ...Object.fromEntries(["typescript", "tsx", "esbuild", "@types/node"].map((name) => {
        const content = readFileSync(join(repository, "node_modules", name, "package.json"));
        return [name, { version: JSON.parse(content).version, packageJsonSha256: sha256(content) }];
      })),
    },
    historicalReport: { path: historicalReportPath, sha256: existsSync(historicalReportPath) ? sha256(readFileSync(historicalReportPath)) : null },
    statusBefore, statusAfter: git("status", "--porcelain=v1"),
    liveScopeStatus: git("status", "--porcelain=v1", "--", ...inputs),
    liveManifestAtEnd: files.map((path) => ({ path, sha256: sha256(readFileSync(join(repository, path))) })),
    original: { ...original, summary: originalSummary },
    review: { ...review, summary: reviewSummary },
    typecheck, observations,
    mutationReview: { status: "pending-fixed-revision", performed: false, reason: "No fixed identity guard in this pinned source; removing a nonexistent guard is not a mutation kill." },
  };
  addEvidence(`${label}.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ label, revision, original: originalSummary, review: reviewSummary, typecheckExit: typecheck.exit }, null, 2));
  process.exitCode = original.exit === 0 && review.exit === 0 && typecheck.exit === 0 ? 0 : 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
