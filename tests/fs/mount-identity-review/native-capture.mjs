import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const revision = "5a6caffcacaf07aee61ce6e219dbd015436d036e";
const owned = fileURLToPath(new URL(".", import.meta.url));
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const label = process.argv[2] ?? "native-5a6caff";
assert.match(label, /^[a-z0-9-]+$/);
const output = join(owned, "evidence", `${label}.json`);
assert.equal(existsSync(output), false, "refusing to replace historical evidence");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...parameters) => execFileSync("git", parameters, { cwd: repository, encoding: "utf8" }).trim();
assert.equal(git("rev-parse", `${revision}^{commit}`), revision);
const inputs = ["src/contracts", "src/fs/real", "tsconfig.json", "package.json", "package-lock.json"];
const paths = git("ls-tree", "-r", "--name-only", revision, "--", ...inputs).split("\n");
const historicalPaths = git("ls-files", "--", "tests/fs/mount-identity-review").split("\n").filter(Boolean);
const historicalBefore = historicalPaths.map((path) => ({ path, sha256: sha256(readFileSync(join(repository, path))) }));
const liveBefore = paths.map((path) => ({ path, sha256: sha256(readFileSync(join(repository, path))) }));
const statusBefore = git("status", "--porcelain=v1");
const archive = execFileSync("git", ["archive", "--format=tar", revision, ...inputs], { cwd: repository });
const temporary = mkdtempSync(join(owned, ".native-archive-"));
const sourcePath = "src/fs/real/index.ts";
const guard = '      if (target && origin.isFile() && origin.dev === target.dev && origin.ino === target.ino) throw new FsError("EINVAL");';
const removalPatch = `*** Begin Patch\n*** Update File: ${sourcePath}\n@@\n-${guard}\n*** End Patch\n`;
const restorePatch = `*** Begin Patch\n*** Update File: ${sourcePath}\n@@\n       if (target && options.exclusive) throw new FsError("EEXIST");\n+${guard}\n       options.signal?.throwIfAborted();\n*** End Patch\n`;
const started = new Date().toISOString();

