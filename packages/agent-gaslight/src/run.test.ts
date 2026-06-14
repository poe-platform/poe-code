import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runGaslight } from "./run.js";

describe("runGaslight", () => {
  it("starts with the plan path and chains the newest thread id", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({ "/repo/docs/plans/work.md": "# Work" })
    ).promises;
    const spawn = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "first", stderr: "", threadId: "one" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "second", stderr: "", threadId: "two" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "third", stderr: "", threadId: "three" });

    const result = await runGaslight({
      cwd: "/repo",
      planPath: "docs/plans/work.md",
      agent: "codex",
      prompt: "Implement",
      followups: ["Test it", "Check again"],
      fs,
      spawn
    });

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      "codex",
      expect.objectContaining({
        prompt: "Implement docs/plans/work.md",
        mode: "edit",
        cwd: "/repo"
      })
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      "codex",
      expect.objectContaining({ prompt: "Test it", resumeThreadId: "one" })
    );
    expect(spawn).toHaveBeenNthCalledWith(
      3,
      "codex",
      expect.objectContaining({ prompt: "Check again", resumeThreadId: "two" })
    );
    expect(result.rounds.map((round) => round.threadId)).toEqual(["one", "two", "three"]);
  });

  it("fails before round two when no thread id is returned", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({ "/repo/plan.md": "# Work" })).promises;
    const spawn = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "done", stderr: "" });

    await expect(
      runGaslight({
        cwd: "/repo",
        planPath: "plan.md",
        agent: "codex",
        prompt: "Implement",
        followups: ["Again"],
        fs,
        spawn
      })
    ).rejects.toThrow("agent returned no threadId; cannot resume the conversation");
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("reports the failed round and completed rounds", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({ "/repo/plan.md": "# Work" })).promises;
    const spawn = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "done", stderr: "", threadId: "one" })
      .mockResolvedValueOnce({ exitCode: 2, stdout: "", stderr: "broken", threadId: "two" });

    await expect(
      runGaslight({
        cwd: "/repo",
        planPath: "plan.md",
        agent: "codex",
        prompt: "Implement",
        followups: ["Again", "Last"],
        fs,
        spawn
      })
    ).rejects.toThrow(/round 2 failed after 1 completed round/);
  });

  it("sums usage across rounds", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({ "/repo/plan.md": "# Work" })).promises;
    const spawn = vi
      .fn()
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "one",
        stderr: "",
        threadId: "one",
        usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 3, costUsd: 0.1 }
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "two",
        stderr: "",
        threadId: "two",
        usage: { inputTokens: 5, outputTokens: 4, cachedTokens: 1, costUsd: 0.2 }
      });

    const result = await runGaslight({
      cwd: "/repo",
      planPath: "plan.md",
      agent: "codex",
      prompt: "Implement",
      followups: ["Again"],
      fs,
      spawn
    });

    expect(result.usage).toMatchObject({ inputTokens: 15, outputTokens: 6, cachedTokens: 4 });
    expect(result.usage?.costUsd).toBeCloseTo(0.3);
  });

  it("checks the plan before spawning", async () => {
    const spawn = vi.fn();

    await expect(
      runGaslight({
        cwd: "/repo",
        planPath: "missing.md",
        agent: "codex",
        prompt: "Implement",
        followups: ["Again"],
        fs: createFsFromVolume(new Volume()).promises,
        spawn
      })
    ).rejects.toThrow(/Plan file not found/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("uses an explicit config path when provided", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/plan.md": "# Work",
        "/repo/.poe-code/codex-gaslight.yaml": "prompt: Review\nfollowups:\n  - Inspect output\n"
      })
    ).promises;
    const spawn = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "one", stderr: "", threadId: "one" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "two", stderr: "", threadId: "two" });

    await runGaslight({
      cwd: "/repo",
      planPath: "plan.md",
      agent: "codex",
      configPath: ".poe-code/codex-gaslight.yaml",
      fs,
      spawn
    });

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      "codex",
      expect.objectContaining({ prompt: "Review plan.md" })
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      "codex",
      expect.objectContaining({ prompt: "Inspect output" })
    );
  });
});
