import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFsFromVolume, Volume } from "memfs";
import { createRunQueue } from "@poe-code/agent-harness-tools";
import type { AgentRunInput, PipelineFileSystem } from "@poe-code/pipeline";

const { autonomous, worktree } = vi.hoisted(() => ({ autonomous: vi.fn(), worktree: vi.fn() }));
vi.mock("./spawn.js", () => ({ spawn: { autonomous } }));
vi.mock("./worktree.js", () => ({ runWithOptionalWorktree: worktree }));
const { runPipelineSequence } = await import("./pipeline.js");

const plan = "---\nkind: pipeline\nversion: 1\nsetup: null\nteardown: null\ntasks:\n  - id: implement\n    title: Implement feature\n    prompt: Implement feature\n    status: open\n---\n";

function fixture(files = { "/repo/one.md": plan, "/repo/two.md": plan }) {
  const fs = createFsFromVolume(Volume.fromJSON(files)).promises as unknown as PipelineFileSystem;
  return { fs, agent: "codex", model: "chosen-model", cwd: "/repo", homeDir: "/home/test", archive: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  autonomous.mockResolvedValue({ exitCode: 0, stdout: "Done", stderr: "" });
  worktree.mockImplementation(async (input) => ({ value: await input.run({ worktreeCwd: "/worktree", sourceCwd: "/repo" }) }));
});

describe("SDK pipeline sequences", () => {
  it("uses the default SDK spawn for plans and repeated follow-ups", async () => {
    const result = await runPipelineSequence({ ...fixture(), plans: ["one.md", "two.md"], afterEachPlan: ["Review", "Verify"] });
    expect(result.status).toBe("completed");
    expect(result.plans).toHaveLength(2);
    expect(result.messages).toHaveLength(4);
    expect(autonomous).toHaveBeenCalledTimes(6);
    for (const [agent, input] of autonomous.mock.calls) {
      expect(agent).toBe("codex");
      expect(input).toMatchObject({ model: "chosen-model", cwd: "/repo", captureSession: false });
    }
  });

  it("initializes newly appended source documents before running them", async () => {
    const options = fixture({ "/repo/one.md": plan, "/repo/new.md": "# Build new feature" });
    const queue = createRunQueue({ plans: ["one.md"], cwd: "/repo" });
    const calls: AgentRunInput[] = [];
    const result = await runPipelineSequence({ ...options, queue, runAgent: async (input) => {
      calls.push(input);
      if (calls.length === 1) queue.enqueuePlan("new.md");
      if (input.prompt.includes("# Build new feature")) await options.fs.writeFile("/repo/new.md", plan);
      return { exitCode: 0, stdout: "Done", stderr: "" };
    } });
    expect(result.status).toBe("completed");
    expect(result.plans).toHaveLength(2);
    expect(calls).toHaveLength(3);
    expect(calls[1]?.prompt).toContain("# Build new feature");
  });

  it("keeps dynamically appended absolute plans and follow-ups in one worktree", async () => {
    const options = fixture({ "/worktree/one.md": plan, "/worktree/two.md": plan });
    const queue = createRunQueue({ plans: ["/repo/one.md"], afterEachPlan: ["Review"], cwd: "/repo" });
    const controller = new AbortController();
    const calls: AgentRunInput[] = [];
    const result = await runPipelineSequence({ ...options, worktree: true, queue, signal: controller.signal, runAgent: async (input) => {
      calls.push(input);
      if (calls.length === 1) queue.enqueuePlan("/repo/two.md");
      return { exitCode: 0, stdout: "Done", stderr: "" };
    } });
    expect(worktree).toHaveBeenCalledTimes(1);
    expect(worktree).toHaveBeenCalledWith(expect.objectContaining({ selectedAgent: "codex", selectedModel: "chosen-model", signal: controller.signal }));
    expect(result.plans.map((item) => item.planPath)).toEqual(["/worktree/one.md", "/worktree/two.md"]);
    expect(calls).toHaveLength(4);
    expect(calls.every((input) => input.cwd === "/worktree" && input.signal === controller.signal && input.model === "chosen-model")).toBe(true);
    expect(await options.fs.readFile("/worktree/two.md", "utf8")).toContain("status: done");
  });

  it("does not ask an injected plan runner to create another worktree", async () => {
    const runPlan = vi.fn(async (input) => {
      expect(input.worktree).not.toBe(true);
      return { stopReason: "completed" as const, planPath: input.plan, runsCompleted: 0, totalDurationMs: 0,
        metrics: { totalInputTokens: 0, totalOutputTokens: 0, totalCachedTokens: 0, tasksCompleted: 0, tasksFailed: 0, stepsCompleted: 0 } };
    });
    await runPipelineSequence({ ...fixture(), plans: ["one.md"], worktree: true, runPlan });
    expect(runPlan).toHaveBeenCalledTimes(1);
  });
});
