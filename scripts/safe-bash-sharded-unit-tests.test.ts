import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import {
  computeSafeBashShardKeys,
  partitionSafeBashTestShards,
  runCachedRunnerTests,
  runSafeBashShardedUnitTests
} from "../packages/safe-bash/scripts/run-sharded-unit-tests.mjs";

function createSafeBashFixture() {
  const volume = Volume.fromJSON({
    "/repo/packages/safe-bash/package.json": JSON.stringify({
      name: "@poe-platform/safe-bash",
      version: "0.0.1"
    }),
    "/repo/packages/safe-bash/tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true }
    }),
    "/repo/packages/safe-bash/integration-boundaries.json": JSON.stringify({
      version: 1,
      fixtureDirectories: [],
      heldEvidenceDirectories: [],
      records: []
    }),
    "/repo/packages/safe-bash/integration-type-inputs.json": JSON.stringify({
      version: 1,
      cohorts: []
    }),
    "/repo/packages/safe-bash/src/index.ts": "export const ok = true;\n",
    "/repo/packages/safe-bash/src/a.test.ts": "import test from \"node:test\";\ntest(\"a\", () => {});\n",
    "/repo/packages/safe-bash/src/b.test.ts": "import test from \"node:test\";\ntest(\"b\", () => {});\n",
    "/repo/packages/safe-bash/src/c.test.ts": "import test from \"node:test\";\nprocess.chdir(\"/\");\n",
    "/repo/packages/safe-bash/scripts/first.test.mjs": "import test from \"node:test\";\ntest(\"r1\", () => {});\n",
    "/repo/packages/safe-bash/scripts/second.test.mjs": "import test from \"node:test\";\ntest(\"r2\", () => {});\n"
  });
  return createFsFromVolume(volume);
}

