import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { createRunQueue } from "@poe-code/agent-harness-tools";
import { runRalphSequence } from "./sequence.js";
import type { AgentRunInput, RalphFileSystem } from "../types.js";

function fixture() {
  const fs = createFsFromVolume(Volume.fromJSON({
    "/repo/first.md": "---\nkind: ralph\nagent: codex:test-model\niterations: 1\nskills: [review]\nhooks:\n  from: claude-code\n---\nFirst plan",
    "/repo/second.md": "---\nkind: ralph\nagent: goose\niterations: 1\n---\nSecond plan"
  })).promises as unknown as RalphFileSystem;
  return { fs, cwd: "/repo", homeDir: "/home/test", archive: false };
}

describe("Ralph live sequence", () => {
  it("runs live messages after their plan, then appended plans, preserving the last agent settings", async () => {
    const queue = createRunQueue({ plans: ["first.md"] });
    const calls: AgentRunInput[] = [];
    const runAgent = vi.fn(async (input: AgentRunInput) => {
      calls.push(input);
      if (calls.length === 1) {
        queue.enqueueMessage("Review the API");
        queue.enqueueMessage("Verify documentation");
        queue.enqueuePlan("second.md");
      }
      return { stdout: "Done", stderr: "", exitCode: 0 };
    });
    const result = await runRalphSequence({ ...fixture(), queue, runAgent });
    expect(result.status).toBe("completed");
    expect(calls.map((input) => input.agent)).toEqual(["codex", "codex", "codex", "goose"]);
    expect(calls[1]).toMatchObject({ model: "test-model", skills: ["review"], hooks: { from: "claude-code" }, cwd: "/repo" });
    expect(calls[1]?.prompt).toContain("Review the API");
    expect(calls[2]?.prompt).toContain("Verify documentation");
    expect(calls[1]?.logFileName).not.toBe(calls[0]?.logFileName);
    expect(result.plans).toHaveLength(2);
    expect(result.messages).toHaveLength(2);
  });

  it("runs repeatable messages after every plan, including plans added while running", async () => {
    const queue = createRunQueue({ plans: ["first.md"], afterEachPlan: ["Review", "Verify"] });
    const runAgent = vi.fn(async () => {
      if (runAgent.mock.calls.length === 1) queue.enqueuePlan("second.md");
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const result = await runRalphSequence({ ...fixture(), queue, runAgent });
    expect(runAgent).toHaveBeenCalledTimes(6);
    expect(result.messages.map((message) => message.text)).toEqual(["Review", "Verify", "Review", "Verify"]);
  });

  it("gives follow-ups the archived plan path while preserving the original result identity", async () => {
    const config = fixture();
    const runAgent = vi.fn(async (input: AgentRunInput) => {
      if (input.prompt.startsWith("Follow-up after")) {
        expect(input.prompt).toContain("Follow-up after completing /repo/archive/first.md:");
        await expect(config.fs.readFile("/repo/archive/first.md", "utf8")).resolves.toContain("First plan");
      }
      return { stdout: "Done", stderr: "", exitCode: 0 };
    });
    const result = await runRalphSequence({ ...config, archive: true, docs: ["first.md"], afterEachPlan: ["Review the plan"], runAgent });
    expect(result.plans[0]).toMatchObject({ docPath: "first.md", archivedPath: "/repo/archive/first.md" });
    expect(result.messages[0]?.planPath).toBe("first.md");
    expect(runAgent).toHaveBeenCalledTimes(2);
  });

  it("retains pending work after a failed message", async () => {
    const result = await runRalphSequence({
      ...fixture(), docs: ["first.md", "second.md"], afterEachPlan: ["Review", "Verify"],
      runAgent: vi.fn().mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
        .mockResolvedValueOnce({ stdout: "", stderr: "failed", exitCode: 1 })
    });
    expect(result.status).toBe("failed");
    expect(result.plans).toHaveLength(1);
    expect(result.queue.items.map((item) => item.status)).toEqual(["completed", "failed", "pending", "pending", "pending", "pending"]);
  });

  it("does not start queued messages when cancelled during the plan", async () => {
    const controller = new AbortController();
    const runAgent = vi.fn(async () => {
      controller.abort();
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const result = await runRalphSequence({ ...fixture(), docs: ["first.md"], afterEachPlan: ["Review"], signal: controller.signal, runAgent });
    expect(result.status).toBe("cancelled");
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(result.queue.items[1]?.status).toBe("pending");
  });
});
