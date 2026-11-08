import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repo = resolve(owned, "../../../..");
const scratch = await mkdtemp(join(owned, ".scratch-"));
const raw = join(owned, "raw");
await mkdir(raw, { recursive: true });

const commits = {
  baseline: "877144ea3a5223bbdf3e7ebfd50a8f8caaa474f3",
  originalAuthorEvidence: "f2d6f710d9e0b9481957ff302bba90a0f11c9bad",
  firstIndependent: "19cc7e8c3567b521e04159010efe32da5673b5b4",
  holdoutFreeze: "510c621e1dfa8f7ffba1d796f5f7e55d967368e2",
  overlayFix: "1c793b934dcd06aa42e0df24a7228b395178cf3d",
  holdoutRefinement: "8c28d7c848311372cbef5ec3e4facff546baf0a8",
  cleanupFixture: "0d6b9fcf57866fa38e6c065365b11e0fb8e5707b",
  duFix: "32c5b60c3323101ebd3d4a3339931caa93867ae5",
  baselineEvidence: "82e97559330cff52f63f22c7d5fd80185fe65f44",
  parent: "31f5678e62e3f3d43b4825d839ec970e7768da7d",
  candidate: "9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d",
  handoff: "87833f33cb7fa6d2a6c098201dd53fe5404a7fcb",
  evidence: "c5fe1a68341b3a2ebbefd9fee6793a1e6c5df10b",
};

function command(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...options });
  return { program, args, cwd: options.cwd, status: result.status, signal: result.signal,
    stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error?.message };
}

function required(result, label) {
  if (result.status !== 0) throw new Error(`${label} failed (${result.status}): ${result.stderr}`);
  return result.stdout.trim();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fileSha256(path) {
  return sha256(await readFile(path));
}

async function trackedManifest(commit, root) {
  const result = command("git", ["ls-tree", "-rz", commit], { cwd: repo, encoding: null });
  if (result.status !== 0) throw new Error(`ls-tree ${commit} failed (${result.status}): ${String(result.stderr)}`);
  const listed = result.stdout.toString("utf8").split("\0").filter(Boolean).map(record => {
    const match = record.match(/^(\d+) (\S+) ([0-9a-f]{40})\t([\s\S]+)$/u);
    if (!match) throw new Error(`unparseable ls-tree record: ${JSON.stringify(record)}`);
    return { mode: match[1], type: match[2], object: match[3], path: match[4] };
  });
  const manifest = {};
  for (const item of listed) {
    const absolute = join(root, item.path);
    const stat = await lstat(absolute);
    const bytes = stat.isSymbolicLink() ? Buffer.from(await readlink(absolute)) : await readFile(absolute);
    manifest[item.path] = { mode: item.mode, type: item.type, object: item.object, extractedSha256: sha256(bytes) };
  }
  return manifest;
}

async function extraEntries(root, tracked) {
  const known = new Set(tracked);
  const extras = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute);
      if (path === "node_modules") continue;
      if (entry.isDirectory()) await visit(absolute);
      else if (!known.has(path)) extras.push(path);
    }
  }
  await visit(root);
  return extras.sort();
}

async function archive(label, commit) {
  const tar = join(scratch, `${label}.tar`);
  const root = join(scratch, label);
  await mkdir(root);
  required(command("git", ["archive", "--format=tar", `--output=${tar}`, commit], { cwd: repo }), `archive ${label}`);
  const archiveSha256 = await fileSha256(tar);
  required(command("tar", ["-xf", tar, "-C", root]), `extract ${label}`);
  await symlink(join(repo, "node_modules"), join(root, "node_modules"));
  const before = await trackedManifest(commit, root);
  return { label, commit, root, archiveSha256, before };
}

const behaviorPatterns = {
  baseline: "^all argument and environment validation happens before any filesystem call$",
  parent: "^all argument and environment validation happens before any filesystem call$",
  candidate: "^invalid arguments fail before filesystem calls; selected invalid environment falls back$",
};
const nativePattern = "^GNU 9\\.7 captured profile: (-b |env:\\{\\\"DU_BLOCK_SIZE\\\":(\\\"bad\\\"|\\\"\\\",\\\"BLOCK_SIZE\\\":\\\"2K\\\")\\})$";

