import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { readRegistry, type Worktree, type WorktreeDeps } from "@poe-code/worktree";
import { reconcileManagedWorktree } from "./worktree.js";
import type { SpawnOptions, SpawnResult } from "./types.js";

const registryFile = "/repo/.poe-code/worktrees.yaml";
const worktreePath = "/repo/.poe-code/worktrees/fixture";

function fixture(overrides: Partial<Worktree> = {}) {
  const entry: Worktree = {
    name: "fixture", path: worktreePath, branch: "poe-code/fixture",
    baseBranch: "HEAD", baseHead: "base123", createdAt: "2026-08-31T00:00:00.000Z",
    source: "sdk", sourceCwd: "/repo", agent: "fixture-agent", status: "failed",
    ...overrides
  };
  const volume = Volume.fromJSON({
    [registryFile]: JSON.stringify({ worktrees: [entry] }),
    "/repo/keep.txt": "source content",
    "/repo/src/task.ts": "base task\n",
    "/repo/src/committed.ts": "base committed\n",
    [`${worktreePath}/src/task.ts`]: "worktree task\n",
    [`${worktreePath}/src/committed.ts`]: "worktree committed\n"
  });
  const fs = createFsFromVolume(volume).promises;
  const state = { status: "", unmerged: "", applied: false, removed: false };
  const exec: WorktreeDeps["exec"] = vi.fn(async (command, options) => {
    const output = (stdout = "") => ({ stdout, stderr: "" });
    if (command === "git status --porcelain=v1 -z") {
      return output(options?.cwd === worktreePath ? " M src/task.ts\0" : state.status);
    }
    if (command === "git rev-parse HEAD") return output("feature123\n");
    if (command === "git diff --name-only -z 'base123' 'feature123'") return output("src/committed.ts\0");
    if (command === "git diff --name-only --diff-filter=U -z") return output(state.unmerged);
    if (command === "git diff --name-only -z 'base123'") return output(state.applied ? "src/task.ts\0src/committed.ts\0" : "");
    if (command === "git worktree list --porcelain") return output(state.removed ? "" : `worktree ${worktreePath}\n`);
    throw new Error(`Unexpected fixture Git command: ${command}`);
  });
  const deps: WorktreeDeps = { fs: fs as unknown as WorktreeDeps["fs"], exec };
  const options = { cwd: "/repo", name: "fixture", agent: "fixture-agent", registryFile, deps };
  const result = (exitCode = 0, threadId?: string): SpawnResult => ({ stdout: "", stderr: "", exitCode, threadId });
  async function conflict() {
    state.status = "UU src/task.ts\0";
    state.unmerged = "src/task.ts\0";
    await fs.writeFile("/repo/src/task.ts", "<<<<<<< HEAD\nbase task\n=======\nworktree task\n>>>>>>> fixture\n");
  }
  async function applyChanges() {
    await fs.writeFile("/repo/src/task.ts", "worktree task\n");
    await fs.writeFile("/repo/src/committed.ts", "worktree committed\n");
    state.applied = true;
    state.unmerged = "";
    state.status = " M src/task.ts\0 M src/committed.ts\0";
  }
  async function finish() {
    await applyChanges();
    await fs.rm(worktreePath, { recursive: true });
    state.removed = true;
    return result();
  }
  return { volume, fs, state, deps, options, result, conflict, applyChanges, finish };
}

const failures = [
  "nonzero exit", "unresolved conflicts", "missing transfer", "cleanup remains",
  "reconcile throws", "reconcile cancelled", "cleanup throws", "cleanup cancelled"
] as const;

