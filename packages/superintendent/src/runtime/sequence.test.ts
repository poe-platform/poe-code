import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { createRunQueue } from "@poe-code/agent-harness-tools";
import { runSuperintendentSequence } from "./sequence.js";
import type { AgentRunInput, SuperintendentFileSystem, SuperintendentRunResult } from "./loop.js";

function fixture() {
  const doc = (agent: string) => [
    "---", "kind: superintendent", "version: 1", "builder:", `  agent: ${agent}`,
    "  mode: edit", "  cwd: project", "  prompt: Build the feature", "  mcp:",
    "    local:", "      command: local-tool", "superintendent:", "  agent: claude-code",
    "  prompt: Review", "owner:", "  agent: claude-code", "  prompt: Approve",
    "status:", "  state: in_progress", "  round: 0", "  review_turn: 0",
    "---", "## Task Board", "- [ ] Build the feature"
  ].join("\n");
  const fs = createFsFromVolume(Volume.fromJSON({
    "/repo/first.md": doc("codex:model"), "/repo/second.md": doc("goose")
  })).promises as unknown as SuperintendentFileSystem;
  return { cwd: "/repo", homeDir: "/home/test", fs };
}

const completed: SuperintendentRunResult = {
  state: "completed", round: 1, reviewTurn: 0, maxRounds: 100, maxReviewTurns: 5, stopReason: "completed"
};

describe("Superintendent live sequence", () => {
  it("runs queued messages with the selected builder and appends plans in order", async () => {
    const queue = createRunQueue({ plans: ["first.md"], cwd: "/repo" });
    const calls: string[] = [];
    const runAgent = vi.fn(async (input: AgentRunInput) => {
      calls.push(input.prompt.split("\n\n").at(-1)!);
      return { stdout: "Reviewed", stderr: "", exitCode: 0 };
    });
    const result = await runSuperintendentSequence({
      ...fixture(), queue, builderAgent: "codex:chosen-model", runAgent,
      runPlan: vi.fn(async (options) => {
        calls.push(options.docPath);
        if (calls.length === 1) {
          queue.enqueueMessage("Review API");
          queue.enqueueMessage("Check documentation");
          queue.enqueuePlan("second.md");
        }
        return completed;
      })
    });
    expect(calls).toEqual(["/repo/first.md", "Review API", "Check documentation", "/repo/second.md"]);
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
      agent: "codex:chosen-model", mode: "edit", cwd: "/repo/project", mcpServers: { local: { command: "local-tool" } }
    }));
    expect(result.status).toBe("completed");
    expect(result.messages).toHaveLength(2);
    expect(result.plans.map((plan) => plan.docPath)).toEqual(["/repo/first.md", "/repo/second.md"]);
  });

  it("applies repeated follow-ups to appended plans using each plan's builder", async () => {
    const queue = createRunQueue({ plans: ["first.md"], afterEachPlan: ["Review", "Verify"], cwd: "/repo" });
    const runAgent = vi.fn(async (_input: AgentRunInput) => ({ stdout: "", stderr: "", exitCode: 0 }));
    const runPlan = vi.fn(async () => {
      if (runPlan.mock.calls.length === 1) queue.enqueuePlan("second.md");
      return completed;
    });
    const result = await runSuperintendentSequence({ ...fixture(), queue, runAgent, runPlan });
    expect(result.messages.map((message) => message.text)).toEqual(["Review", "Verify", "Review", "Verify"]);
    expect(runAgent.mock.calls.map(([input]) => input.agent)).toEqual(["codex:model", "codex:model", "goose", "goose"]);
  });

  it.each(["paused", "stopped", "max_rounds", "aborted"] as const)("retains queued work after %s", async (stopReason) => {
    const runAgent = vi.fn();
    const result = await runSuperintendentSequence({
      ...fixture(), docs: ["first.md", "second.md"], afterEachPlan: ["Review"], runAgent,
      runPlan: async () => ({ ...completed, stopReason })
    });
    expect(result.status).toBe(stopReason === "aborted" ? "cancelled" : "paused");
    expect(runAgent).not.toHaveBeenCalled();
    expect(result.queue.items.slice(1).every((item) => item.status === "pending")).toBe(true);
  });

  it("stops after a failed follow-up without running later messages or plans", async () => {
    const result = await runSuperintendentSequence({
      ...fixture(), docs: ["first.md", "second.md"], afterEachPlan: ["Review", "Verify"],
      runPlan: async () => completed,
      runAgent: async () => ({ stdout: "", stderr: "Review failed", exitCode: 2 })
    });
    expect(result.status).toBe("failed");
    expect(result.messages).toHaveLength(1);
    expect(result.queue.items.map((item) => item.status)).toEqual(["completed", "failed", "pending", "pending", "pending", "pending"]);
  });

  it("does not launch work after cancellation", async () => {
    const controller = new AbortController();
    const runAgent = vi.fn();
    const result = await runSuperintendentSequence({
      ...fixture(), docs: ["first.md"], afterEachPlan: ["Review"], signal: controller.signal, runAgent,
      runPlan: async () => { controller.abort(); return completed; }
    });
    expect(result.status).toBe("cancelled");
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("keeps source plan paths inside the sequence worktree", async () => {
    const source = fixture();
    await source.fs.mkdir("/repo/worktree", { recursive: true });
    await source.fs.writeFile("/repo/worktree/first.md", await source.fs.readFile("/repo/first.md", "utf8"));
    const runPlan = vi.fn(async () => completed);
    await runSuperintendentSequence({
      ...source, cwd: "/repo/worktree", sourceCwd: "/repo", docs: ["/repo/first.md"],
      runPlan, runAgent: vi.fn()
    });
    expect(runPlan).toHaveBeenCalledWith(expect.objectContaining({ docPath: "/repo/worktree/first.md" }));
  });

  it("resolves host agent and log settings once per plan and retains them for follow-ups", async () => {
    const onPlanResolved = vi.fn();
    const preparePlan = vi.fn(async () => ({ builderAgent: "codex:configured", logDir: "/logs/run" }));
    const runAgent = vi.fn(async (_input: AgentRunInput) => ({ stdout: "", stderr: "", exitCode: 0 }));
    const result = await runSuperintendentSequence({
      ...fixture(), docs: ["first.md"], afterEachPlan: ["Review"],
      preparePlan, onPlanResolved, runPlan: async () => completed, runAgent
    });
    expect(preparePlan).toHaveBeenCalledTimes(1);
    expect(onPlanResolved).toHaveBeenCalledWith(expect.objectContaining({
      frontmatter: expect.objectContaining({ builder: expect.objectContaining({ agent: "codex:configured" }) })
    }));
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ agent: "codex:configured", logPath: expect.stringContaining("/logs/run/") }));
    expect(result.plans[0]?.builderAgent).toBe("codex:configured");
  });
});
