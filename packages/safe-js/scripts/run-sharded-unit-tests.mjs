import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCheckCache } from "../../../scripts/check-cache.mjs";
import { writePretestShardCompletion } from "./unit-config-helper.mjs";

const ISOLATED_PATTERNS = /\bvi\s*\.\s*(?:mock|doMock|stubGlobal|stubEnv|resetModules|spyOn)\b/;
const ALWAYS_ISOLATED_SUFFIXES = new Set([
  "packages/safe-js/test/adversarial/generated-interactions.test.ts",
  "packages/safe-js/src/parse/assign-ids.test.ts",
  "packages/safe-js/src/interp/function-arity.test.ts",
  "packages/safe-js/test/integration/input-error-projection.test.ts",
  "packages/safe-js/src/modules/namespace-identity-mc-002-validation.test.ts"
]);

function walkFiles(fileSystem, rootDirectory, relativeDirectory, results = []) {
  const fullDirectory = path.join(rootDirectory, relativeDirectory);
  if (!fileSystem.existsSync(fullDirectory)) return results;
  const entries = fileSystem
    .readdirSync(fullDirectory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const relPath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fileSystem, rootDirectory, relPath, results);
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }
  return results;
}

export function discoverSafeJsTestFiles(rootDirectory, fileSystem = fs) {
  return [
    ...walkFiles(fileSystem, rootDirectory, "packages/safe-js/src"),
    ...walkFiles(fileSystem, rootDirectory, "packages/safe-js/test")
  ]
    .filter(file => file.endsWith(".test.ts"))
    .sort();
}

