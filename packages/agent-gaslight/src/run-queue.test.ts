import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { createRunQueue } from "@poe-code/agent-harness-tools";
import { runGaslight } from "./run.js";

function options() {
  return { cwd: "/repo", homeDir: "/home", agent: "codex", model: "chosen", mode: "read" as const,
    prompt: "Implement", followups: ["Verify"],
    fs: createFsFromVolume(Volume.fromJSON({ "/repo/one.md": "# One", "/repo/two.md": "# Two", "/repo/three.md": "# Three" })).promises };
}

describe("live Gaslight queue", () => {
  it("runs messages after each plan and includes plans appended while an agent runs", async () => {
    const queue = createRunQueue({ plans: ["one.md", "two.md"], cwd: "/repo" });
    queue.enqueueMessage("Review first");
    queue.enqueueMessage("Check first");
    const calls: Array<{ agent: string; prompt: string; cwd?: string; model?: string; mode?: string; resumeThreadId?: string }> = [];
    const result = await runGaslight({ ...options(), queue, spawn: async (agent, input) => {
      calls.push({ agent, ...input });
      if (calls.length === 1) queue.enqueuePlan("three.md");
      return { exitCode: 0, stdout: "Done", stderr: "", threadId: `thread-${calls.length}` };
    } });
    expect(calls.map((call) => call.prompt)).toEqual(["Implement one.md", "Verify", "Review first", "Check first", "Implement two.md", "Verify", "Implement three.md", "Verify"]);
    expect(calls.every((call) => call.agent === "codex" && call.model === "chosen" && call.cwd === "/repo" && call.mode === "read")).toBe(true);
    expect(calls.map((call) => call.resumeThreadId)).toEqual([undefined, "thread-1", "thread-2", "thread-3", undefined, "thread-5", undefined, "thread-7"]);
    expect(result.plans.map((plan) => plan.planPath)).toEqual(["one.md", "two.md", "three.md"]);
    expect(result.messages).toHaveLength(2);
    expect(result.queue?.status).toBe("completed");
  });

  it("supports repeatable afterEachPlan messages and counts their usage once", async () => {
    const result = await runGaslight({ ...options(), planPaths: ["one.md", "two.md"], afterEachPlan: ["Review"],
      spawn: async () => ({ exitCode: 0, stdout: "Done", stderr: "", threadId: "thread", usage: { inputTokens: 10, outputTokens: 2 } }) });
    expect(result.messages).toHaveLength(2);
    expect(result.usage).toMatchObject({ inputTokens: 60, outputTokens: 12 });
  });

  it("stops pending work after a failed follow-up", async () => {
    const queue = createRunQueue({ plans: ["one.md", "two.md"], afterEachPlan: ["Review"], cwd: "/repo" });
    const spawn = vi.fn(async (_agent, input) => ({ exitCode: input.prompt === "Review" ? 1 : 0, stdout: "", stderr: "Failed", threadId: "thread" }));
    await expect(runGaslight({ ...options(), queue, spawn })).rejects.toThrow("follow-up");
    expect(queue.getSnapshot().status).toBe("failed");
    expect(queue.getSnapshot().items[2]).toMatchObject({ kind: "plan", status: "pending" });
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it("propagates cancellation and does not advance queued plans", async () => {
    const controller = new AbortController();
    const queue = createRunQueue({ plans: ["one.md", "two.md"], afterEachPlan: ["Review"], cwd: "/repo" });
    const spawn = vi.fn(async (_agent, input) => {
      expect(input.signal).toBe(controller.signal);
      controller.abort();
      return { exitCode: 0, stdout: "", stderr: "", threadId: "thread" };
    });
    await runGaslight({ ...options(), queue, signal: controller.signal, spawn });
    expect(queue.getSnapshot().status).toBe("cancelled");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(queue.getSnapshot().items[1]).toMatchObject({ kind: "message", status: "pending" });
  });

  it("maps dynamically queued repository paths into the active worktree", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({ "/worktree/one.md": "# One", "/worktree/two.md": "# Two" })).promises;
    const queue = createRunQueue({ plans: ["/repo/one.md"], cwd: "/repo" });
    const spawn = vi.fn(async () => {
      if (queue.getSnapshot().items.length === 1) queue.enqueuePlan("/repo/two.md");
      return { exitCode: 0, stdout: "", stderr: "", threadId: "thread" };
    });
    const result = await runGaslight({ ...options(), queue, fs, cwd: "/worktree", sourceCwd: "/repo", spawn });
    expect(result.plans.map((plan) => plan.planPath)).toEqual(["/worktree/one.md", "/worktree/two.md"]);
  });
});
