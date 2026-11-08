import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createCheckCache } from "../../../scripts/check-cache.mjs";
import { createWorkspaceBuildPlan } from "../../../scripts/build-workspaces.mjs";
import { discoverTests, loadBoundaries } from "./integration-inputs.mjs";
import { isHeldInputPath } from "./typecheck-integration-inputs.mjs";
import { planTestShards } from "./test-shards.mjs";
function defaultReporterArguments(args) {
  if (args.some(argument => argument === "--test-reporter" || argument.startsWith("--test-reporter=") || argument === "--test-reporter-destination" || argument.startsWith("--test-reporter-destination="))) return [];
  return [`--test-reporter=${new URL("./test-reporting.mjs", import.meta.url).href}`];
}

const ISOLATED_PATTERNS = /\b(?:process\s*\.\s*(?:chdir|exit)|mock\s*\.)\b/;
// These harnesses replace process-global APIs, including through imported helpers.
const ISOLATED_TEST_FILES = new Set([
  "tests/commands/expr/abort-reason-regression.test.ts",
  "tests/commands/expr/regex-lifecycle.test.ts",
  "tests/commands/network-zero-caps-review/holdout.test.ts",
  "tests/commands/regex-execution/cleanup-registration/controls.test.ts",
  "tests/commands/regex-execution/continuation/glob-transport.test.ts",
  "tests/commands/regex-execution/executor.test.ts",
  "tests/commands/regex-execution/followup/messageerror.test.ts"
]);
const SCOPED_SAFE_BASH_ENV_KEYS = [
  "SAFE_BASH_TEST_RG",
  "SAFE_BASH_TEST_BASH",
  "SAFE_BASH_TEST_BASH_SHA256",
  "SAFEJS_LOCAL_ROOT",
  "S3_HTTP_EXPORTS_REVISION",
  "FULL_GATE_ROOT"
];

