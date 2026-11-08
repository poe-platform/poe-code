import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { runPipeline } from "./pipeline.js";
import type { PipelineFileSystem, PipelinePlan, PlanProgress } from "../types.js";

const planPath = "/repo/docs/plans/release.md";

function document(plan: PipelinePlan): string {
  const { stepOverrides, ...content } = plan;
  return `---\n${stringify({ kind: "pipeline", version: 1, ...content, ...(stepOverrides ? { steps: stepOverrides } : {}) })}---\n`;
}

function fixture(plan: PipelinePlan) {
  const fs = createFsFromVolume(Volume.fromJSON({ [planPath]: document(plan) })).promises;
  return {
    fs: fs as unknown as PipelineFileSystem,
    cwd: "/repo",
    homeDir: "/home/test",
    plan: planPath,
    agent: "codex",
    archive: false
  };
}

describe("pipeline progress for live task views", () => {
  it("reports the actual position of a resumed task and step in plan order", async () => {
    const onTaskStart = vi.fn();
    await runPipeline({
      ...fixture({
        stepOverrides: { implement: { prompt: "Implement" }, verify: { prompt: "Verify" } },
        tasks: [
          { id: "done", title: "Already complete", prompt: "Done", status: "done" },
          { id: "next", title: "Resume verification", prompt: "Resume", status: { implement: "done", verify: "open" } }
        ]
      }),
      onTaskStart,
      runAgent: async () => ({ stdout: "", stderr: "", exitCode: 0 })
    });
    expect(onTaskStart).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "next", taskIndex: 2, totalTasks: 2, stepName: "verify", stepIndex: 2, totalSteps: 2
    }));
  });

  it("publishes immutable ordered tasks before setup and updated statuses before teardown", async () => {
    const snapshots: PlanProgress[] = [];
    const phases: string[] = [];
    const options = fixture({
      setup: { prompt: "Prepare" },
      teardown: { prompt: "Finish" },
      tasks: [
        { id: "first", title: "Completed work", prompt: "Done", status: "done" },
        { id: "second", title: "Remaining work", prompt: "Do it", status: "open" }
      ]
    });
    await runPipeline({
      ...options,
      onPlanProgress: (snapshot: PlanProgress) => snapshots.push(snapshot),
      onTaskStart: (progress) => {
        phases.push(progress.phase ?? progress.taskId);
        expect(snapshots.at(-1)?.tasks).toEqual([
          { id: "first", title: "Completed work", status: "done" },
          { id: "second", title: "Remaining work", status: progress.phase === "teardown" ? "done" : "open" }
        ]);
      },
      runAgent: async () => ({ stdout: "", stderr: "", exitCode: 0 })
    });
    expect(phases).toEqual(["setup", "second", "teardown"]);
    expect(snapshots[0]).toEqual({ planPath, tasks: [
      { id: "first", title: "Completed work", status: "done" },
      { id: "second", title: "Remaining work", status: "open" }
    ] });
    expect(snapshots.at(-1)?.tasks[1]?.status).toBe("done");
  });

  it("publishes changed plan order after a reload and does not mutate earlier step snapshots", async () => {
    const plan: PipelinePlan = {
      stepOverrides: { implement: { prompt: "Implement" }, verify: { prompt: "Verify" } },
      tasks: [{ id: "first", title: "Original task", prompt: "Work", status: { implement: "open", verify: "open" } }]
    };
    const options = fixture(plan);
    const snapshots: PlanProgress[] = [];
    let runs = 0;
    await runPipeline({
      ...options,
      onPlanProgress: (snapshot: PlanProgress) => snapshots.push(snapshot),
      runAgent: async () => {
        if (++runs === 1) {
          plan.tasks.push({ id: "added", title: "Added during execution", prompt: "New work", status: "open" });
          await options.fs.writeFile(planPath, document(plan));
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });
    expect(snapshots[0]?.tasks).toEqual([
      { id: "first", title: "Original task", status: { implement: "open", verify: "open" } }
    ]);
    expect(snapshots.at(-1)?.tasks).toEqual([
      { id: "first", title: "Original task", status: { implement: "done", verify: "done" } },
      { id: "added", title: "Added during execution", status: "done" }
    ]);
  });

  it("publishes a failed task before the run returns", async () => {
    const snapshots: PlanProgress[] = [];
    const result = await runPipeline({
      ...fixture({ tasks: [{ id: "check", title: "Check release", prompt: "Check", status: "open" }] }),
      onPlanProgress: (snapshot: PlanProgress) => snapshots.push(snapshot),
      runAgent: async () => ({ stdout: "", stderr: "Check failed", exitCode: 1 })
    });
    expect(result.stopReason).toBe("failed");
    expect(snapshots.at(-1)?.tasks[0]?.status).toBe("failed");
  });
});
