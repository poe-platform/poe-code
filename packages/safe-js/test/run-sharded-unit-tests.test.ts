import { createFsFromVolume, Volume } from "memfs";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  computeSafeJsShardKeys,
  partitionSafeJsTestShards,
  runSafeJsShardedUnitTests
} from "../scripts/run-sharded-unit-tests.mjs";

function createFixtureFs(extraFiles: Record<string, string> = {}) {
  return createFsFromVolume(
    Volume.fromJSON({
      "/repo/vitest.config.ts": "export default {};",
      "/repo/tests/setup.ts": "",
      "/repo/tests/test-env.ts": "",
      "/repo/package-lock.json": "{}",
      "/repo/packages/safe-fs/src/index.ts": "export const fs = 1;",
      "/repo/packages/frontmatter/src/index.ts": "export const fm = 1;",
      "/repo/packages/agent-spawn/src/index.ts": "export const spawn = 1;",
      "/repo/packages/tiny-mcp-client/src/index.ts": "export const mcp = 1;",
      "/repo/packages/safe-js/package.json": JSON.stringify({ name: "@poe-code/safe-js" }),
      "/repo/packages/safe-js/tsconfig.json": "{}",
      "/repo/packages/safe-js/src/index.ts": "export const run = () => 42;",
      "/repo/packages/safe-js/src/a.test.ts": "it('a', () => {});",
      "/repo/packages/safe-js/src/b.test.ts": "it('b', () => {});",
      "/repo/packages/safe-js/src/mocked.test.ts": "vi.mock('./index.js'); it('m', () => {});",
      ...extraFiles
    })
  ) as unknown as typeof import("node:fs");
}

