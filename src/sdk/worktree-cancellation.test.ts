import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { readRegistry, type WorktreeDeps } from "@poe-code/worktree";
import {
  reconcileManagedWorktree,
  runInWorktree,
  runWithOptionalWorktree
} from "./worktree.js";
import type { SpawnOptions, SpawnResult } from "./types.js";

const registryFile = "/repo/.poe-code/worktrees.yaml";
const worktreeDir = "/repo/.poe-code/worktrees";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function fixture(mode: "managed" | "automatic" | "optional") {
  const fs = createFsFromVolume(Volume.fromJSON({ "/repo/keep.txt": "source content" })).promises;
  const state = { worktreePath: `${worktreeDir}/fixture`, removed: false };
  if (mode === "managed") {
    await fs.mkdir(state.worktreePath, { recursive: true });
    await fs.writeFile(`${state.worktreePath}/keep.txt`, "worktree content");
    await fs.writeFile(registryFile, JSON.stringify({ worktrees: [{
      name: "fixture", path: state.worktreePath, branch: "poe-code/fixture",
      baseBranch: "HEAD", baseHead: "base123", createdAt: "2026-08-31T00:00:00.000Z",
      source: "sdk", sourceCwd: "/repo", agent: "fixture-agent", status: "failed"
    }] }));
  }
  const exec: WorktreeDeps["exec"] = vi.fn(async (command) => {
    const output = (stdout = "") => ({ stdout, stderr: "" });
    if (command === "git rev-parse --is-inside-work-tree") return output("true\n");
    if (command.startsWith("git rev-parse ")) return output("base123\n");
    if (command === "git status --porcelain=v1 -z") return output();
    if (command === "git diff --name-only --diff-filter=U -z") return output();
    if (command === "git worktree list --porcelain") return output(state.removed ? "" : `worktree ${state.worktreePath}\n`);
    if (command.startsWith("git worktree remove ") || command.startsWith("git branch -D ")) throw new Error("Fixture previous checkout absent");
    if (command.startsWith("git worktree add ")) {
      state.worktreePath = command.split("'")[3]!;
      await fs.mkdir(state.worktreePath, { recursive: true });
      await fs.writeFile(`${state.worktreePath}/keep.txt`, "worktree content");
      return output();
    }
    throw new Error(`Unexpected fixture Git command: ${command}`);
  });
  return { fs, state, deps: { fs: fs as unknown as WorktreeDeps["fs"], exec } };
}

const cases = (["managed", "automatic", "optional"] as const).flatMap(mode =>
  (["reconcile", "cleanup-nudge"] as const).flatMap(phase =>
    (["cancelled", "completed", "no-signal"] as const).map(outcome => ({ mode, phase, outcome }))
  )
);

describe("SDK worktree reconciliation cancellation", () => {
  it.each(cases)("$mode $phase preserves $outcome behavior", async ({ mode, phase, outcome }) => {
    const setup = await fixture(mode);
    const controller = new AbortController();
    const cancellation = Object.assign(new Error("Fixture reconciliation cancelled"), { name: "AbortError" });
    const entered = deferred();
    const completion = deferred();
    void completion.promise.catch(() => undefined);
    const targetInvocation = phase === "reconcile" ? 1 : 2;
    const spawnAgent = vi.fn(async (_agent: string, options: SpawnOptions): Promise<SpawnResult> => {
      if (spawnAgent.mock.calls.length !== targetInvocation) {
        return { stdout: "", stderr: "", exitCode: 0, threadId: "fixture-thread" };
      }
      const onAbort = () => completion.reject(options.signal?.reason);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
      entered.resolve();
      try {
        await completion.promise;
        setup.state.removed = true;
        await setup.fs.rm(setup.state.worktreePath, { recursive: true, force: true });
        return { stdout: "", stderr: "", exitCode: 0, threadId: "fixture-thread" };
      } finally {
        options.signal?.removeEventListener("abort", onAbort);
      }
    });
    const shared = {
      cwd: "/repo", deps: setup.deps, spawnAgent,
      ...(outcome === "no-signal" ? {} : { signal: controller.signal })
    };
    const automatic = {
      ...shared, selectedAgent: "fixture-agent", selectedModel: "fixture-model",
      worktree: true as const, run: async () => "callback result"
    };
    const operation = mode === "managed"
      ? reconcileManagedWorktree({ ...shared, name: "fixture", agent: "fixture-agent", registryFile })
      : mode === "automatic" ? runInWorktree(automatic) : runWithOptionalWorktree(automatic);
    void operation.catch(() => undefined);
    try {
      await Promise.race([
        entered.promise,
        operation.then(() => { throw new Error("Reconciliation completed before reaching the target agent"); })
      ]);
      expect(spawnAgent).toHaveBeenCalledTimes(targetInvocation);
      for (const [agent, options] of spawnAgent.mock.calls) {
        expect(agent).toBe("fixture-agent");
        expect(options.cwd).toBe("/repo");
        expect(options.worktree).toBe(false);
        if (outcome === "no-signal") expect(options).not.toHaveProperty("signal");
        else expect(options.signal).toBe(controller.signal);
        if (mode !== "managed") expect(options.model).toBe("fixture-model");
      }
      if (phase === "cleanup-nudge") expect(spawnAgent.mock.calls[1]![1].resumeThreadId).toBe("fixture-thread");
      if (outcome === "cancelled") {
        controller.abort(cancellation);
        await expect(operation).rejects.toBe(cancellation);
        expect(setup.state.removed).toBe(false);
        expect(await setup.fs.readFile(`${setup.state.worktreePath}/keep.txt`, "utf8")).toBe("worktree content");
        expect((await readRegistry(registryFile, setup.deps.fs)).worktrees[0]?.status).not.toBe("done");
      } else {
        completion.resolve();
        await expect(operation).resolves.toBeDefined();
        expect(setup.state.removed).toBe(true);
        expect((await readRegistry(registryFile, setup.deps.fs)).worktrees[0]?.status).toBe("done");
      }
      expect(spawnAgent).toHaveBeenCalledTimes(targetInvocation);
      expect(await setup.fs.readFile("/repo/keep.txt", "utf8")).toBe("source content");
    } finally {
      completion.reject(new Error("Fixture cleanup"));
      await operation.catch(() => undefined);
    }
  });

  it("forwards an already-aborted manual reconciliation signal", async () => {
    const setup = await fixture("managed");
    const controller = new AbortController();
    const cancellation = new Error("Already cancelled");
    controller.abort(cancellation);
    const spawnAgent = vi.fn(async (_agent: string, options: SpawnOptions) => {
      expect(options.signal).toBe(controller.signal);
      options.signal?.throwIfAborted();
      throw new Error("Cancellation did not reach the agent");
    });
    await expect(reconcileManagedWorktree({
      cwd: "/repo", name: "fixture", agent: "fixture-agent", registryFile,
      deps: setup.deps, signal: controller.signal, spawnAgent
    })).rejects.toBe(cancellation);
    expect(spawnAgent).toHaveBeenCalledTimes(1);
    expect(await setup.fs.readFile(`${setup.state.worktreePath}/keep.txt`, "utf8")).toBe("worktree content");
  });
});
