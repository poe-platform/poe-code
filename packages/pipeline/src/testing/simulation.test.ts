import { describe, expect, it } from "vitest";
import {
  createPipelineSimulation,
  failTurn,
  successTurn
} from "./simulation.js";

describe("createPipelineSimulation", () => {
  it("completes a stepless task in one run", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          {
            id: "quick-fix",
            title: "Quick fix",
            prompt: "Fix the timeout regression",
            status: "open"
          }
        ]
      },
      turns: [successTurn()]
    });

    const { result, readPlan, prompts, runs } = await sim.run();
    const plan = await readPlan();

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual(["Fix the timeout regression"]);
    expect(runs[0]?.mode).toBe("yolo");
    expect(plan.tasks[0]?.status).toBe("done");
  });

  it("runs stepped tasks in order and marks each step done", async () => {
    const sim = createPipelineSimulation({
      projectSteps: {
        implement: {
          instruction: "Implement {{id}}"
        },
        test: {
          mode: "read",
          instruction: "Test {{id}}"
        },
        commit: {
          instruction: "Commit {{id}}"
        }
      },
      plan: {
        tasks: [
          {
            id: "auth-hardening",
            title: "Harden auth",
            prompt: "Improve auth validation",
            status: {
              implement: "open",
              test: "open",
              commit: "open"
            }
          }
        ]
      },
      turns: [successTurn(), successTurn(), successTurn()]
    });

    const { result, readPlan, prompts, runs } = await sim.run();
    const task = (await readPlan()).tasks[0];

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual([
      "Implement auth-hardening",
      "Test auth-hardening",
      "Commit auth-hardening"
    ]);
    expect(runs.map((run) => run.mode)).toEqual(["yolo", "read", "yolo"]);
    expect(task?.status).toEqual({
      implement: "done",
      test: "done",
      commit: "done"
    });
  });

  it("marks the current step failed and stops on non-zero exit", async () => {
    const sim = createPipelineSimulation({
      projectSteps: {
        implement: {
          mode: "edit",
          instruction: "Implement {{id}}"
        },
        test: {
          mode: "read",
          instruction: "Test {{id}}"
        },
        commit: {
          mode: "edit",
          instruction: "Commit {{id}}"
        }
      },
      plan: {
        tasks: [
          {
            id: "auth-hardening",
            title: "Harden auth",
            prompt: "Improve auth validation",
            status: {
              implement: "open",
              test: "open",
              commit: "open"
            }
          }
        ]
      },
      turns: [successTurn(), failTurn("tests failed")]
    });

    const { result, readPlan, prompts, runs } = await sim.run();
    const task = (await readPlan()).tasks[0];

    expect(result.stopReason).toBe("failed");
    expect(result.lastStepName).toBe("test");
    expect(runs).toHaveLength(2);
    expect(prompts).toEqual([
      "Implement auth-hardening",
      "Test auth-hardening"
    ]);
    expect(task?.status).toEqual({
      implement: "done",
      test: "failed",
      commit: "open"
    });
  });

  it("archives the plan file after all tasks complete", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          {
            id: "quick-fix",
            title: "Quick fix",
            prompt: "Fix it",
            status: "open"
          }
        ]
      },
      turns: [successTurn()]
    });

    const { result, fs } = await sim.run();

    expect(result.stopReason).toBe("completed");

    const archiveEntries = await fs.readdir(
      "/repo/.poe-code/pipeline/plans/archive"
    );
    expect(archiveEntries).toContain("plan.yaml");

    const originalEntries = await fs.readdir(
      "/repo/.poe-code/pipeline/plans"
    );
    expect(originalEntries).not.toContain("plan.yaml");
  });

  it("does not archive when plan was already complete (nothing_to_run)", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          {
            id: "done-task",
            title: "Already done",
            prompt: "Nothing to do",
            status: "done"
          }
        ]
      },
      turns: []
    });

    const { result, fs } = await sim.run();

    expect(result.stopReason).toBe("nothing_to_run");

    const entries = await fs.readdir("/repo/.poe-code/pipeline/plans");
    expect(entries).toContain("plan.yaml");
  });

  it("honors maxRuns and leaves remaining tasks open", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          { id: "one", title: "One", prompt: "One", status: "open" },
          { id: "two", title: "Two", prompt: "Two", status: "open" },
          { id: "three", title: "Three", prompt: "Three", status: "open" }
        ]
      },
      config: {
        maxRuns: 2
      },
      turns: [successTurn(), successTurn()]
    });

    const { result, readPlan } = await sim.run();
    const plan = await readPlan();

    expect(result.stopReason).toBe("max_runs");
    expect(plan.tasks.map((task) => task.status)).toEqual(["done", "done", "open"]);
  });
});