function walkFiles(fileSystem, baseDir, relDir = "", boundaries, results = []) {
  const fullDir = relDir ? path.join(baseDir, relDir) : baseDir;
  if (!fileSystem.existsSync || !fileSystem.existsSync(fullDir)) return results;
  const entries = fileSystem.readdirSync(fullDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (["node_modules", "dist", ".git", ".turbo", ".cache", "out", "target", "coverage"].includes(entry.name)) continue;
    if (entry.isDirectory() && ["tests", "test", "fixtures", "benchmarks", "docs", "examples", "integration", "conformance", "stress"].includes(entry.name)) continue;
    if (entry.name.endsWith(".tsbuildinfo") || [".test.ts", ".test.mjs", ".spec.ts", ".schema-test.ts"].some(suffix => entry.name.endsWith(suffix))) continue;
    const relPath = relDir ? path.posix.join(relDir, entry.name) : entry.name;
    if (boundaries && isHeldInputPath(relPath, boundaries)) continue;
    assert.ok(!entry.isSymbolicLink(), `Symlink cache input: ${path.join(baseDir, relPath)}`);
    if (entry.isDirectory()) {
      walkFiles(fileSystem, baseDir, relPath, boundaries, results);
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }
  return results;
}

export function partitionSafeBashTestShards(
  root,
  testFiles,
  { fileSystem = fs, sharedShardSize = 25, isolatedShardSize = 15 } = {}
) {
  const shared = [];
  const isolated = [];
  for (const file of testFiles) {
    let source = "";
    try {
      source = fileSystem.readFileSync(path.join(root, file), "utf8");
    } catch {
      source = "";
    }
    if (ISOLATED_TEST_FILES.has(file) || ISOLATED_PATTERNS.test(source) || source.includes("syncBuiltinESMExports")) {
      isolated.push(file);
    } else {
      shared.push(file);
    }
  }
  const shards = [];
  for (let i = 0; i < shared.length; i += sharedShardSize) {
    shards.push({
      index: shards.length,
      isolate: false,
      files: shared.slice(i, i + sharedShardSize)
    });
  }
  for (let i = 0; i < isolated.length; i += isolatedShardSize) {
    shards.push({
      index: shards.length,
      isolate: true,
      files: isolated.slice(i, i + isolatedShardSize)
    });
  }
  return shards;
}

export function computeSafeBashBaseDigest(root, { fileSystem = fs, env = process.env } = {}) {
  const baseHash = crypto.createHash("sha256");
  baseHash.update(`safe-bash-unit-shard-v2\0${process.version}\0${process.platform}\0${process.arch}\0`);
  for (const key of SCOPED_SAFE_BASH_ENV_KEYS) {
    if (Object.hasOwn(env, key)) {
      baseHash.update(`env:${key}=${env[key] ?? ""}\0`);
    }
  }

  const repositoryRoot = path.resolve(root, "../..");
  const plan = createWorkspaceBuildPlan(repositoryRoot, fileSystem);
  const workspaces = new Map(plan.workspaces.map(workspace => [workspace.name, workspace]));
  const owner = plan.workspaces.find(workspace => path.join(repositoryRoot, workspace.path) === path.resolve(root));
  assert.ok(owner, `Missing test workspace: ${root}`);
  const boundaries = loadBoundaries(root, fileSystem);
  const privateDeclaration = owner.manifest.poeCode?.integration?.privateWorkspaces;
  const privateWorkspaces = privateDeclaration === undefined ? {} : privateDeclaration;
  assert.ok(privateWorkspaces && typeof privateWorkspaces === "object" && !Array.isArray(privateWorkspaces), "Invalid private workspace declarations");
  const selected = new Set([owner.name, ...Object.keys(privateWorkspaces)]);
  const dependencies = new Map(plan.workspaces.map(workspace => [workspace.name, []]));
  for (const edge of plan.edges) dependencies.get(edge.from).push(edge.to);
  for (const name of selected) {
    assert.ok(workspaces.has(name), `Missing private workspace: ${name}`);
    for (const dependency of dependencies.get(name)) selected.add(dependency);
  }

  const inputs = new Set([
    "package.json", "package-lock.json", "tsconfig.json", "turbo.json",
    "scripts/build-workspaces.mjs", "scripts/check-cache.mjs", "scripts/package-export-target.mjs",
    "scripts/guard-package-dist.mjs", "scripts/set-bin-executable.mjs",
    "packages/mcp-protocol-rust/scripts/cargo.mjs"
  ]);
  for (const name of selected) {
    const workspace = workspaces.get(name);
    const directory = path.join(repositoryRoot, workspace.path);
    const files = walkFiles(fileSystem, directory, "", name === owner.name ? boundaries : undefined);
    for (const file of files) inputs.add(path.posix.join(workspace.path, file));
  }
  for (const file of [...inputs].sort()) {
    const fullPath = path.join(repositoryRoot, file);
    if (!fileSystem.existsSync(fullPath)) continue;
    baseHash.update(`${file}\0`);
    baseHash.update(fileSystem.readFileSync(fullPath));
    baseHash.update("\0");
  }

  return baseHash.digest("hex");
}

export function computeSafeBashShardKeys(
  root,
  shards,
  { fileSystem = fs, env = process.env } = {}
) {
  const baseDigest = computeSafeBashBaseDigest(root, { fileSystem, env });
  return shards.map(shard => {
    const shardHash = crypto.createHash("sha256");
    shardHash.update(baseDigest);
    shardHash.update(`\0isolate:${shard.isolate}\0`);
    const fileKeys = {};
    for (const file of shard.files) {
      const fileBytes = fileSystem.readFileSync(path.join(root, file));
      shardHash.update(file);
      shardHash.update("\0");
      shardHash.update(fileBytes);
      shardHash.update("\0");
      fileKeys[file] = crypto
        .createHash("sha256")
        .update(`${baseDigest}\0file:\0${shard.isolate}\0${file}\0`)
        .update(fileBytes)
        .digest("hex");
    }
    const result = {
      ...shard,
      key: shardHash.digest("hex")
    };
    Object.defineProperty(result, "fileKeys", { value: fileKeys, enumerable: false });
    return result;
  });
}

export function runSafeBashShardedUnitTests({
  root,
  repoRoot = path.resolve(root, "../.."),
  fileSystem = fs,
  env = process.env,
  spawn = spawnSync,
  cacheStore,
  files: explicitFiles,
  execution,
  sharedShardSize = 25,
  isolatedShardSize = 15
} = {}) {
  const caching =
    env.POE_CHECK_CACHE !== "0" &&
    env.TURBO_FORCE !== "true" &&
    (env.POE_SNAPSHOT_MODE ?? "playback") === "playback" &&
    (env.POE_SNAPSHOT_MISS ?? "error") === "error";
  const store =
    cacheStore !== undefined
      ? cacheStore
      : caching
        ? createCheckCache({ rootDirectory: repoRoot, environment: env, fileSystem })
        : null;

  let files = explicitFiles;
  if (!files) {
    const boundaries = loadBoundaries(root, fileSystem);
    files = discoverTests(root, boundaries, fileSystem);
    console.log(
      `# safe-bash discovery: ${files.length} active TypeScript test files; ${boundaries.fixtureDirectories.length} authenticated fixture roots; ${boundaries.heldEvidenceDirectories.length} held evidence roots`
    );
  }

  if (execution) {
    const profilePath = path.join(root, "scripts/test-duration-weights.json");
    const profile = fileSystem.existsSync && fileSystem.existsSync(profilePath)
      ? JSON.parse(fileSystem.readFileSync(profilePath, "utf8"))
      : { version: 1, weights: {}, unknownWeightMs: 5000 };
    const planned = planTestShards(files, profile.weights, execution.shardCount, profile.unknownWeightMs);
    const selected = planned[execution.shardIndex] ?? { files: [], estimatedMs: 0 };
    const membership = crypto.createHash("sha256").update(JSON.stringify(files)).digest("hex");
    console.log(
      `# safe-bash shard: ${execution.shardIndex + 1}/${execution.shardCount}; ${selected.files.length} files; estimated ${selected.estimatedMs} ms; membership ${membership}`
    );
    files = selected.files;
  }
  const childEnv = { ...env };
  delete childEnv.SAFE_BASH_TEST_SHARD;
  delete childEnv.SAFE_BASH_TEST_CONCURRENCY;

  const rawShards = partitionSafeBashTestShards(root, files, {
    fileSystem,
    sharedShardSize,
    isolatedShardSize
  });
  const shards = store ? computeSafeBashShardKeys(root, rawShards, { fileSystem, env }) : rawShards;
  const repArgs = defaultReporterArguments([]);

  for (const shard of shards) {
    if (store?.read(shard.key)?.success === true) {
      continue;
    }
    const filesToRun = store
      ? shard.files.filter(file => store.read(shard.fileKeys[file])?.success !== true)
      : shard.files;
    if (filesToRun.length === 0) {
      store?.write(shard.key, {
        success: true,
        shardIndex: shard.index,
        files: shard.files.length
      });
      continue;
    }

    const runShard = isolate => {
      const nodeArgs = [
        "--import",
        "tsx",
        "--conditions=poe-code-source",
        "--test",
        "--test-concurrency=1",
        ...(isolate ? [] : ["--experimental-test-isolation=none"]),
        ...repArgs,
        ...filesToRun
      ];
      return spawn(process.execPath, nodeArgs, {
        cwd: root,
        stdio: "inherit",
        env: childEnv
      });
    };

    let result = runShard(shard.isolate);
    if (result.error) throw result.error;
    if ((result.status ?? 1) !== 0 && !shard.isolate) {
      result = runShard(true);
      if (result.error) throw result.error;
    }
    const status = result.status ?? 1;
    if (status !== 0) {
      return status;
    }

    if (store) {
      for (const file of filesToRun) {
        store.write(shard.fileKeys[file], { success: true, file });
      }
      store.write(shard.key, {
        success: true,
        shardIndex: shard.index,
        files: shard.files.length
      });
    }
  }

  return 0;
}

export function runCachedRunnerTests({
  root,
  repoRoot = path.resolve(root, "../.."),
  args = [],
  fileSystem = fs,
  env = process.env,
  spawn = spawnSync,
  cacheStore
} = {}) {
  const hasExplicitConcurrency = args.some(
    arg => arg === "--test-concurrency" || arg.startsWith("--test-concurrency=")
  );
  const concurrencyArgs = hasExplicitConcurrency ? [] : ["--test-concurrency=1"];
  const flags = args.filter(arg => arg.startsWith("-"));
  const testFiles = args.filter(arg => !arg.startsWith("-"));
  const repArgs = defaultReporterArguments(args);

  const caching =
    flags.length === 0 &&
    testFiles.length > 0 &&
    env.POE_CHECK_CACHE !== "0" &&
    env.TURBO_FORCE !== "true";
  const store =
    cacheStore !== undefined
      ? cacheStore
      : caching
        ? createCheckCache({ rootDirectory: repoRoot, environment: env, fileSystem })
        : null;

  if (!store) {
    const result = spawn(
      process.execPath,
      ["--test", ...concurrencyArgs, ...repArgs, ...args],
      { cwd: root, stdio: "inherit", env }
    );
    if (result.error) throw result.error;
    return result.status ?? 1;
  }

  const baseDigest = computeSafeBashBaseDigest(root, { fileSystem, env });
  for (const file of testFiles) {
    const fullPath = path.join(root, file);
    const fileBytes =
      fileSystem.existsSync && fileSystem.existsSync(fullPath)
        ? fileSystem.readFileSync(fullPath)
        : Buffer.alloc(0);
    const fileKey = crypto
      .createHash("sha256")
      .update(`safe-bash-runner-test-v1\0${baseDigest}\0${file}\0`)
      .update(fileBytes)
      .digest("hex");

    if (store.read(fileKey)?.success === true) {
      continue;
    }

    const result = spawn(
      process.execPath,
      ["--test", ...concurrencyArgs, ...repArgs, file],
      { cwd: root, stdio: "inherit", env }
    );
    if (result.error) throw result.error;
    const status = result.status ?? 1;
    if (status !== 0) return status;

    store.write(fileKey, { success: true, file });
  }

  return 0;
}
