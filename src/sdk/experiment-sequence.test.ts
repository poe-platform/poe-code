import { createFsFromVolume, Volume } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRunQueue } from "@poe-code/agent-harness-tools";
import type { ExperimentFileSystem } from "@poe-code/experiment-loop";

const { autonomous, worktree } = vi.hoisted(() => ({ autonomous: vi.fn(), worktree: vi.fn() }));
vi.mock("./spawn.js", () => ({ spawn: { autonomous } }));
vi.mock("./worktree.js", () => ({ runWithOptionalWorktree: worktree }));
const { runExperimentSequence } = await import("./experiment.js");

const plan = "---\nkind: experiment\nagent: codex:model\nmetric:\n  name: checks\n  script: echo 1\n  direction: maximize\n---\nImprove checks";
beforeEach(() => {
  vi.clearAllMocks();
  autonomous.mockResolvedValue({ exitCode: 0, stdout: "Done", stderr: "" });
  worktree.mockImplementation(async (input) => ({ value: await input.run({ worktreeCwd: "/worktree", sourceCwd: "/repo" }) }));
});

describe("SDK experiment sequences", () => {
  it("runs queued messages through the SDK after each completed plan", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({ "/repo/one.md": plan, "/repo/two.md": plan })).promises as unknown as ExperimentFileSystem;
    const result = await runExperimentSequence({ fs, cwd: "/repo", homeDir: "/home/test", maxExperiments: 0, docs: ["one.md", "two.md"], afterEachPlan: ["Review", "Verify"] });
    expect(result.status).toBe("completed");
    expect(result.messages).toHaveLength(4);
    expect(autonomous).toHaveBeenCalledTimes(4);
    for (const [agent, input] of autonomous.mock.calls) {
      expect(agent).toBe("codex");
      expect(input).toMatchObject({ model: "model", cwd: "/repo", worktree: false });
    }
  });

  it("keeps absolute appended plans and queued messages in the sequence worktree", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({ "/worktree/one.md": plan, "/worktree/two.md": plan })).promises as unknown as ExperimentFileSystem;
    const queue = createRunQueue({ plans: ["/repo/one.md"], afterEachPlan: ["Review"], cwd: "/repo" });
    autonomous.mockImplementation(async () => {
      if (autonomous.mock.calls.length === 1) queue.enqueuePlan("/repo/two.md");
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const signal = new AbortController().signal;
    const result = await runExperimentSequence({ fs, cwd: "/repo", homeDir: "/home/test", agent: "codex:model", maxExperiments: 0, queue, worktree: true, signal });
    expect(result.plans.map((item) => item.docPath)).toEqual(["/worktree/one.md", "/worktree/two.md"]);
    expect(worktree).toHaveBeenCalledTimes(1);
    expect(autonomous).toHaveBeenCalledTimes(2);
    for (const [, input] of autonomous.mock.calls) expect(input).toMatchObject({ cwd: "/worktree", signal });
  });
});
