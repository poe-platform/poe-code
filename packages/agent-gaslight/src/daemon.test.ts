import { Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runGaslightDaemon } from "./daemon.js";

function plan(kind: string, readiness: string, title: string): string {
  return `---\nkind: ${kind}\nreadiness: ${readiness}\n---\n# ${title}\n`;
}

describe("runGaslightDaemon", () => {
  it("runs newest ready regular plans first and excludes drafts and pipeline plans", async () => {
    const volume = Volume.fromJSON({
      "/repo/docs/plans/01-first.md": plan("plan", "ready", "First"),
      "/repo/docs/plans/02-draft.md": plan("plan", "draft", "Draft"),
      "/repo/docs/plans/03-pipeline.md": plan("pipeline", "ready", "Pipeline"),
      "/repo/docs/plans/04-second.md": plan("plan", "ready", "Second")
    });
    volume.utimesSync("/repo/docs/plans/01-first.md", new Date(2_000), new Date(2_000));
    volume.utimesSync("/repo/docs/plans/04-second.md", new Date(1_000), new Date(1_000));
    const run = vi.fn().mockResolvedValue({ rounds: [], plans: [] });
    const controller = new AbortController();

    const result = await runGaslightDaemon({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "docs/plans",
      agent: "codex",
      fs: volume.promises as never,
      run,
      signal: controller.signal,
      wait: async () => controller.abort()
    });

    expect(run.mock.calls.map(([options]) => options.planPaths)).toEqual([
      ["docs/plans/01-first.md"],
      ["docs/plans/04-second.md"]
    ]);
    expect(run.mock.calls.every(([options]) => options.archive === true)).toBe(true);
    expect(result.completedPlans).toBe(2);
  });

  it("polls again after an empty scan and processes a newly ready plan", async () => {
    const volume = Volume.fromJSON({ "/repo/docs/plans/.keep": "" });
    const run = vi.fn().mockResolvedValue({ rounds: [], plans: [] });
    const controller = new AbortController();
    let waits = 0;

    await runGaslightDaemon({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "docs/plans",
      agent: "codex",
      fs: volume.promises as never,
      run,
      signal: controller.signal,
      wait: async () => {
        waits += 1;
        if (waits === 1) {
          await volume.promises.writeFile(
            "/repo/docs/plans/new.md",
            plan("plan", "ready", "New")
          );
        } else {
          controller.abort();
        }
      }
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ planPaths: ["docs/plans/new.md"] }));
  });

  it("reports scans and completed plans", async () => {
    const volume = Volume.fromJSON({
      "/repo/docs/plans/work.md": plan("plan", "ready", "Work")
    });
    const controller = new AbortController();
    const onEvent = vi.fn();

    await runGaslightDaemon({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "docs/plans",
      agent: "codex",
      fs: volume.promises as never,
      run: vi.fn().mockResolvedValue({ rounds: [], plans: [] }),
      signal: controller.signal,
      wait: async () => controller.abort(),
      onEvent
    });

    expect(onEvent).toHaveBeenCalledWith({ type: "scan.finished", readyPlans: 1 });
    expect(onEvent).toHaveBeenCalledWith({
      type: "plan.finished",
      planPath: "docs/plans/work.md"
    });
  });

  it("keeps running when one plan fails", async () => {
    const volume = Volume.fromJSON({
      "/repo/docs/plans/first.md": plan("plan", "ready", "First"),
      "/repo/docs/plans/second.md": plan("plan", "ready", "Second")
    });
    volume.utimesSync("/repo/docs/plans/first.md", new Date(2_000), new Date(2_000));
    volume.utimesSync("/repo/docs/plans/second.md", new Date(1_000), new Date(1_000));
    const controller = new AbortController();
    const onEvent = vi.fn();
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("agent failed"))
      .mockResolvedValueOnce({ rounds: [], plans: [] });

    const result = await runGaslightDaemon({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "docs/plans",
      agent: "codex",
      fs: volume.promises as never,
      run,
      signal: controller.signal,
      wait: async () => controller.abort(),
      onEvent
    });

    expect(run).toHaveBeenCalledTimes(2);
    expect(result.completedPlans).toBe(1);
    expect(onEvent).toHaveBeenCalledWith({
      type: "plan.failed",
      planPath: "docs/plans/first.md",
      error: "agent failed"
    });
  });
});
