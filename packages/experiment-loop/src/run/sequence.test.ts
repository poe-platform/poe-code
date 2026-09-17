import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { createRunQueue } from "@poe-code/agent-harness-tools";
import { runExperimentSequence } from "./sequence.js";
import { runExperimentLoop } from "./loop.js";
import type { AgentRunInput, ExperimentFileSystem } from "../types.js";

function fixture() {
  const doc = "---\nkind: experiment\nagent: codex:test-model\nmetric:\n  name: checks\n  script: echo 1\n  direction: maximize\nbaseline:\n  checks: 1\n---\nImprove checks";
  const fs = createFsFromVolume(Volume.fromJSON({ "/repo/first.md": doc, "/repo/second.md": doc })).promises as unknown as ExperimentFileSystem;
  return { fs, cwd: "/repo", homeDir: "/home/test", maxExperiments: 1,
    git: { currentHash: vi.fn(async () => "commit"), reset: vi.fn(async () => {}) },
    exec: vi.fn(async () => ({ stdout: "1", stderr: "", exitCode: 0 })) };
}

describe("experiment live sequence", () => {
  it("keeps earlier plan journals outside later plans' clean-tree and reset scope", async () => {
    const options = fixture();
    const scopes: string[] = [];
    const result = await runExperimentSequence({
      ...options, git: undefined, docs: ["first.md", "second.md"],
      exec: async (command) => {
        if (command.startsWith("git status")) {
          scopes.push(command);
          const earlierJournalExists = await options.fs.readFile("/repo/first.journal.jsonl", "utf8").then(() => true, () => false);
          return { stdout: earlierJournalExists && !command.includes("exclude,literal)first.journal.jsonl") ? "?? first.journal.jsonl" : "", stderr: "", exitCode: 0 };
        }
        return { stdout: command.includes("--short HEAD") ? "commit" : "", stderr: "", exitCode: 0 };
      },
      runAgent: async () => ({ stdout: "", stderr: "", exitCode: 0 })
    });
    expect(result.status).toBe("completed");
    expect(scopes).toHaveLength(2);
    expect(scopes[1]).toContain("exclude,literal)first.journal.jsonl");
    expect(scopes[1]).toContain("exclude,literal)second.journal.jsonl");
  });

  it("reports iterations discarded without a journal result so the view does not leave them running", async () => {
    const onExperimentDiscarded = vi.fn();
    await runExperimentLoop({ ...fixture(), docPath: "first.md", runAgent: async () => ({ stdout: "", stderr: "", exitCode: 0 }), onExperimentDiscarded });
    expect(onExperimentDiscarded).toHaveBeenCalledWith(1, "No journal result");
  });

  it("reports resolved plan context even when its experiment budget is already complete", async () => {
    const onPlanResolved = vi.fn();
    await runExperimentLoop({ ...fixture(), docPath: "first.md", maxExperiments: 0, runAgent: vi.fn(), onPlanResolved });
    expect(onPlanResolved).toHaveBeenCalledWith(expect.objectContaining({ agent: "codex", model: "test-model", maxExperiments: 0, experimentsCompleted: 0, docPath: "first.md" }));
  });

  it("runs messages after the selected experiment plan and then dynamically appended plans", async () => {
    const queue = createRunQueue({ plans: ["first.md"] });
    const calls: AgentRunInput[] = [];
    const result = await runExperimentSequence({ ...fixture(), queue, runtime: "docker", runAgent: async (input) => {
      calls.push(input);
      if (calls.length === 1) {
        queue.enqueueMessage("Review the winning changes");
        queue.enqueueMessage("Summarize the results");
        queue.enqueuePlan("second.md");
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    } });
    expect(result.status).toBe("completed");
    expect(calls).toHaveLength(4);
    expect(calls[1]).toMatchObject({ agent: "codex", model: "test-model", runtime: "docker", cwd: "/repo" });
    expect(calls[1]?.prompt).toContain("Review the winning changes");
    expect(calls[2]?.prompt).toContain("Summarize the results");
    expect(result.plans).toHaveLength(2);
  });

  it("runs follow-ups with the resolved agent when no experiments remain", async () => {
    const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const result = await runExperimentSequence({ ...fixture(), docs: ["first.md"], maxExperiments: 0, afterEachPlan: ["Review"], runAgent });
    expect(result.status).toBe("completed");
    expect(runAgent).toHaveBeenCalledOnce();
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ agent: "codex", model: "test-model", prompt: expect.stringContaining("Review") }));
  });

  it("stops on a failed follow-up and retains pending plans and messages", async () => {
    const result = await runExperimentSequence({ ...fixture(), docs: ["first.md", "second.md"], afterEachPlan: ["Review"],
      runAgent: vi.fn().mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }).mockResolvedValueOnce({ stdout: "", stderr: "failed", exitCode: 1 })
    });
    expect(result.status).toBe("failed");
    expect(result.queue.items.map((item) => item.status)).toEqual(["completed", "failed", "pending", "pending"]);
  });
});
