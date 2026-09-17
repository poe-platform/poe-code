import { createFsFromVolume, Volume } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRunQueue } from "@poe-code/agent-harness-tools";
import type { RalphFileSystem } from "@poe-code/ralph";

const { autonomous, worktree } = vi.hoisted(() => ({ autonomous: vi.fn(), worktree: vi.fn() }));
vi.mock("./spawn.js", () => ({ spawn: { autonomous } }));
vi.mock("./worktree.js", () => ({ runWithOptionalWorktree: worktree }));
const { runRalphSequence } = await import("./ralph.js");

const plan = "---\nkind: ralph\nagent: codex:model\niterations: 1\n---\nImplement the plan";
beforeEach(() => {
  vi.clearAllMocks();
  autonomous.mockResolvedValue({ exitCode: 0, stdout: "Done", stderr: "" });
  worktree.mockImplementation(async (input) => ({ value: await input.run({ worktreeCwd: "/worktree", sourceCwd: "/repo" }) }));
});

describe("SDK Ralph sequences", () => {
  it("uses the SDK spawn for plans and repeated follow-ups", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({ "/repo/one.md": plan, "/repo/two.md": plan })).promises as unknown as RalphFileSystem;
    const result = await runRalphSequence({ fs, cwd: "/repo", homeDir: "/home/test", archive: false, docs: ["one.md", "two.md"], afterEachPlan: ["Review", "Verify"] });
    expect(result.status).toBe("completed");
    expect(result.messages).toHaveLength(4);
    expect(autonomous).toHaveBeenCalledTimes(6);
    for (const [agent, input] of autonomous.mock.calls) {
      expect(agent).toBe("codex");
      expect(input).toMatchObject({ model: "model", cwd: "/repo" });
    }
  });

  it("keeps dynamically added absolute plan paths and messages in one worktree", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({ "/worktree/one.md": plan, "/worktree/two.md": plan })).promises as unknown as RalphFileSystem;
    const queue = createRunQueue({ plans: ["/repo/one.md"], afterEachPlan: ["Review"], cwd: "/repo" });
    autonomous.mockImplementation(async () => {
      if (autonomous.mock.calls.length === 1) queue.enqueuePlan("/repo/two.md");
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const signal = new AbortController().signal;
    const result = await runRalphSequence({ fs, cwd: "/repo", homeDir: "/home/test", agent: "codex:model", archive: false, queue, worktree: true, signal });
    expect(result.plans.map((item) => item.docPath)).toEqual(["/worktree/one.md", "/worktree/two.md"]);
    expect(worktree).toHaveBeenCalledTimes(1);
    expect(autonomous).toHaveBeenCalledTimes(4);
    for (const [, input] of autonomous.mock.calls) expect(input).toMatchObject({ cwd: "/worktree", signal });
  });
});
