import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createPostinstallSkillSyncPlan,
  runPostinstallSkillSync
} from "./postinstall-sync-skills.mjs";

const repoRoot = "/repo";
const syncScript = path.join(repoRoot, "scripts/sync-skills.ts");
const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");

function existsFor(paths: string[]): (target: string) => boolean {
  const existingPaths = new Set(paths);
  return (target) => existingPaths.has(target);
}

describe("postinstall skill sync planner", () => {
  it.each(["1", "true"])("skips during CI=%s without touching the filesystem", (ci) => {
    const exists = vi.fn(() => {
      throw new Error("exists should not be called");
    });

    expect(createPostinstallSkillSyncPlan({ env: { CI: ci }, exists })).toEqual({
      action: "skip",
      reason: "ci"
    });
    expect(exists).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "0", "false"])("syncs when CI=%s is disabled", (ci) => {
    expect(
      createPostinstallSkillSyncPlan({
        env: { CI: ci },
        exists: existsFor([syncScript, tsxCli]),
        root: repoRoot
      }).action
    ).toBe("spawn");
  });

  it("skips when skill sync is explicitly disabled", () => {
    expect(
      createPostinstallSkillSyncPlan({
        env: { SKIP_SYNC_SKILLS: "1" },
        exists: existsFor([syncScript]),
        root: repoRoot
      })
    ).toEqual({ action: "skip", reason: "disabled" });
  });

  it("skips when the TypeScript sync script is not present", () => {
    expect(
      createPostinstallSkillSyncPlan({
        env: {},
        exists: existsFor([]),
        root: repoRoot
      })
    ).toEqual({ action: "skip", reason: "missing-sync-script" });
  });

  it("runs sync-skills directly through tsx when the local CLI exists", () => {
    const plan = createPostinstallSkillSyncPlan({
      env: { HOME: "/home/test" },
      execPath: "/usr/bin/node",
      exists: existsFor([syncScript, tsxCli]),
      root: repoRoot
    });

    expect(plan).toMatchObject({
      action: "spawn",
      command: "/usr/bin/node",
      args: [tsxCli, syncScript],
      options: {
        cwd: repoRoot,
        env: {
          HOME: "/home/test",
          SYNC_SKILLS_SCOPE: "global"
        },
        shell: false,
        stdio: "inherit"
      }
    });
  });

  it("uses npm_execpath when direct sync is forced off", () => {
    const plan = createPostinstallSkillSyncPlan({
      env: {
        npm_execpath: "/repo/node_modules/npm/bin/npm-cli.js",
        POE_CODE_POSTINSTALL_FORCE_NPM: "1"
      },
      execPath: "/usr/bin/node",
      exists: existsFor([syncScript, tsxCli]),
      root: repoRoot
    });

    expect(plan).toMatchObject({
      action: "spawn",
      command: "/usr/bin/node",
      args: ["/repo/node_modules/npm/bin/npm-cli.js", "run", "sync-skills"]
    });
  });

  it("falls back to platform npm when npm_execpath is unavailable", () => {
    const linuxPlan = createPostinstallSkillSyncPlan({
      env: { POE_CODE_POSTINSTALL_FORCE_NPM: "1" },
      exists: existsFor([syncScript]),
      platform: "linux",
      root: repoRoot
    });
    const windowsPlan = createPostinstallSkillSyncPlan({
      env: { POE_CODE_POSTINSTALL_FORCE_NPM: "1" },
      exists: existsFor([syncScript]),
      platform: "win32",
      root: repoRoot
    });

    expect(linuxPlan).toMatchObject({
      action: "spawn",
      command: "npm",
      args: ["run", "sync-skills"]
    });
    expect(windowsPlan).toMatchObject({
      action: "spawn",
      command: "npm.cmd",
      args: ["run", "sync-skills"]
    });
  });
});

describe("postinstall skill sync runner", () => {
  it("does not spawn a skipped plan", () => {
    const spawn = vi.fn();

    const result = runPostinstallSkillSync({
      env: { CI: "1" },
      spawn
    });

    expect(result.plan).toEqual({ action: "skip", reason: "ci" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns the planned sync command", () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    const warn = vi.fn();

    runPostinstallSkillSync({
      env: {},
      exists: existsFor([syncScript, tsxCli]),
      execPath: "/usr/bin/node",
      root: repoRoot,
      spawn,
      warn
    });

    expect(spawn).toHaveBeenCalledWith(
      "/usr/bin/node",
      [tsxCli, syncScript],
      expect.objectContaining({
        cwd: repoRoot,
        env: expect.objectContaining({ SYNC_SKILLS_SCOPE: "global" })
      })
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns but does not throw when sync-skills exits nonzero", () => {
    const spawn = vi.fn(() => ({ status: 42 }));
    const warn = vi.fn();

    const result = runPostinstallSkillSync({
      env: {},
      exists: existsFor([syncScript]),
      root: repoRoot,
      spawn,
      warn
    });

    expect(result.result).toEqual({ status: 42 });
    expect(warn).toHaveBeenCalledWith(
      "Warning: skill sync failed during postinstall (exit code 42)."
    );
  });

  it("warns with the spawn error message when npm cannot be launched", () => {
    const spawnError = new Error("npm missing");
    const spawn = vi.fn(() => ({ error: spawnError, status: null }));
    const warn = vi.fn();

    runPostinstallSkillSync({
      env: {},
      exists: existsFor([syncScript]),
      root: repoRoot,
      spawn,
      warn
    });

    expect(warn).toHaveBeenCalledWith(
      "Warning: skill sync failed during postinstall (npm missing)."
    );
  });
});
