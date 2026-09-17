import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { createRunQueue } from "@poe-code/agent-harness-tools";
import { runPipelineSequence } from "./sequence.js";
import type { AgentRunInput, PipelineFileSystem } from "../types.js";

const content = "---\nkind: pipeline\nversion: 1\nsetup: null\nteardown: null\ntasks:\n  - id: task\n    title: Implement plan\n    prompt: Implement this plan\n    status: open\n---\n";

function options() {
  const fs = createFsFromVolume(Volume.fromJSON({
    "/repo/first.md": content, "/repo/second.md": content, "/repo/third.md": content
  })).promises;
  return { cwd: "/repo", homeDir: "/home/test", agent: "codex", model: "selected-model", archive: false,
    fs: fs as unknown as PipelineFileSystem };
}

describe("pipeline sequences with live follow-ups", () => {
  it("executes queued messages through the same agent and model before advancing plans", async () => {
    const queue = createRunQueue({ plans: ["first.md", "second.md"], cwd: "/repo" });
    queue.enqueueMessage("Review first plan");
    queue.enqueueMessage("Verify first plan");
    const calls: AgentRunInput[] = [];
    const result = await runPipelineSequence({
      ...options(), queue,
      runAgent: async (input) => {
        calls.push(input);
        if (calls.length === 1) queue.enqueuePlan("third.md");
        return { stdout: "Done", stderr: "", exitCode: 0 };
      }
    });
    expect(result.status).toBe("completed");
    expect(result.plans.map((plan) => plan.planPath)).toEqual(["first.md", "second.md", "third.md"]);
    expect(calls.map((call) => call.prompt)).toEqual([
      expect.stringContaining("Implement this plan"),
      expect.stringContaining("Review first plan"),
      expect.stringContaining("Verify first plan"),
      expect.stringContaining("Implement this plan"),
      expect.stringContaining("Implement this plan")
    ]);
    expect(calls.every((call) => call.agent === "codex" && call.model === "selected-model" && call.cwd === "/repo")).toBe(true);
    expect(result.messages).toHaveLength(2);
  });

  it("applies afterEachPlan messages and reports all sequence changes to SDK observers", async () => {
    const onQueueChange = vi.fn();
    const result = await runPipelineSequence({
      ...options(), plans: ["first.md", "second.md"], afterEachPlan: ["Review"], onQueueChange,
      runAgent: async () => ({ stdout: "Done", stderr: "", exitCode: 0 })
    });
    expect(result.messages.map((message) => message.planPath)).toEqual(["first.md", "second.md"]);
    expect(onQueueChange.mock.calls[0]?.[0].status).toBe("idle");
    expect(onQueueChange.mock.calls.at(-1)?.[0].status).toBe("completed");
  });

  it.each([false, true])("retains the plan MCP and log context for follow-ups when already complete=%s", async (alreadyComplete) => {
    const config = options();
    const configured = content.replace("tasks:", "mcp:\n  documents:\n    command: document-tools\ntasks:");
    await config.fs.writeFile("/repo/first.md", alreadyComplete ? configured.replace("status: open", "status: done") : configured);
    const calls: AgentRunInput[] = [];
    const onPlanProgress = vi.fn();
    await runPipelineSequence({
      ...config, archive: !alreadyComplete, plans: ["first.md", "second.md"], afterEachPlan: ["Review"], onPlanProgress,
      runAgent: async (input) => { calls.push(input); return { stdout: "Done", stderr: "", exitCode: 0 }; }
    });
    const messages = calls.filter((input) => input.prompt.startsWith("Follow-up after"));
    expect(messages[0]).toMatchObject({
      agent: "codex", model: "selected-model", mcpServers: { documents: { command: "document-tools" } },
      logDir: expect.any(String), logFileName: expect.stringContaining("follow-up")
    });
    expect(messages[1]?.mcpServers).toBeUndefined();
    expect(messages[1]?.logDir).toBeDefined();
    expect(messages[1]?.logDir).not.toBe(messages[0]?.logDir);
    expect(onPlanProgress).toHaveBeenCalled();
  });

  it("retains pending messages and plans when the current plan fails or reaches max runs", async () => {
    for (const maxRuns of [undefined, 0]) {
      const runAgent = vi.fn(async () => ({ stdout: "", stderr: "Failed", exitCode: 1 }));
      const result = await runPipelineSequence({
        ...options(), plans: ["first.md", "second.md"], afterEachPlan: ["Review"], maxRuns, runAgent
      });
      expect(result.status).toBe(maxRuns === 0 ? "paused" : "failed");
      expect(result.plans).toHaveLength(1);
      expect(result.messages).toEqual([]);
      expect(result.queue.items.slice(1).every((item) => item.status === "pending")).toBe(true);
    }
  });

  it("stops after a failed follow-up and propagates the abort signal to it", async () => {
    const abort = new AbortController();
    let runs = 0;
    const result = await runPipelineSequence({
      ...options(), plans: ["first.md", "second.md"], afterEachPlan: ["Review"], signal: abort.signal,
      runAgent: async (input) => {
        expect(input.signal).toBe(abort.signal);
        return { stdout: "", stderr: "", exitCode: ++runs === 2 ? 1 : 0 };
      }
    });
    expect(result.status).toBe("failed");
    expect(result.plans).toHaveLength(1);
    expect(result.messages[0]?.result.exitCode).toBe(1);
  });
});
