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
    "/repo/package.json": JSON.stringify({ workspaces: ["packages/*"] }),
    "/repo/turbo.json": JSON.stringify({ tasks: { build: { dependsOn: ["^build"] } } }),
    "/repo/packages/safe-bash/package.json": JSON.stringify({
      name: "@poe-platform/safe-bash",
      version: "0.0.1"
    }),
    "/repo/packages/safe-bash/tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true }
    }),
    "/repo/packages/safe-bash/integration-boundaries.json": JSON.stringify({
      version: 1,
      heldSourceFiles: [],
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
  it.each([
    ["command", "src/index.ts"],
    ["pdf-engine", "src/index.ts"],
    ["shared-storage", "src/index.ts"],
    ["shared-storage", "package.json"],
    ["pdf-engine", "tsconfig.json"],
    ["pdf-engine", "scripts/build.mjs"],
    ["shared-storage", "vendor/data.json"],
    ["shared-storage", "native/codec.c"],
    ["shared-storage", "tools/generate.mjs"],
    ["shared-storage", "Cargo.toml"]
  ])("invalidates shard and file keys for declared workspace input %s/%s", (directory, filename) => {
    const fileSystem = createSafeBashFixture();
    const root = "/repo/packages/safe-bash";
    fileSystem.writeFileSync(`${root}/package.json`, JSON.stringify({
      name: "@poe-platform/safe-bash", version: "0.0.1",
      devDependencies: { "safe-bash-command-widget": "*", "@poe-code/pdf-ast": "*" },
      poeCode: { integration: { privateWorkspaces: {
        "safe-bash-command-widget": { version: "0.0.1" },
        "@poe-code/pdf-ast": { version: "0.0.1" }
      } } }
    }));
    for (const [dir, name, dependencies] of [
      ["command", "safe-bash-command-widget", { "@poe-code/storage": "*" }],
      ["pdf-engine", "@poe-code/pdf-ast", { "@poe-code/storage": "*" }],
      ["shared-storage", "@poe-code/storage", {}]
    ] as const) {
      const workspace = `/repo/packages/${dir}`;
      fileSystem.mkdirSync(`${workspace}/src`, { recursive: true });
      for (const subdirectory of ["scripts", "native", "vendor", "tools"]) fileSystem.mkdirSync(`${workspace}/${subdirectory}`, { recursive: true });
      fileSystem.writeFileSync(`${workspace}/package.json`, JSON.stringify({ name, version: "0.0.1", dependencies }));
      fileSystem.writeFileSync(`${workspace}/src/index.ts`, "export const value = 1;\n");
      fileSystem.writeFileSync(`${workspace}/vendor/data.json`, "{}");
      fileSystem.writeFileSync(`${workspace}/native/codec.c`, "int value = 1;");
      fileSystem.writeFileSync(`${workspace}/tools/generate.mjs`, "export const value = 1;");
      fileSystem.writeFileSync(`${workspace}/Cargo.toml`, "[package]\nname = 'engine'");
      fileSystem.writeFileSync(`${workspace}/tsconfig.json`, JSON.stringify({ compilerOptions: { strict: true } }));
      fileSystem.writeFileSync(`${workspace}/scripts/build.mjs`, "export const target = 'es2022';\n");
    }
    const shards = partitionSafeBashTestShards(root, ["src/a.test.ts", "src/b.test.ts"], { fileSystem });
    const before = computeSafeBashShardKeys(root, shards, { fileSystem, env: {} });
    const target = `/repo/packages/${directory}/${filename}`;
    const text = fileSystem.readFileSync(target, "utf8") as string;
    fileSystem.writeFileSync(target, filename.endsWith(".json")
      ? JSON.stringify({ ...JSON.parse(text), changed: true }) : text + "export const changed = true;\n");
    const after = computeSafeBashShardKeys(root, shards, { fileSystem, env: {} });
    expect(after[0].key).not.toBe(before[0].key);
    for (const file of shards[0].files) expect(after[0].fileKeys[file]).not.toBe(before[0].fileKeys[file]);
  });

  it.each(["SAFE_BASH_TEST_BASH", "SAFE_BASH_TEST_BASH_SHA256"])("includes native oracle identity %s in both cache levels", key => {
    const fileSystem = createSafeBashFixture();
    const root = "/repo/packages/safe-bash";
    const shards = partitionSafeBashTestShards(root, ["src/a.test.ts"], { fileSystem });
    const before = computeSafeBashShardKeys(root, shards, { fileSystem, env: {} });
    const configured = computeSafeBashShardKeys(root, shards, { fileSystem, env: { [key]: "first" } });
    const changed = computeSafeBashShardKeys(root, shards, { fileSystem, env: { [key]: "second" } });
    expect(configured[0].key).not.toBe(before[0].key);
    expect(changed[0].key).not.toBe(configured[0].key);
    expect(configured[0].fileKeys["src/a.test.ts"]).not.toBe(before[0].fileKeys["src/a.test.ts"]);
    expect(changed[0].fileKeys["src/a.test.ts"]).not.toBe(configured[0].fileKeys["src/a.test.ts"]);
  });

  it("does not enter or read held source directories while hashing active inputs", () => {
    const fileSystem = createSafeBashFixture();
    const root = "/repo/packages/safe-bash";
    fileSystem.writeFileSync(`${root}/integration-boundaries.json`, JSON.stringify({
      version: 1, heldSourceFiles: [], heldEvidenceDirectories: ["src/commands/held"], fixtureDirectories: []
    }));
    fileSystem.mkdirSync(`${root}/src/commands/held`, { recursive: true });
    fileSystem.writeFileSync(`${root}/src/commands/held/evidence.ts`, "held payload");
    const guarded = new Proxy(fileSystem, { get(target, property) {
      if (property !== "readdirSync" && property !== "readFileSync") return Reflect.get(target, property);
      const original = Reflect.get(target, property) as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => {
        if (String(args[0]).startsWith(`${root}/src/commands/held`)) throw new Error("held payload accessed");
        return original.apply(target, args);
      };
    } });
    const shards = [{ index: 0, isolate: false, files: ["src/a.test.ts"] }];
    expect(() => computeSafeBashShardKeys(root, shards, { fileSystem: guarded, env: {} })).not.toThrow();
  });

  it.each([
    ["null", null, "Invalid private workspace declarations"],
    ["array", ["missing"], "Invalid private workspace declarations"],
    ["missing package", { missing: {} }, "Missing private workspace: missing"]
  ])("rejects incomplete cache inputs for %s", (_label, privateWorkspaces, message) => {
    const fileSystem = createSafeBashFixture();
    const root = "/repo/packages/safe-bash";
    fileSystem.writeFileSync(`${root}/package.json`, JSON.stringify({
      name: "@poe-platform/safe-bash", version: "0.0.1", poeCode: { integration: { privateWorkspaces } }
    }));
    expect(() => computeSafeBashShardKeys(root, [], { fileSystem, env: {} })).toThrow(message);
  });

  it.each(["/repo/package-lock.json", "/repo/packages/safe-bash/scripts/run-sharded-unit-tests.mjs"])("invalidates both cache levels when tooling input %s changes", input => {
    const fileSystem = createSafeBashFixture();
    const root = "/repo/packages/safe-bash";
    fileSystem.writeFileSync(input, "before");
    const shards = [{ index: 0, isolate: false, files: ["src/a.test.ts"] }];
    const before = computeSafeBashShardKeys(root, shards, { fileSystem, env: {} });
    fileSystem.writeFileSync(input, "after");
    const after = computeSafeBashShardKeys(root, shards, { fileSystem, env: {} });
    expect(after[0].key).not.toBe(before[0].key);
    expect(after[0].fileKeys["src/a.test.ts"]).not.toBe(before[0].fileKeys["src/a.test.ts"]);
  });

  it("runs uncached tests without inspecting cache-only workspace inputs", () => {
    const fileSystem = createSafeBashFixture();
    const root = "/repo/packages/safe-bash";
    fileSystem.writeFileSync(`${root}/package.json`, "not valid JSON");
    const calls: string[][] = [];
    expect(runSafeBashShardedUnitTests({ root, fileSystem, env: { POE_CHECK_CACHE: "0" }, files: ["src/a.test.ts"],
      spawn: (_command: string, args: string[]) => { calls.push(args); return { status: 0 }; }
    })).toBe(0);
    expect(calls).toHaveLength(1);
  });

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

  it("isolates tests that replace Node builtin exports", () => {
    const fileSystem = createSafeBashFixture();
    fileSystem.writeFileSync("/repo/packages/safe-bash/src/a.test.ts",
      'import { syncBuiltinESMExports } from "node:module";\nsyncBuiltinESMExports();\n');
    const shards = partitionSafeBashTestShards("/repo/packages/safe-bash",
      ["src/a.test.ts", "src/b.test.ts"], { fileSystem });
    expect(shards).toEqual([
      { index: 0, isolate: false, files: ["src/b.test.ts"] },
      { index: 1, isolate: true, files: ["src/a.test.ts"] }
    ]);
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