async function selectedTests(snapshot) {
  const runs = [];
  for (const [kind, file, pattern] of [
    ["behavior", "tests/commands/du/behavior.test.ts", behaviorPatterns[snapshot.label]],
    ["native", "tests/commands/du/native.test.ts", nativePattern],
  ]) {
    const result = command(process.execPath,
      ["--import", "tsx", "--test", `--test-name-pattern=${pattern}`, file], { cwd: snapshot.root });
    await writeFile(join(raw, `${snapshot.label}-${kind}.stdout.txt`), result.stdout);
    await writeFile(join(raw, `${snapshot.label}-${kind}.stderr.txt`), result.stderr);
    runs.push({ kind, file, pattern, status: result.status, signal: result.signal,
      stdoutSha256: sha256(result.stdout), stderrSha256: sha256(result.stderr) });
  }
  return runs;
}

function gitObject(commit) {
  const fields = required(command("git", ["show", "-s", "--format=%H%n%P%n%T%n%aI%n%s", commit], { cwd: repo }), `show ${commit}`).split("\n");
  return { commit: fields[0], parents: fields[1].split(" ").filter(Boolean), tree: fields[2], authoredAt: fields[3], subject: fields.slice(4).join("\n") };
}

function blob(commit, path) {
  const value = required(command("git", ["ls-tree", commit, path], { cwd: repo }), `blob ${commit}:${path}`);
  const match = value.match(/^\d+ blob ([0-9a-f]{40})\t/u);
  if (!match) throw new Error(`unexpected ls-tree output for ${path}: ${value}`);
  const bytes = command("git", ["show", `${commit}:${path}`], { cwd: repo, encoding: null });
  if (bytes.status !== 0) throw new Error(`git show failed for ${commit}:${path}`);
  return { commit, path, gitBlob: match[1], sha256: sha256(bytes.stdout) };
}