describe("safe-bash sharded unit runner", () => {
  it("partitions shared and isolated test files into bounded serial shards", () => {
    const fileSystem = createSafeBashFixture();
    const shards = partitionSafeBashTestShards(
      "/repo/packages/safe-bash",
      ["src/a.test.ts", "src/b.test.ts", "src/c.test.ts"],
      { fileSystem, sharedShardSize: 1, isolatedShardSize: 2 }
    );
    expect(shards).toEqual([
      { index: 0, isolate: false, files: ["src/a.test.ts"] },
      { index: 1, isolate: false, files: ["src/b.test.ts"] },
      { index: 2, isolate: true, files: ["src/c.test.ts"] }
    ]);
  });

  it("isolates the imported offline guard before its first execution without isolating siblings", () => {
    const fileSystem = createSafeBashFixture();
    const root = "/repo/packages/safe-bash";
    const holdout = "tests/commands/network-zero-caps-review/holdout.test.ts";
    const sibling = "tests/commands/network-zero-caps-review/sibling.test.ts";
    fileSystem.mkdirSync(`${root}/tests/commands/network-zero-caps-review`, { recursive: true });
    fileSystem.writeFileSync(`${root}/${holdout}`, 'import { assertOffline } from "./offline.mjs";\n');
    fileSystem.writeFileSync(`${root}/${sibling}`, 'import test from "node:test";\ntest("sibling", () => {});\n');
    expect(partitionSafeBashTestShards(root, [holdout, sibling], { fileSystem })).toEqual([
      { index: 0, isolate: false, files: [sibling] },
      { index: 1, isolate: true, files: [holdout] }
    ]);
    const calls: string[][] = [];
    const status = runSafeBashShardedUnitTests({
      root,
      repoRoot: "/repo",
      fileSystem,
      env: { PATH: "/usr/bin", POE_CHECK_CACHE: "0" },
      files: [holdout],
      spawn: (_cmd: string, args: string[]) => {
        calls.push(args);
        return { status: 0 };
      }
    });
    expect(status).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(holdout);
    expect(calls[0]).not.toContain("--experimental-test-isolation=none");
  });

  it.each([
    "tests/commands/regex-execution/cleanup-registration/controls.test.ts",
    "tests/commands/regex-execution/continuation/glob-transport.test.ts",
    "tests/commands/regex-execution/executor.test.ts",
    "tests/commands/regex-execution/followup/messageerror.test.ts",
    "tests/commands/expr/abort-reason-regression.test.ts",
    "tests/commands/expr/regex-lifecycle.test.ts"
  ])("isolates the Worker-patching harness %s on its first execution", file => {
    const fileSystem = createSafeBashFixture();
    const root = "/repo/packages/safe-bash";
    const entry = file;
    fileSystem.mkdirSync(`${root}/${entry.slice(0, entry.lastIndexOf("/"))}`, { recursive: true });
    fileSystem.writeFileSync(`${root}/${entry}`, 'workersModule.Worker = ControlledWorker;\nsyncBuiltinESMExports();\n');
    expect(partitionSafeBashTestShards(root, [entry, "src/a.test.ts"], { fileSystem })).toEqual([
      { index: 0, isolate: false, files: ["src/a.test.ts"] },
      { index: 1, isolate: true, files: [entry] }
    ]);
    const calls: string[][] = [];
    expect(runSafeBashShardedUnitTests({
      root,
      repoRoot: "/repo",
      fileSystem,
      env: { PATH: "/usr/bin", POE_CHECK_CACHE: "0" },
      files: [entry],
      spawn: (_cmd: string, args: string[]) => {
        calls.push(args);
        return { status: 0 };
      }
    })).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(entry);
    expect(calls[0]).not.toContain("--experimental-test-isolation=none");
  });

  it("computes per-shard and per-file keys and invalidates only modified test files", () => {
    const fileSystem = createSafeBashFixture();
    const raw = partitionSafeBashTestShards(
      "/repo/packages/safe-bash",
      ["src/a.test.ts", "src/b.test.ts"],
      { fileSystem, sharedShardSize: 2 }
    );
    const first = computeSafeBashShardKeys("/repo/packages/safe-bash", raw, { fileSystem });
    fileSystem.writeFileSync(
      "/repo/packages/safe-bash/src/b.test.ts",
      "import test from \"node:test\";\ntest(\"b changed\", () => {});\n"
    );
    const second = computeSafeBashShardKeys("/repo/packages/safe-bash", raw, { fileSystem });
    expect(second[0].key).not.toBe(first[0].key);
    expect(second[0].fileKeys["src/a.test.ts"]).toBe(first[0].fileKeys["src/a.test.ts"]);
    expect(second[0].fileKeys["src/b.test.ts"]).not.toBe(first[0].fileKeys["src/b.test.ts"]);
  });

  it("runs uncached files in single-process serial mode and only re-runs changed files on partial cache hit", () => {
    const fileSystem = createSafeBashFixture();
    const calls: string[][] = [];
    const status1 = runSafeBashShardedUnitTests({
      root: "/repo/packages/safe-bash",
      repoRoot: "/repo",
      fileSystem,
      env: { PATH: "/usr/bin" },
      files: ["src/a.test.ts", "src/b.test.ts"],
      sharedShardSize: 2,
      spawn: (_cmd: string, args: string[]) => {
        calls.push(args);
        return { status: 0 };
      }
    });
    expect(status1).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("--test-concurrency=1");
    expect(calls[0]).toContain("--experimental-test-isolation=none");
    expect(calls[0].filter(a => a.endsWith(".test.ts"))).toEqual(["src/a.test.ts", "src/b.test.ts"]);

    // Second run with no changes hits cache completely
    const status2 = runSafeBashShardedUnitTests({
      root: "/repo/packages/safe-bash",
      repoRoot: "/repo",
      fileSystem,
      env: { PATH: "/usr/bin" },
      files: ["src/a.test.ts", "src/b.test.ts"],
      sharedShardSize: 2,
      spawn: (_cmd: string, args: string[]) => {
        calls.push(args);
        return { status: 0 };
      }
    });
    expect(status2).toBe(0);
    expect(calls).toHaveLength(1);

    // Modify only src/b.test.ts -> only src/b.test.ts runs
    fileSystem.writeFileSync(
      "/repo/packages/safe-bash/src/b.test.ts",
      "import test from \"node:test\";\ntest(\"b2\", () => {});\n"
    );
    const status3 = runSafeBashShardedUnitTests({
      root: "/repo/packages/safe-bash",
      repoRoot: "/repo",
      fileSystem,
      env: { PATH: "/usr/bin" },
      files: ["src/a.test.ts", "src/b.test.ts"],
      sharedShardSize: 2,
      spawn: (_cmd: string, args: string[]) => {
        calls.push(args);
        return { status: 0 };
      }
    });
    expect(status3).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[1].filter(a => a.endsWith(".test.ts"))).toEqual(["src/b.test.ts"]);
  });

  it("retries a failed shared shard with process isolation enabled", () => {
    const fileSystem = createSafeBashFixture();
    const calls: string[][] = [];
    const status = runSafeBashShardedUnitTests({
      root: "/repo/packages/safe-bash",
      repoRoot: "/repo",
      fileSystem,
      env: { PATH: "/usr/bin" },
      files: ["src/a.test.ts", "src/b.test.ts"],
      sharedShardSize: 2,
      spawn: (_cmd: string, args: string[]) => {
        calls.push(args);
        return { status: args.includes("--experimental-test-isolation=none") ? 1 : 0 };
      }
    });
    expect(status).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("--experimental-test-isolation=none");
    expect(calls[1]).not.toContain("--experimental-test-isolation=none");
    expect(calls[1]).toContain("--test-concurrency=1");
  });

  it("runs runner .test.mjs files serially with --test-concurrency=1 and caches each passing file", () => {
    const fileSystem = createSafeBashFixture();
    const calls: string[][] = [];
    const status1 = runCachedRunnerTests({
      root: "/repo/packages/safe-bash",
      repoRoot: "/repo",
      args: ["scripts/first.test.mjs", "scripts/second.test.mjs"],
      fileSystem,
      env: { PATH: "/usr/bin" },
      spawn: (_cmd: string, args: string[]) => {
        calls.push(args);
        return { status: 0 };
      }
    });
    expect(status1).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("--test-concurrency=1");
    expect(calls[0].at(-1)).toBe("scripts/first.test.mjs");
    expect(calls[1].at(-1)).toBe("scripts/second.test.mjs");

    // Modify only second.test.mjs -> only second.test.mjs re-runs
    fileSystem.writeFileSync(
      "/repo/packages/safe-bash/scripts/second.test.mjs",
      "import test from \"node:test\";\ntest(\"r2 updated\", () => {});\n"
    );
    const status2 = runCachedRunnerTests({
      root: "/repo/packages/safe-bash",
      repoRoot: "/repo",
      args: ["scripts/first.test.mjs", "scripts/second.test.mjs"],
      fileSystem,
      env: { PATH: "/usr/bin" },
      spawn: (_cmd: string, args: string[]) => {
        calls.push(args);
        return { status: 0 };
      }
    });
    expect(status2).toBe(0);
    expect(calls).toHaveLength(3);
    expect(calls[2].at(-1)).toBe("scripts/second.test.mjs");
  });
});