function command(argv, environment = {}) {
  const started = new Date().toISOString();
  const result = spawnSync(process.execPath, argv, {
    cwd: temporary, env: { ...process.env, ...environment }, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
  });
  return { executable: process.execPath, argv, started, ended: new Date().toISOString(), exit: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
}

function run(cohort) {
  const observationPath = join(temporary, `${cohort}.json`);
  const result = command(["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "tests/fs/mount-identity-review/native-review.test.ts"], { NATIVE_IDENTITY_REVIEW_EVIDENCE: observationPath });
  const summary = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((field) => {
    const match = result.stdout.match(new RegExp(`^# ${field} (\\d+)$`, "m"));
    return [field, match ? Number(match[1]) : null];
  }));
  const failures = [...result.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1]);
  return { cohort, ...result, summary, failures, observations: existsSync(observationPath) ? JSON.parse(readFileSync(observationPath, "utf8")) : null };
}

function patch(content) {
  execFileSync("apply_patch", [], { cwd: temporary, input: content, maxBuffer: 1024 * 1024 });
}

try {
  const tarPath = join(temporary, "committed.tar");
  writeFileSync(tarPath, archive);
  execFileSync("tar", ["-xf", tarPath, "-C", temporary]);
  const manifest = paths.map((path) => ({ path, blob: git("rev-parse", `${revision}:${path}`), sha256: sha256(readFileSync(join(temporary, path))) }));
  const originalSource = readFileSync(join(temporary, sourcePath), "utf8");
  assert.equal(originalSource.split(guard).length, 2, "exactly one pinned guard is removed");
  const testDirectory = join(temporary, "tests/fs/mount-identity-review");
  mkdirSync(testDirectory, { recursive: true });
  const independent = ["native-review.test.ts", "native-tsconfig.json", "native-capture.mjs"].map((name) => {
    copyFileSync(join(owned, name), join(testDirectory, name));
    return { path: `tests/fs/mount-identity-review/${name}`, sha256: sha256(readFileSync(join(owned, name))) };
  });
  symlinkSync(join(repository, "node_modules"), join(temporary, "node_modules"), "dir");
  const fixed = run("fixed");
  const fixedTypecheck = command(["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tests/fs/mount-identity-review/native-tsconfig.json"]);
  assert.equal(readFileSync(join(temporary, sourcePath), "utf8"), originalSource);
  patch(removalPatch);
  const mutatedSource = readFileSync(join(temporary, sourcePath), "utf8");
  assert.equal(mutatedSource, originalSource.replace(`${guard}\n`, ""));
  const mutant = run("guard-removed");
  const mutantTypecheck = command(["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tests/fs/mount-identity-review/native-tsconfig.json"]);
  patch(restorePatch);
  assert.equal(readFileSync(join(temporary, sourcePath), "utf8"), originalSource);
  const restored = run("restored");
  const finalManifest = paths.map((path) => ({ path, sha256: sha256(readFileSync(join(temporary, path))) }));
  assert.deepEqual(finalManifest, manifest.map(({ path, sha256 }) => ({ path, sha256 })));
  const historicalAfter = historicalPaths.map((path) => ({ path, sha256: sha256(readFileSync(join(repository, path))) }));
  assert.deepEqual(historicalAfter, historicalBefore, "existing review and nine-red baseline evidence remain unchanged");
  const expectedKills = [
    "direct native same-path alias rejects before any native write",
    "direct native hardlink alias rejects before any native write",
    "direct native symlink alias rejects before any native write",
  ];
  const pass = (result) => result.exit === 0 && result.summary.tests === 12 && result.summary.pass === 12 && result.summary.fail === 0 && result.summary.cancelled === 0 && result.summary.skipped === 0 && result.summary.todo === 0;
  const killed = mutant.exit === 1 && mutant.summary.tests === 12 && mutant.summary.pass === 9 && mutant.summary.fail === 3
    && mutant.summary.cancelled === 0 && mutant.summary.skipped === 0 && mutant.summary.todo === 0
    && JSON.stringify(mutant.failures) === JSON.stringify(expectedKills);
  const accepted = pass(fixed) && killed && pass(restored) && fixedTypecheck.exit === 0 && mutantTypecheck.exit === 0;
  const evidence = {
    revision, label, started, ended: new Date().toISOString(), acceptedNativeCheckpoint: accepted,
    archiveSha256: sha256(archive), manifest, independent,
    tooling: { node: process.version, platform: process.platform, architecture: process.arch, ...Object.fromEntries(["typescript", "tsx", "esbuild", "@types/node"].map((name) => {
      const content = readFileSync(join(repository, "node_modules", name, "package.json"));
      return [name, { version: JSON.parse(content).version, packageJsonSha256: sha256(content) }];
    })) },
    statusBefore, statusAfter: git("status", "--porcelain=v1"), liveBefore,
    liveAfter: paths.map((path) => ({ path, sha256: sha256(readFileSync(join(repository, path))) })),
    historicalBefore, historicalAfter, historicalUnchanged: true, fixed, fixedTypecheck, mutant, mutantTypecheck, restored,
    mutation: { sourcePath, originalSha256: sha256(originalSource), mutatedSha256: sha256(mutatedSource), restoredSha256: sha256(readFileSync(join(temporary, sourcePath))), removalPatch, restorePatch, killed, expectedKills, onlyGuardLineChanged: true },
    limitations: ["Native RealFileSystem direct-copy subset only", "No mount/wrapper rerun or identity-seam acceptance", "Native API entry instrumentation, not kernel syscall tracing", "Metadata preflight is not atomic against hostile path mutation"],
  };
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  execFileSync("apply_patch", [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${relative(repository, output)}\n${text.trimEnd().split("\n").map((line) => `+${line}`).join("\n")}\n*** End Patch\n`, maxBuffer: 1024 * 1024 });
  console.log(JSON.stringify({ revision, acceptedNativeCheckpoint: accepted, fixed: fixed.summary, mutant: mutant.summary, restored: restored.summary, fixedTypecheck: fixedTypecheck.exit, mutantTypecheck: mutantTypecheck.exit, killed, failures: mutant.failures }, null, 2));
  process.exitCode = accepted ? 0 : 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