try {
  const snapshots = {};
  for (const [label, commit] of Object.entries({ baseline: commits.baseline, parent: commits.parent, candidate: commits.candidate })) {
    snapshots[label] = await archive(label, commit);
    snapshots[label].runs = await selectedTests(snapshots[label]);
  }

  const probeRun = command(process.execPath, ["--import", "tsx", join(owned, "probe.mjs"), snapshots.candidate.root], { cwd: repo });
  await writeFile(join(raw, "candidate-discriminating-probe.stdout.json"), probeRun.stdout);
  await writeFile(join(raw, "candidate-discriminating-probe.stderr.txt"), probeRun.stderr);

  const oracle = join(repo, "tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du");
  const oracleBeforeSha256 = await fileSha256(oracle);
  const nativeRoot = join(scratch, "native");
  await mkdir(nativeRoot);
  await writeFile(join(nativeRoot, "size-1025"), new Uint8Array(1025));
  const nativeCases = [
    { id: "O062", args: ["-b", ""], env: {} },
    { id: "O086", args: ["--apparent-size", "size-1025"], env: { DU_BLOCK_SIZE: "bad" } },
    { id: "O087", args: ["--apparent-size", "size-1025"], env: { DU_BLOCK_SIZE: "", BLOCK_SIZE: "2K" } },
    { id: "scope-BLOCK_SIZE-invalid", args: ["--apparent-size", "size-1025"], env: { BLOCK_SIZE: "bad", BLOCKSIZE: "1" } },
    { id: "scope-BLOCKSIZE-invalid", args: ["--apparent-size", "size-1025"], env: { BLOCKSIZE: "bad" } },
  ].map(item => {
    const result = command(oracle, item.args, { cwd: nativeRoot, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", ...item.env } });
    return { ...item, nativeEnvironment: { PATH: "/usr/bin:/bin", LC_ALL: "C", ...item.env },
      status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error };
  });
  const version = command(oracle, ["--version"], { cwd: nativeRoot, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
  const oracleAfterSha256 = await fileSha256(oracle);

  const trackedChecks = {};
  for (const snapshot of Object.values(snapshots)) {
    const after = await trackedManifest(snapshot.commit, snapshot.root);
    trackedChecks[snapshot.label] = {
      trackedCount: Object.keys(snapshot.before).length,
      beforeSha256: sha256(JSON.stringify(snapshot.before)),
      afterSha256: sha256(JSON.stringify(after)),
      unchanged: JSON.stringify(snapshot.before) === JSON.stringify(after),
      newEntriesAfterRun: await extraEntries(snapshot.root, Object.keys(snapshot.before)),
    };
  }

  const migrationDiff = command("git", ["diff", commits.parent, commits.candidate, "--",
    "tests/commands/du/behavior.test.ts", "tests/commands/du/native.test.ts"], { cwd: repo });
  const sealedPatch = command("git", ["show", `${commits.evidence}:tests/commands/du/canonical-migration-v1/migration.patch`], { cwd: repo });

  const output = {
    generatedAt: new Date().toISOString(), node: process.version, platform: process.platform,
    commits: Object.fromEntries(Object.entries(commits).map(([name, commit]) => [name, gitObject(commit)])),
    tooling: {
      packageLock: blob(commits.candidate, "package-lock.json"),
      installedTsxPackageSha256: await fileSha256(join(repo, "node_modules/tsx/package.json")),
      installedTsxVersion: JSON.parse(await readFile(join(repo, "node_modules/tsx/package.json"), "utf8")).version,
      nodeModulesUse: "read-only symlink used as execution tooling; product/test inputs came from each Git archive",
    },
    archives: Object.fromEntries(Object.values(snapshots).map(snapshot => [snapshot.label, {
      commit: snapshot.commit, archiveSha256: snapshot.archiveSha256, runs: snapshot.runs,
    }])),
    archiveIntegrity: trackedChecks,
    objects: {
      originalBehavior: blob(commits.parent, "tests/commands/du/behavior.test.ts"),
      originalNative: blob(commits.parent, "tests/commands/du/native.test.ts"),
      sealedOriginalBehavior: blob(commits.evidence, "tests/commands/du/canonical-migration-v1/originals/behavior.test.ts.txt"),
      sealedOriginalNative: blob(commits.evidence, "tests/commands/du/canonical-migration-v1/originals/native.test.ts.txt"),
      sealedOldRawFailure: blob(commits.evidence, "tests/commands/du/canonical-migration-v1/originals/legacy-handoff.stdout.txt"),
      sealedDelta: blob(commits.evidence, "tests/commands/du/canonical-migration-v1/DELTA.md"),
      sealedMigrationPatch: blob(commits.evidence, "tests/commands/du/canonical-migration-v1/migration.patch"),
      candidateBehavior: blob(commits.candidate, "tests/commands/du/behavior.test.ts"),
      candidateNative: blob(commits.candidate, "tests/commands/du/native.test.ts"),
      nativeProfile: blob(commits.candidate, "tests/commands/du/native-profile.json"),
      functionalNativeObservations: blob(commits.candidate, "tests/commands/du/functional-v1/native-observations.json"),
      classificationRaw: blob(commits.candidate, "tests/commands/du/functional-v1/evidence/classification-v1-20260827-9a7c34d4/raw-cases.json"),
      oldOverlayStrictRed: blob(commits.cleanupFixture, "tests/fs/overlay/metadata-purity-evidence/captures/exact-tests-old-overlay-ZW4MmR/strict.stdout.log"),
      overlayFixtureMigration: blob(commits.cleanupFixture, "tests/fs/overlay/metadata-purity-evidence/migration.patch"),
      duArgumentsAtFix: blob(commits.duFix, "src/commands/du/arguments.ts"),
      duArgumentsAtCandidate: blob(commits.candidate, "src/commands/du/arguments.ts"),
      duWalkerAtFix: blob(commits.duFix, "src/commands/du/du.ts"),
      duWalkerAtCandidate: blob(commits.candidate, "src/commands/du/du.ts"),
      overlayAtFix: blob(commits.overlayFix, "src/fs/overlay/index.ts"),
      overlayAtCandidate: blob(commits.candidate, "src/fs/overlay/index.ts"),
      rootIndexAtBaseline: blob(commits.baseline, "src/index.ts"),
      rootIndexAtCandidate: blob(commits.candidate, "src/index.ts"),
      packageAtBaseline: blob(commits.baseline, "package.json"),
      packageAtCandidate: blob(commits.candidate, "package.json"),
    },
    migrationPatch: { gitDiffSha256: sha256(migrationDiff.stdout), sealedPatchSha256: sha256(sealedPatch.stdout),
      exactMatch: migrationDiff.stdout === sealedPatch.stdout },
    discriminatingProbe: { status: probeRun.status, stdoutSha256: sha256(probeRun.stdout), stderrSha256: sha256(probeRun.stderr) },
    native: {
      oracle, oracleBeforeSha256, oracleAfterSha256, unchanged: oracleBeforeSha256 === oracleAfterSha256,
      version: { status: version.status, stdout: version.stdout, stderr: version.stderr },
      sourceSha256: await fileSha256(join(repo, "tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du.c")),
      humanParserSourceSha256: await fileSha256(join(repo, "tests/commands/metadata-stress/.oracle/coreutils-9.7/lib/human.c")),
      cases: nativeCases,
    },
    scratchCleanup: "performed in finally after results write; paths are not retained",
  };
  await writeFile(join(owned, "RESULTS.json"), JSON.stringify(output, null, 2) + "\n");
} finally {
  await rm(scratch, { recursive: true, force: true });
}
