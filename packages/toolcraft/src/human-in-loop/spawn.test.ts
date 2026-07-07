import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnApprovalRunner } from "./spawn.js";

type SpawnFn = typeof import("node:child_process").spawn;

function createSpawnHarness() {
  const unref = vi.fn();
  const child = { unref } as unknown as ChildProcess;
  const spawnFn = vi.fn<SpawnFn>(() => child);

  return { child, spawnFn, unref };
}

describe("spawnApprovalRunner", () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("uses process.execPath and process.argv[1] when binPath is unset", () => {
    process.argv = [originalArgv[0] ?? process.execPath, "/tmp/toolcraft-entry.mjs"];

    const { spawnFn } = createSpawnHarness();

    spawnApprovalRunner("approval-123", {}, spawnFn);

    expect(spawnFn).toHaveBeenCalledWith(
      process.execPath,
      ["/tmp/toolcraft-entry.mjs", "approvals", "run", "approval-123"],
      expect.objectContaining({
        detached: true,
        stdio: "ignore",
        env: process.env,
        cwd: process.cwd(),
      })
    );
  });

  it("honours a custom binPath", () => {
    const { spawnFn } = createSpawnHarness();
    const runtimeOptions: Parameters<typeof spawnApprovalRunner>[1] = {
      binPath: {
        execPath: "/custom/bin/node",
        entryArgs: ["/custom/bin/poe-code.mjs", "--config", "/tmp/poe-code.json"],
      },
    };

    spawnApprovalRunner("approval-456", runtimeOptions, spawnFn);

    expect(spawnFn).toHaveBeenCalledWith(
      "/custom/bin/node",
      ["/custom/bin/poe-code.mjs", "--config", "/tmp/poe-code.json", "approvals", "run", "approval-456"],
      expect.objectContaining({
        detached: true,
        stdio: "ignore",
      })
    );
  });

  it("does not mutate custom entryArgs when appending approval runner arguments", () => {
    const { spawnFn } = createSpawnHarness();
    const entryArgs = ["/custom/bin/poe-code.mjs", "--config", "/tmp/poe-code.json"] as const;

    spawnApprovalRunner(
      "approval-immutable",
      {
        binPath: {
          execPath: "/custom/bin/node",
          entryArgs,
        },
      },
      spawnFn
    );

    expect(entryArgs).toEqual(["/custom/bin/poe-code.mjs", "--config", "/tmp/poe-code.json"]);
    expect(spawnFn).toHaveBeenCalledWith(
      "/custom/bin/node",
      [...entryArgs, "approvals", "run", "approval-immutable"],
      expect.any(Object)
    );
  });

  it("detaches the child, ignores stdio, and unreferences it", () => {
    const { spawnFn, unref } = createSpawnHarness();

    spawnApprovalRunner("approval-789", {}, spawnFn);

    expect(spawnFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["approvals", "run", "approval-789"]),
      expect.objectContaining({
        detached: true,
        stdio: "ignore",
      })
    );
    expect(unref).toHaveBeenCalledTimes(1);
  });
});
