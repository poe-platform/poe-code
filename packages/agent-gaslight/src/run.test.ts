import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runGaslight } from "./run.js";

describe("runGaslight", () => {
  it("interpolates config vars and file includes in every configured prompt", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/plan.md": "# Plan",
        "/repo/context.md": "Important context",
        "/repo/.poe-code/gaslight.yaml": [
          "agent: codex",
          "vars:",
          "  context: '{{file \"context.md\"}}'",
          "setup: Prepare {{context}}",
          "prompt: Implement with {{context}}",
          "followups:",
          "  - Recheck {{context}}",
          "teardown: Finish {{context}}",
          ""
        ].join("\n")
      })
    ).promises;
    const spawn = vi
      .fn()
      .mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "", threadId: "thread" });

    await runGaslight({ planPaths: ["plan.md"], cwd: "/repo", homeDir: "/home", fs, spawn });

    expect(spawn.mock.calls.map(([, options]) => options.prompt)).toEqual([
      "Prepare Important context",
      "Implement with Important context plan.md",
      "Recheck Important context",
      "Finish Important context"
    ]);
    expect(spawn.mock.calls.map(([agent]) => agent)).toEqual(["codex", "codex", "codex", "codex"]);
  });

  it("rejects missing prompt variables before spawning", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/plan.md": "# Plan",
        "/repo/.poe-code/gaslight.yaml":
          "agent: codex\nprompt: Implement {{missing}}\nfollowups:\n  - Test it\n"
      })
    ).promises;
    const spawn = vi.fn();

    await expect(
      runGaslight({ planPaths: ["plan.md"], cwd: "/repo", homeDir: "/home", fs, spawn })
    ).rejects.toThrow('Missing gaslight variable "missing"');
    expect(spawn).not.toHaveBeenCalled();
  });
  it("runs setup before the plan and teardown after its follow-ups in the same conversation", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({ "/repo/docs/plans/work.md": "# Work" })
    ).promises;
    const spawn = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "setup", stderr: "", threadId: "one" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "main", stderr: "", threadId: "two" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "followup", stderr: "", threadId: "three" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "teardown", stderr: "", threadId: "four" });

    await runGaslight({
      cwd: "/repo",
      planPaths: ["docs/plans/work.md"],
      agent: "codex",
      setup: "Prepare workspace",
      prompt: "Implement",
      followups: ["Test it"],
      teardown: "Clean up workspace",
      fs,
      spawn
    });

    expect(spawn.mock.calls.map(([, options]) => options.prompt)).toEqual([
      "Prepare workspace",
      "Implement docs/plans/work.md",
      "Test it",
      "Clean up workspace"
    ]);
    expect(spawn.mock.calls.map(([, options]) => options.resumeThreadId)).toEqual([
      undefined,
      "one",
      "two",
      "three"
    ]);
  });

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
      planPaths: ["docs/plans/work.md"],
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
        cwd: "/repo"
      })
    );
    expect(spawn.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ mode: "auto" }));
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

  it("accepts home-relative plan paths", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({ "/home/test/.poe-code/docs/plans/work.md": "# Work" })
    ).promises;
    const spawn = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "first", stderr: "", threadId: "one" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "second", stderr: "", threadId: "two" });

    await runGaslight({
      cwd: "/repo",
      homeDir: "/home/test",
      planPaths: ["~/.poe-code/docs/plans/work.md"],
      agent: "codex",
      prompt: "Implement",
      followups: ["Test it"],
      fs,
      spawn
    });

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      "codex",
      expect.objectContaining({ prompt: "Implement ~/.poe-code/docs/plans/work.md" })
    );
  });

  it("passes an explicit spawn mode through", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({ "/repo/docs/plans/work.md": "# Work" })
    ).promises;
    const spawn = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "first", stderr: "", threadId: "one" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "second", stderr: "", threadId: "two" });

    await runGaslight({
      cwd: "/repo",
      planPaths: ["docs/plans/work.md"],
      agent: "codex",
      mode: "edit",
      prompt: "Implement",
      followups: ["Test it"],
      fs,
      spawn
    });

    expect(spawn.mock.calls.map(([, options]) => options.mode)).toEqual(["edit", "edit"]);
  });

  it("runs multiple plans sequentially with a fresh thread per plan", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/docs/plans/first.md": "# First",
        "/repo/docs/plans/second.md": "# Second"
      })
    ).promises;
    const spawn = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "first start", stderr: "", threadId: "one" })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "first followup",
        stderr: "",
        threadId: "two"
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "second start",
        stderr: "",
        threadId: "three"
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "second followup",
        stderr: "",
        threadId: "four"
      });

    const result = await runGaslight({
      cwd: "/repo",
      planPaths: ["docs/plans/first.md", "docs/plans/second.md"],
      agent: "codex",
      prompt: "Implement",
      followups: ["Check again"],
      fs,
      spawn
    });

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      "codex",
      expect.not.objectContaining({ resumeThreadId: expect.any(String) })
    );
    expect(spawn).toHaveBeenNthCalledWith(
      1,
      "codex",
      expect.objectContaining({ prompt: "Implement docs/plans/first.md" })
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      "codex",
      expect.objectContaining({ prompt: "Check again", resumeThreadId: "one" })
    );
    expect(spawn).toHaveBeenNthCalledWith(
      3,
      "codex",
      expect.not.objectContaining({ resumeThreadId: expect.any(String) })
    );
    expect(spawn).toHaveBeenNthCalledWith(
      3,
      "codex",
      expect.objectContaining({ prompt: "Implement docs/plans/second.md" })
    );
    expect(spawn).toHaveBeenNthCalledWith(
      4,
      "codex",
      expect.objectContaining({ prompt: "Check again", resumeThreadId: "three" })
    );
    expect(result.plans.map((plan) => plan.planPath)).toEqual([
      "docs/plans/first.md",
      "docs/plans/second.md"
    ]);
    expect(result.rounds.map((round) => round.threadId)).toEqual(["one", "two", "three", "four"]);
  });

  it("records the total duration and duration of each plan", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/docs/plans/first.md": "# First",
        "/repo/docs/plans/second.md": "# Second"
      })
    ).promises;
    const spawn = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: "done",
      stderr: "",
      threadId: "thread"
    });
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_100)
      .mockReturnValueOnce(2_100)
      .mockReturnValueOnce(2_200)
      .mockReturnValueOnce(4_200)
      .mockReturnValueOnce(4_300);

    const result = await runGaslight({
      cwd: "/repo",
      planPaths: ["docs/plans/first.md", "docs/plans/second.md"],
      agent: "codex",
      prompt: "Implement",
      followups: ["Review"],
      fs,
      spawn
    });

    expect(result.durationMs).toBe(3_300);
    expect(result.plans.map((plan) => plan.durationMs)).toEqual([1_000, 2_000]);
    now.mockRestore();
  });

  it("leaves each plan in place after its gaslight rounds succeed", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/docs/plans/first.md": "# First",
        "/repo/docs/plans/second.md": "# Second"
      })
    ).promises;
    const spawn = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "first start", stderr: "", threadId: "one" })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "first followup",
        stderr: "",
        threadId: "two"
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "second start",
        stderr: "",
        threadId: "three"
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "second followup",
        stderr: "",
        threadId: "four"
      });

    const result = await runGaslight({
      cwd: "/repo",
      planPaths: ["docs/plans/first.md", "docs/plans/second.md"],
      agent: "codex",
      prompt: "Implement",
      followups: ["Check again"],
      fs,
      spawn
    });

    await expect(fs.readFile("/repo/docs/plans/first.md", "utf8")).resolves.toBe("# First");
    await expect(fs.readFile("/repo/docs/plans/second.md", "utf8")).resolves.toBe("# Second");
    await expect(fs.readFile("/repo/docs/plans/archive/first.md", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(fs.readFile("/repo/docs/plans/archive/second.md", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(result.plans.map((plan) => plan.archivedPath)).toEqual([undefined, undefined]);
  });

  it("archives each plan after successful gaslight rounds when enabled", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/docs/plans/01-first.md": "# First",
        "/repo/docs/plans/02-second.md": "# Second"
      })
    ).promises;
    const spawn = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "first start", stderr: "", threadId: "one" })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "first followup",
        stderr: "",
        threadId: "two"
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "second start",
        stderr: "",
        threadId: "three"
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "second followup",
        stderr: "",
        threadId: "four"
      });

    const result = await runGaslight({
      cwd: "/repo",
      planPaths: ["docs/plans/01-first.md", "docs/plans/02-second.md"],
      agent: "codex",
      prompt: "Implement",
      followups: ["Check again"],
      archive: true,
      fs,
      spawn
    });

    await expect(fs.readFile("/repo/docs/plans/01-first.md", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(fs.readFile("/repo/docs/plans/02-second.md", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(fs.readFile("/repo/docs/plans/archive/first.md", "utf8")).resolves.toContain(
      "# First"
    );
    await expect(fs.readFile("/repo/docs/plans/archive/second.md", "utf8")).resolves.toContain(
      "# Second"
    );
    expect(result.plans.map((plan) => plan.archivedPath)).toEqual([
      "docs/plans/archive/first.md",
      "docs/plans/archive/second.md"
    ]);
  });

  it("does not archive a plan that is already in the archive directory", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/docs/plans/archive/work.md": "---\nstate: archived\n---\n# Work"
      })
    ).promises;
    const spawn = vi
      .fn()
      .mockResolvedValue({ exitCode: 0, stdout: "finished", stderr: "", threadId: "one" });

    const result = await runGaslight({
      cwd: "/repo",
      planPaths: ["docs/plans/archive/work.md"],
      agent: "codex",
      prompt: "Implement",
      followups: ["Check again"],
      archive: true,
      fs,
      spawn
    });

    await expect(fs.readFile("/repo/docs/plans/archive/work.md", "utf8")).resolves.toContain(
      "# Work"
    );
    await expect(
      fs.readFile("/repo/docs/plans/archive/archive/work.md", "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.plans[0]?.archivedPath).toBe("docs/plans/archive/work.md");
  });

  it("leaves the active plan in place when a later round fails", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({ "/repo/plan.md": "# Work" })).promises;
    const spawn = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "done", stderr: "", threadId: "one" })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "broken" });

    await expect(
      runGaslight({
        cwd: "/repo",
        planPaths: ["plan.md"],
        agent: "codex",
        prompt: "Implement",
        followups: ["Again"],
        fs,
        spawn
      })
    ).rejects.toThrow("Gaslight round 2 failed after 1 completed round");

    await expect(fs.readFile("/repo/plan.md", "utf8")).resolves.toBe("# Work");
    await expect(fs.readFile("/repo/archive/plan.md", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("fails before round two when no thread id is returned", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({ "/repo/plan.md": "# Work" })).promises;
    const spawn = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "done", stderr: "" });

    await expect(
      runGaslight({
        cwd: "/repo",
        planPaths: ["plan.md"],
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
        planPaths: ["plan.md"],
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
      planPaths: ["plan.md"],
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
        planPaths: ["missing.md"],
        agent: "codex",
        prompt: "Implement",
        followups: ["Again"],
        fs: createFsFromVolume(new Volume()).promises,
        spawn
      })
    ).rejects.toThrow(/Plan file not found/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("reports a missing plan as a user error", async () => {
    const spawn = vi.fn();

    const error = await runGaslight({
      cwd: "/repo",
      planPaths: ["missing.md"],
      agent: "codex",
      prompt: "Implement",
      followups: ["Again"],
      fs: createFsFromVolume(new Volume()).promises,
      spawn
    }).catch((thrown: unknown) => thrown as Error);

    expect(error.name).toBe("UserError");
    expect(error.message).toContain("Plan file not found: missing.md");
  });

  it("rejects a whitespace-only agent before spawning", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({ "/repo/plan.md": "# Work" })).promises;
    const spawn = vi.fn();

    await expect(
      runGaslight({
        cwd: "/repo",
        planPaths: ["plan.md"],
        agent: "   ",
        prompt: "Implement",
        followups: ["Again"],
        fs,
        spawn
      })
    ).rejects.toThrow("agent must be a non-empty string.");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only model before spawning", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({ "/repo/plan.md": "# Work" })).promises;
    const spawn = vi.fn();

    await expect(
      runGaslight({
        cwd: "/repo",
        planPaths: ["plan.md"],
        agent: "codex",
        model: "   ",
        prompt: "Implement",
        followups: ["Again"],
        fs,
        spawn
      })
    ).rejects.toThrow("model must be a non-empty string when provided.");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects duplicate plan paths before spawning", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({ "/repo/docs/plans/work.md": "# Work" })
    ).promises;
    const spawn = vi.fn();

    await expect(
      runGaslight({
        cwd: "/repo",
        planPaths: ["docs/plans/work.md", " docs/plans/work.md "],
        agent: "codex",
        prompt: "Implement",
        followups: ["Again"],
        fs,
        spawn
      })
    ).rejects.toThrow("Duplicate plan path: docs/plans/work.md");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("allows an existing archive destination because gaslight does not write it", async () => {
    const fs = createFsFromVolume(
      Volume.fromJSON({
        "/repo/docs/plans/work.md": "# Work",
        "/repo/docs/plans/archive/work.md": "# Old archive"
      })
    ).promises;
    const spawn = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "first", stderr: "", threadId: "one" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "second", stderr: "", threadId: "two" });

    await runGaslight({
      cwd: "/repo",
      planPaths: ["docs/plans/work.md"],
      agent: "codex",
      prompt: "Implement",
      followups: ["Again"],
      fs,
      spawn
    });

    expect(spawn).toHaveBeenCalledTimes(2);
    await expect(fs.readFile("/repo/docs/plans/work.md", "utf8")).resolves.toBe("# Work");
    await expect(fs.readFile("/repo/docs/plans/archive/work.md", "utf8")).resolves.toBe(
      "# Old archive"
    );
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
      planPaths: ["plan.md"],
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