describe("safe-js sharded unit test runner", () => {
  it("loads the CLI entrypoint in native Node without a TypeScript config loader", () => {
    const entry = new URL("../scripts/run-sharded-unit-tests.mjs", import.meta.url).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(entry)});`], {
      encoding: "utf8", timeout: 5000, env: { ...process.env, NODE_OPTIONS: "" }
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });

  it("partitions non-mocking files into non-isolated shards and mocking files into isolated shards", () => {
    const fileSystem = createFixtureFs();
    const files = [
      "packages/safe-js/src/a.test.ts",
      "packages/safe-js/src/b.test.ts",
      "packages/safe-js/src/mocked.test.ts"
    ];
    const shards = partitionSafeJsTestShards("/repo", files, {
      fileSystem,
      sharedShardSize: 2,
      isolatedShardSize: 2
    });
    expect(shards).toEqual([
      {
        index: 0,
        isolate: false,
        files: ["packages/safe-js/src/a.test.ts", "packages/safe-js/src/b.test.ts"]
      },
      {
        index: 1,
        isolate: true,
        files: ["packages/safe-js/src/mocked.test.ts"]
      }
    ]);
  });

  it("keeps unchanged shard cache keys stable when only a test file in another shard changes", () => {
    const fs1 = createFixtureFs();
    const fs2 = createFixtureFs({
      "/repo/packages/safe-js/src/mocked.test.ts": "vi.mock('./index.js'); it('changed', () => {});"
    });
    const files = [
      "packages/safe-js/src/a.test.ts",
      "packages/safe-js/src/b.test.ts",
      "packages/safe-js/src/mocked.test.ts"
    ];
    const keys1 = computeSafeJsShardKeys(
      "/repo",
      partitionSafeJsTestShards("/repo", files, { fileSystem: fs1, sharedShardSize: 2 }),
      { fileSystem: fs1 }
    );
    const keys2 = computeSafeJsShardKeys(
      "/repo",
      partitionSafeJsTestShards("/repo", files, { fileSystem: fs2, sharedShardSize: 2 }),
      { fileSystem: fs2 }
    );
    expect(keys1[0].key).toBe(keys2[0].key);
    expect(keys1[1].key).not.toBe(keys2[1].key);
  });

  it("persists each passing shard immediately, skips cached shards, and retries non-isolated failures with isolation", () => {
    const fileSystem = createFixtureFs();
    const store = new Map<string, unknown>();
    const cacheStore = {
      read: vi.fn((key: string) => store.get(key) ?? null),
      write: vi.fn((key: string, value: unknown) => {
        store.set(key, value);
      })
    };
    const spawnCalls: Array<{ args: string[] }> = [];
    const spawn = vi.fn((_cmd: string, args: string[]) => {
      spawnCalls.push({ args });
      if (spawnCalls.length === 1 && args.includes("--no-isolate")) {
        return { status: 1, signal: null };
      }
      return { status: 0, signal: null };
    });

    const firstRun = runSafeJsShardedUnitTests("/repo", {
      fileSystem,
      cacheStore,
      spawn,
      sharedShardSize: 2,
      isolatedShardSize: 2
    });
    expect(firstRun).toMatchObject({
      skipped: false,
      shards: 2,
      cacheHits: 0,
      cacheMisses: 2
    });
    expect(spawnCalls).toHaveLength(3);
    expect(spawnCalls[0].args).toContain("--no-isolate");
    expect(spawnCalls[0].args).toContain("--testTimeout=30000");
    expect(spawnCalls[1].args).not.toContain("--no-isolate");
    expect(cacheStore.write).toHaveBeenCalledTimes(2);

    spawn.mockClear();
    const secondRun = runSafeJsShardedUnitTests("/repo", {
      fileSystem,
      cacheStore,
      spawn,
      sharedShardSize: 2,
      isolatedShardSize: 2
    });
    expect(secondRun).toMatchObject({
      skipped: false,
      shards: 2,
      cacheHits: 2,
      cacheMisses: 0
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("does not skip sharded execution when /proc/<ppid>/cmdline is the Linux /bin/sh -c pretest wrapper", () => {
    const npmPid = 4242;
    const fileSystem = createFixtureFs({
      [`/proc/${process.ppid}/cmdline`]: [
        "/bin/sh",
        "-c",
        "node scripts/numberformat-data.mjs && npm run typecheck:fs && node scripts/run-sharded-unit-tests.mjs"
      ].join("\0"),
      [`/proc/${process.ppid}/status`]: `Name:\tsh\nPPid:\t${npmPid}\n`,
      [`/proc/${npmPid}/cmdline`]: [
        "node",
        "/usr/local/bin/npm",
        "--workspace=@poe-code/safe-js",
        "--if-present=false",
        "run",
        "test:unit"
      ].join("\0")
    });
    const spawn = vi.fn(() => ({ status: 0, signal: null }));
    const summary = runSafeJsShardedUnitTests("/repo", {
      fileSystem,
      spawn,
      sharedShardSize: 2,
      isolatedShardSize: 2
    });
    expect(summary.skipped).toBe(false);
    expect(summary.shards).toBe(2);
  });
  it("enforces --maxWorkers=1 and VITEST_MAX_WORKERS=1 so sharded execution never spawns parallel workers", () => {
    const fileSystem = createFixtureFs();
    const spawnCalls: Array<{ args: string[]; env: Record<string, string | undefined> }> = [];
    const spawn = vi.fn((_cmd: string, args: string[], opts: { env: Record<string, string | undefined> }) => {
      spawnCalls.push({ args, env: opts.env });
      return { status: 0, signal: null };
    });
    runSafeJsShardedUnitTests("/repo", {
      fileSystem,
      spawn,
      sharedShardSize: 2,
      isolatedShardSize: 2
    });
    expect(spawnCalls.length).toBeGreaterThan(0);
    for (const call of spawnCalls) {
      expect(call.args).toContain("--maxWorkers=1");
      expect(call.args).not.toContain("--maxWorkers=4");
      expect(call.env.VITEST_MAX_WORKERS).toBe("1");
    }
  });
});
