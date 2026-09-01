import { afterEach, describe, expect, it, vi } from "vitest";
import { createFsFromVolume, Volume } from "memfs";
import { readRegistry, type WorktreeDeps } from "@poe-code/worktree";
import type { RunWithOptionalWorktreeInput } from "./worktree.js";
import { runRalph, type RalphRunOptions } from "./ralph.js";
import { runPipeline, type PipelineRunOptions } from "./pipeline.js";

const injected = vi.hoisted(() => ({
  deps: undefined as WorktreeDeps | undefined,
  spawnAgent: undefined as RunWithOptionalWorktreeInput<unknown>["spawnAgent"]
}));

vi.mock("./worktree.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./worktree.js")>();
  return {
    ...actual,
    runWithOptionalWorktree: <Value>(input: RunWithOptionalWorktreeInput<Value>) =>
      actual.runWithOptionalWorktree({
        ...input,
        deps: injected.deps,
        spawnAgent: injected.spawnAgent
      })
  };
});

const documentPath = "docs/plans/fixture.md";
const outputPath = "src/implementation.ts";
const outputContent = "export const implementation = true;\n";

afterEach(() => {
  injected.deps = undefined;
  injected.spawnAgent = undefined;
});

function createFixture(kind: "ralph" | "pipeline", outcome: "failed" | "cancelled" | "success") {
  const document = kind === "ralph"
    ? "---\nagent: fixture-agent\niterations: 1\n---\nImplement the task.\n"
    : "---\nkind: pipeline\nversion: 1\ntasks:\n  - id: work\n    title: Implement\n    prompt: Implement the task.\n    status: open\n---\n";
  const fs = createFsFromVolume(Volume.fromJSON({ [`/repo/${documentPath}`]: document })).promises;
  const controller = new AbortController();
  const state = { worktreePath: "", partialWritten: false, sourceChanged: false, removed: false };
  const exec: WorktreeDeps["exec"] = vi.fn(async (command, options) => {
    const output = (stdout = "") => ({ stdout, stderr: "" });
    if (command === "git rev-parse --is-inside-work-tree") return output("true\n");
    if (command.startsWith("git rev-parse ")) return output("base123\n");
    if (command.startsWith("git worktree add ")) {
      const quoted = [...command.matchAll(/'([^']*)'/g)].map((match) => match[1]);
      state.worktreePath = quoted[1]!;
      await fs.mkdir(`${state.worktreePath}/docs/plans`, { recursive: true });
      await fs.writeFile(`${state.worktreePath}/${documentPath}`, document);
      return output();
    }
    if (command === "git status --porcelain=v1 -z") {
      const changed = options?.cwd === "/repo" ? state.sourceChanged : state.partialWritten;
      return output(changed ? `?? ${outputPath}\0` : "");
    }
    if (command === "git diff --name-only --diff-filter=U -z") return output();
    if (command === "git diff --name-only -z 'base123'") {
      return output(state.sourceChanged ? `${outputPath}\0` : "");
    }
    if (command === "git worktree list --porcelain") {
      return output(state.removed ? "" : `worktree ${state.worktreePath}\n`);
    }
    throw new Error(`Unexpected fixture Git operation: ${command}`);
  });
  const reconcileAgent = vi.fn(async (_agent: string, options: { prompt?: string }) => {
    expect(options.prompt).toContain("Transfer tracked, staged, unstaged, and untracked worktree file changes into the source checkout.");
    expect(options.prompt).toContain("Remove the managed worktree and branch when done.");
    await fs.mkdir("/repo/src", { recursive: true });
    await fs.writeFile(`/repo/${outputPath}`, await fs.readFile(`${state.worktreePath}/${outputPath}`));
    state.sourceChanged = true;
    await fs.rm(state.worktreePath, { recursive: true, force: true });
    state.removed = true;
    return { stdout: "", stderr: "", exitCode: 0 };
  });
  const runAgent = vi.fn(async (input: { cwd: string }) => {
    expect(input.cwd).toBe(state.worktreePath);
    await fs.mkdir(`${input.cwd}/src`, { recursive: true });
    await fs.writeFile(`${input.cwd}/${outputPath}`, outputContent);
    state.partialWritten = true;
    if (outcome === "cancelled") {
      controller.abort();
      throw Object.assign(new Error("Fixture cancellation"), { name: "AbortError" });
    }
    return { stdout: "", stderr: outcome === "failed" ? "Fixture failure" : "", exitCode: outcome === "failed" ? 1 : 0 };
  });
  injected.deps = { fs: fs as unknown as WorktreeDeps["fs"], exec };
  injected.spawnAgent = reconcileAgent;
  const run = async () => {
    const options = {
      cwd: "/repo", homeDir: "/home/fixture", agent: "fixture-agent",
      worktree: true as const, archive: false, runAgent, signal: controller.signal
    };
    return kind === "ralph"
      ? await runRalph({ ...options, docPath: documentPath, fs: fs as unknown as RalphRunOptions["fs"] })
      : await runPipeline({ ...options, plan: documentPath, logDir: "/fixture-logs", fs: fs as unknown as PipelineRunOptions["fs"] });
  };
  return { fs, state, run, runAgent, reconcileAgent };
}

describe.each(["ralph", "pipeline"] as const)("%s worktree outcomes", (kind) => {
  it.each(["failed", "cancelled"] as const)("preserves %s output without reconciliation or cleanup", async (outcome) => {
    const fixture = createFixture(kind, outcome);
    const result = await fixture.run();

    expect(result.stopReason).toBe(outcome);
    expect(fixture.runAgent).toHaveBeenCalledTimes(1);
    expect(fixture.reconcileAgent).not.toHaveBeenCalled();
    expect(fixture.state.sourceChanged).toBe(false);
    expect(fixture.state.removed).toBe(false);
    await expect(fixture.fs.readFile(`/repo/${outputPath}`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fixture.fs.readFile(`${fixture.state.worktreePath}/${outputPath}`, "utf8")).toBe(outputContent);
    const registry = await readRegistry("/repo/.poe-code/worktrees.yaml", injected.deps!.fs);
    expect(registry.worktrees[0]).toMatchObject({
      status: "failed",
      reconciliation: { committed: "none", uncommitted: "present", removed: false, cleanup: "not_needed" }
    });
  });

  it("still reconciles successful work", async () => {
    const fixture = createFixture(kind, "success");
    const result = await fixture.run();

    expect(result.stopReason).toBe(kind === "ralph" ? "max_iterations" : "completed");
    expect(fixture.reconcileAgent).toHaveBeenCalledTimes(1);
    expect(fixture.state.removed).toBe(true);
    expect(await fixture.fs.readFile(`/repo/${outputPath}`, "utf8")).toBe(outputContent);
    const registry = await readRegistry("/repo/.poe-code/worktrees.yaml", injected.deps!.fs);
    expect(registry.worktrees[0].status).toBe("done");
  });
});