describe("SDK worktree reconciliation recovery", () => {
  it.each(failures)("recovers after %s without discarding retained changes", async failure => {
    const setup = fixture();
    const controller = new AbortController();
    const agentError = new Error(`Fixture ${failure}`);
    const cleanup = failure.startsWith("cleanup");
    const throws = failure.endsWith("throws") || failure.endsWith("cancelled");
    const firstAgent = vi.fn(async (_agent: string, options: SpawnOptions) => {
      if (cleanup && firstAgent.mock.calls.length === 1) {
        await setup.applyChanges();
        return setup.result(0, "original-thread");
      }
      if (!cleanup) await setup.conflict();
      if (failure === "missing transfer") {
        setup.state.status = "?? partial.txt\0";
        setup.state.unmerged = "";
        await setup.fs.writeFile("/repo/src/task.ts", "base task\n");
        await setup.fs.writeFile("/repo/partial.txt", "partial agent output");
      }
      if (throws) {
        if (failure.endsWith("cancelled")) {
          controller.abort(agentError);
          options.signal?.throwIfAborted();
        }
        throw agentError;
      }
      return setup.result(failure === "nonzero exit" ? 1 : 0, "original-thread");
    });
    const first = reconcileManagedWorktree({ ...setup.options, signal: controller.signal, spawnAgent: firstAgent });
    if (throws) await expect(first).rejects.toBe(agentError);
    else await expect(first).rejects.toThrow("Worktree reconciliation");
    const failed = (await readRegistry(registryFile, setup.deps.fs)).worktrees[0]!;
    const threadId = throws && !cleanup ? undefined : "original-thread";
    expect(failed.status).toBe(cleanup ? "cleanup_failed" : "conflicted");
    expect(failed.reconciliation?.threadId).toBe(threadId);
    if (throws) expect(failed.reconciliation).toMatchObject({
      committed: cleanup ? "merged_by_agent" : "failed",
      uncommitted: cleanup ? "applied_by_agent" : "failed", cleanup: "failed"
    });
    const retainedTask = await setup.fs.readFile("/repo/src/task.ts", "utf8");
    const recoveryAgent = vi.fn(async (_agent: string, options: SpawnOptions) => {
      expect(options.cwd).toBe("/repo");
      expect(options.worktree).toBe(false);
      expect(options.resumeThreadId).toBe(threadId);
      expect(options.prompt).toContain("Resume the previous failed reconciliation");
      expect(options.prompt).toContain("Preserve existing destination changes and user conflict resolutions");
      expect(options.prompt).toContain("Complete an in-progress merge before starting another");
      expect(await setup.fs.readFile("/repo/src/task.ts", "utf8")).toBe(retainedTask);
      expect(await setup.fs.readFile(`${worktreePath}/src/task.ts`, "utf8")).toBe("worktree task\n");
      expect(await setup.fs.readFile(`${worktreePath}/src/committed.ts`, "utf8")).toBe("worktree committed\n");
      return setup.finish();
    });
    await expect(reconcileManagedWorktree({ ...setup.options, spawnAgent: recoveryAgent })).resolves.toMatchObject({
      committed: "merged_by_agent", uncommitted: "applied_by_agent", removed: true,
      cleanup: "removed_by_agent", conflictFiles: [], threadId
    });
    expect(recoveryAgent).toHaveBeenCalledTimes(1);
    expect((await readRegistry(registryFile, setup.deps.fs)).worktrees[0]?.status).toBe("done");
    expect(await setup.fs.readFile("/repo/keep.txt", "utf8")).toBe("source content");
    if (failure === "missing transfer") expect(await setup.fs.readFile("/repo/partial.txt", "utf8")).toBe("partial agent output");
  });

  it("retains the thread across another failed retry without a replacement ID", async () => {
    const setup = fixture();
    await expect(reconcileManagedWorktree({ ...setup.options, spawnAgent: async () => {
      await setup.conflict();
      return setup.result(1, "original-thread");
    } })).rejects.toThrow("exited with code 1");
    await expect(reconcileManagedWorktree({ ...setup.options, spawnAgent: async (_agent, options) => {
      expect(options.resumeThreadId).toBe("original-thread");
      return setup.result(1);
    } })).rejects.toThrow("exited with code 1");
    expect((await readRegistry(registryFile, setup.deps.fs)).worktrees[0]?.reconciliation?.threadId).toBe("original-thread");
    await expect(reconcileManagedWorktree({ ...setup.options, spawnAgent: async (_agent, options) => {
      expect(options.resumeThreadId).toBe("original-thread");
      return setup.finish();
    } })).resolves.toMatchObject({ removed: true, threadId: "original-thread" });
  });

  it("hands user resolutions and new notes intact to the recovery agent", async () => {
    const setup = fixture();
    await expect(reconcileManagedWorktree({ ...setup.options, spawnAgent: async () => {
      await setup.conflict();
      return setup.result(1, "original-thread");
    } })).rejects.toThrow("exited with code 1");
    await setup.fs.writeFile("/repo/src/task.ts", "user resolution\n");
    await setup.fs.writeFile("/repo/user-note.txt", "keep my note");
    setup.state.status = "M  src/task.ts\0?? user-note.txt\0";
    setup.state.unmerged = "";
    await expect(reconcileManagedWorktree({ ...setup.options, spawnAgent: async (_agent, options) => {
      expect(options.prompt).toContain("Preserve existing destination changes and user conflict resolutions");
      expect(await setup.fs.readFile("/repo/src/task.ts", "utf8")).toBe("user resolution\n");
      expect(await setup.fs.readFile("/repo/user-note.txt", "utf8")).toBe("keep my note");
      await setup.finish();
      await setup.fs.writeFile("/repo/src/task.ts", "user resolution\n");
      return setup.result();
    } })).resolves.toMatchObject({ removed: true });
    expect(await setup.fs.readFile("/repo/src/task.ts", "utf8")).toBe("user resolution\n");
    expect(await setup.fs.readFile("/repo/user-note.txt", "utf8")).toBe("keep my note");
  });

  it.each(["active", "failed", "reconciling", "removing", "done", "conflicted", "cleanup_failed"] as const)(
    "keeps the dirty-destination guard for %s without a recorded recovery",
    async status => {
      const setup = fixture({ status, ...(!["conflicted", "cleanup_failed"].includes(status) ? {
        reconciliation: { committed: "failed", uncommitted: "failed", cleanup: "failed", removed: false, conflictFiles: [] }
      } : {}) });
      setup.state.status = " M keep.txt\0";
      const before = setup.volume.toJSON();
      const spawnAgent = vi.fn(setup.finish);
      await expect(reconcileManagedWorktree({ ...setup.options, spawnAgent })).rejects.toThrow("destination checkout has uncommitted changes");
      expect(spawnAgent).not.toHaveBeenCalled();
      expect(setup.volume.toJSON()).toEqual(before);
    }
  );

  it("still reconciles a fresh clean destination without recovery instructions", async () => {
    const setup = fixture();
    await expect(reconcileManagedWorktree({ ...setup.options, spawnAgent: async (_agent, options) => {
      expect(options).not.toHaveProperty("resumeThreadId");
      expect(options.prompt).not.toContain("Resume the previous failed reconciliation");
      return setup.finish();
    } })).resolves.toMatchObject({ removed: true });
  });

  it("reports both agent and failure-recording errors", async () => {
    const setup = fixture();
    const agentError = new Error("Agent interrupted");
    const recordingError = new Error("Registry unavailable");
    const failure = await reconcileManagedWorktree({ ...setup.options, spawnAgent: async () => {
      await setup.conflict();
      setup.deps.fs.rename = async () => { throw recordingError; };
      throw agentError;
    } }).catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([agentError, recordingError]);
    expect(await setup.fs.readFile(`${worktreePath}/src/task.ts`, "utf8")).toBe("worktree task\n");
    expect(await setup.fs.readdir("/repo/.poe-code")).toEqual(["worktrees", "worktrees.yaml"]);
  });
});