export function partitionSafeJsTestShards(
  rootDirectory,
  testFiles,
  { fileSystem = fs, sharedShardSize = 80, isolatedShardSize = 40 } = {}
) {
  const shared = [];
  const isolated = [];
  for (const file of testFiles) {
    if (ALWAYS_ISOLATED_SUFFIXES.has(file)) {
      isolated.push(file);
      continue;
    }
    const source = fileSystem.readFileSync(path.join(rootDirectory, file), "utf8");
    if (ISOLATED_PATTERNS.test(source)) {
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

export function computeSafeJsShardKeys(rootDirectory, shards, { fileSystem = fs } = {}) {
  const baseInputs = [
    ...walkFiles(fileSystem, rootDirectory, "packages/safe-js").filter(
      file => !file.endsWith(".test.ts") && !file.startsWith("packages/safe-js/scripts/run-sharded-")
    ),
    ...walkFiles(fileSystem, rootDirectory, "packages/safe-fs/src").filter(
      file => !file.endsWith(".test.ts")
    ),
    ...walkFiles(fileSystem, rootDirectory, "packages/frontmatter/src").filter(
      file => !file.endsWith(".test.ts")
    ),
    ...walkFiles(fileSystem, rootDirectory, "packages/agent-spawn/src").filter(
      file => !file.endsWith(".test.ts")
    ),
    ...walkFiles(fileSystem, rootDirectory, "packages/tiny-mcp-client/src").filter(
      file => !file.endsWith(".test.ts")
    ),
    "vitest.config.ts",
    "tests/setup.ts",
    "tests/test-env.ts",
    "package-lock.json"
  ].sort();

  const baseHash = crypto.createHash("sha256");
  baseHash.update(`safe-js-unit-shard-v1\0${process.version}\0`);
  for (const file of baseInputs) {
    const fullPath = path.join(rootDirectory, file);
    if (!fileSystem.existsSync(fullPath)) continue;
    baseHash.update(file);
    baseHash.update("\0");
    const rawBytes = fileSystem.readFileSync(fullPath);
    if (file === "package-lock.json") {
      try {
        const parsed = JSON.parse(rawBytes.toString("utf8"));
        if (parsed && typeof parsed === "object" && parsed.packages && typeof parsed.packages === "object") {
          const externalPackages = Object.entries(parsed.packages)
            .filter(([key, value]) => key.startsWith("node_modules/") && value && typeof value === "object" && value.link !== true)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => [
              key,
              {
                version: value.version ?? null,
                resolved: value.resolved ?? null,
                integrity: value.integrity ?? null,
                optional: Boolean(value.optional)
              }
            ]);
          baseHash.update(JSON.stringify({ lockfileVersion: parsed.lockfileVersion ?? null, externalPackages }));
        } else {
          baseHash.update(rawBytes);
        }
      } catch {
        baseHash.update(rawBytes);
      }
    } else {
      baseHash.update(rawBytes);
    }
    baseHash.update("\0");
  }
  const baseDigest = baseHash.digest("hex");

  return shards.map(shard => {
    const shardHash = crypto.createHash("sha256");
    shardHash.update(`${baseDigest}\0isolate:${shard.isolate}\0`);
    const fileKeys = {};
    for (const file of shard.files) {
      const fileBytes = fileSystem.readFileSync(path.join(rootDirectory, file));
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

function hasForwardedNpmArguments(fileSystem = fs) {
  try {
    let pid = process.ppid;
    for (let depth = 0; depth < 4 && Number.isInteger(pid) && pid > 1; depth++) {
      const cmdlinePath = `/proc/${pid}/cmdline`;
      if (!fileSystem.existsSync(cmdlinePath)) break;
      const argv = fileSystem.readFileSync(cmdlinePath, "utf8").split("\0").filter(Boolean);
      const testUnitIndex = argv.indexOf("test:unit");
      if (testUnitIndex >= 0) {
        return argv
          .slice(testUnitIndex + 1)
          .some(
            arg =>
              arg !== "--if-present=false" &&
              !arg.startsWith("--workspace=") &&
              !arg.startsWith("--include-workspace-root=")
          );
      }
      const statusPath = `/proc/${pid}/status`;
      if (!fileSystem.existsSync(statusPath)) break;
      const match = fileSystem.readFileSync(statusPath, "utf8").match(/^PPid:\s*(\d+)/m);
      pid = match ? Number(match[1]) : 0;
    }
  } catch {
    // An unavailable invocation record cannot identify a unit-test child.
  }
  return false;
}

export function runSafeJsShardedUnitTests(
  rootDirectory,
  {
    fileSystem = fs,
    environment = process.env,
    spawn = spawnSync,
    cacheStore,
    sharedShardSize = 80,
    isolatedShardSize = 40,
    markerPath
  } = {}
) {
  if (environment.SAFEJS_SHARD_RUNNER === "0" || hasForwardedNpmArguments(fileSystem)) {
    return { skipped: true, shards: 0, cacheHits: 0, cacheMisses: 0 };
  }
  const caching =
    environment.POE_CHECK_CACHE !== "0" &&
    environment.TURBO_FORCE !== "true" &&
    (environment.POE_SNAPSHOT_MODE ?? "playback") === "playback" &&
    (environment.POE_SNAPSHOT_MISS ?? "error") === "error";
  const store =
    cacheStore !== undefined
      ? cacheStore
      : caching
        ? createCheckCache({ rootDirectory, environment, fileSystem })
        : null;

  const files = discoverSafeJsTestFiles(rootDirectory, fileSystem);
  const rawShards = partitionSafeJsTestShards(rootDirectory, files, {
    fileSystem,
    sharedShardSize,
    isolatedShardSize
  });
  const shards = computeSafeJsShardKeys(rootDirectory, rawShards, { fileSystem });

  let cacheHits = 0;
  let cacheMisses = 0;
  const vitestEntrypoint = path.join(rootDirectory, "node_modules/vitest/vitest.mjs");

  const useFileLevelCache = store && cacheStore === undefined;
  for (const shard of shards) {
    if (store?.read(shard.key)?.success === true) {
      cacheHits++;
      continue;
    }
    const filesToRun = useFileLevelCache
      ? shard.files.filter(file => store.read(shard.fileKeys[file])?.success !== true)
      : shard.files;
    if (filesToRun.length === 0) {
      store?.write(shard.key, {
        success: true,
        shardIndex: shard.index,
        files: shard.files.length
      });
      cacheHits++;
      continue;
    }
    cacheMisses++;
    const runVitest = isolate => {
      const args = [
        vitestEntrypoint,
        "run",
        "--config",
        "vitest.config.ts",
        "--testTimeout=30000",
        "--hookTimeout=30000",
        "--teardownTimeout=30000",
        "--maxWorkers=1",
        ...(isolate ? [] : ["--no-isolate"]),
        ...filesToRun
      ];
      return spawn(process.execPath, args, {
        cwd: rootDirectory,
        env: { ...environment, VITEST_MAX_WORKERS: "1" },
        stdio: "inherit"
      });
    };
    let result = runVitest(shard.isolate);
    if (result.status !== 0 && !shard.isolate) {
      result = runVitest(true);
    }
    if (result.status !== 0 || result.signal) {
      throw new Error(
        `@poe-code/safe-js shard ${shard.index + 1}/${shards.length} failed (${result.signal ?? result.status})`
      );
    }
    if (useFileLevelCache) {
      for (const file of filesToRun) {
        store.write(shard.fileKeys[file], { success: true, file });
      }
    }
    store?.write(shard.key, {
      success: true,
      shardIndex: shard.index,
      files: shard.files.length
    });
  }

  writePretestShardCompletion(fileSystem, markerPath);
  return {
    skipped: false,
    shards: shards.length,
    files: files.length,
    cacheHits,
    cacheMisses
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const summary = runSafeJsShardedUnitTests(rootDirectory);
  console.log(JSON.stringify({ safeJsShards: summary }));
}
