import { EventEmitter } from "node:events";
import type { SpawnOptions } from "node:child_process";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { testWorkspaces } from "./build-workspaces.mjs";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => "GIT_DIR\nGIT_WORK_TREE\n"),
  spawn: vi.fn()
}));

function fixture(failedEvent?: string) {
  const fileSystem = createFsFromVolume(Volume.fromJSON({
    "/repo/package.json": JSON.stringify({
      name: "root", workspaces: ["packages/*"], scripts: {
        "test:unit": "vitest run --config vitest.root.config.ts",
        "test:unit:shared": "node scripts/test-vitest-workspaces.mjs"
      }
    }),
    "/repo/turbo.json": JSON.stringify({ tasks: {
      build: { dependsOn: ["^build"] },
      "test:unit": { dependsOn: [] },
      "virtual-bash#test:unit": { dependsOn: ["build"] }
    } }),
    "/repo/packages/alpha/package.json": JSON.stringify({ name: "alpha", scripts: { "test:unit": "cd ../.. && vitest run packages/alpha/src" } }),
    "/repo/packages/alpha/src/unit.test.ts": "",
    "/repo/packages/beta/package.json": JSON.stringify({ name: "beta", scripts: { "test:unit": "cd ../.. && vitest run packages/beta/src" } }),
    "/repo/packages/beta/src/unit.test.ts": "",
    "/repo/packages/native/package.json": JSON.stringify({ name: "virtual-bash", scripts: { build: "node build.mjs", "test:unit": "node --test" } })
  })) as unknown as typeof import("node:fs");
  const host = Object.assign(new EventEmitter(), {
    platform: "linux", execPath: "/node",
    kill: vi.fn((_pid: number, signal: string | number) => {
      if (signal === 0) throw Object.assign(new Error("absent"), { code: "ESRCH" });
      return true;
    })
  });
  let nextPid = 100;
  const start = vi.fn((_command: string, args: string[], _options: SpawnOptions) => {
    const child = Object.assign(new EventEmitter(), { pid: nextPid++ });
    queueMicrotask(() => child.emit("close", args[4] === failedEvent ? 7 : 0, null));
    return child;
  });
  const options = {
    fileSystem,
    host: host as unknown as typeof process,
    spawn: start as unknown as typeof import("node:child_process").spawn,
    environment: {
      npm_execpath: "/npm-cli.js", PATH: "/bin", GIT_DIR: "/foreign/git",
      SAFE_BASH_TEST_SHARD: "1/4", SAFE_BASH_TEST_CONCURRENCY: "2",
      SAFEJS_LOCAL_ROOT: "/owned/safejs", S3_HTTP_EXPORTS_REVISION: "owned-revision", FULL_GATE_ROOT: "/owned/gate"
    }
  };
  return { fileSystem, host, start, options };
}

describe("native workspace routing with shared Vitest", () => {
  it("retains build prerequisites, task accounting, native Bash environment and owned process cleanup", async () => {
    const { host, start, options } = fixture();
    const result = await testWorkspaces("/repo", options);
    expect(result).toMatchObject({ builds: 1, tests: 4, concurrency: 1, cache: "UNCACHED" });
    expect(start.mock.calls.map(call => call[1][4])).toEqual(["build", "test:unit:shared", "test:unit"]);
    expect(start.mock.calls[1][1]).toContain("--workspaces=false");
    expect(start.mock.calls[1][1].slice(-4)).toEqual(["--", ".", "packages/alpha", "packages/beta"]);
    expect(start.mock.calls[2][1]).toContain("--workspace=packages/native");
    for (const call of start.mock.calls) {
      expect(call[2].detached).toBe(true);
      expect(call[2].env?.GIT_DIR).toBeUndefined();
      const bash = call[1][4] === "test:unit";
      for (const name of ["SAFEJS_LOCAL_ROOT", "S3_HTTP_EXPORTS_REVISION", "FULL_GATE_ROOT", "SAFE_BASH_TEST_SHARD", "SAFE_BASH_TEST_CONCURRENCY"] as const) {
        expect(call[2].env?.[name]).toBe(bash ? options.environment[name] : undefined);
      }
    }
    expect(host.listenerCount("SIGINT")).toBe(0);
    expect(host.listenerCount("SIGTERM")).toBe(0);
  });

  it("retains the original route and every argument when tests are explicitly filtered", async () => {
    const { start, options } = fixture();
    await testWorkspaces("/repo", { ...options, testArguments: ["--reporter=json", "literal filter"] });
    expect(start.mock.calls.map(call => call[1][4])).toEqual(["build", "test:unit", "test:unit", "test:unit", "test:unit"]);
    for (const call of start.mock.calls.slice(1)) expect(call[1].slice(-3)).toEqual(["--", "--reporter=json", "literal filter"]);
  });

  it("stops before native tests when the shared process fails", async () => {
    const { host, start, options } = fixture("test:unit:shared");
    await expect(testWorkspaces("/repo", options)).rejects.toMatchObject({ exitCode: 7 });
    expect(start.mock.calls.map(call => call[1][4])).toEqual(["build", "test:unit:shared"]);
    expect(host.listenerCount("SIGTERM")).toBe(0);
  });
});
