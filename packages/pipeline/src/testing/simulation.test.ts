import { describe, expect, it, vi } from "vitest";
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
    expect(result.metrics).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 1
    });
    expect(prompts).toEqual(["Fix the timeout regression"]);
    expect(runs[0]?.mode).toBe("yolo");
    expect(plan.tasks[0]?.status).toBe("done");
  });

  it("accumulates usage metrics for a single task run", async () => {
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
      turns: [
        {
          output: {
            stdout: "",
            exitCode: 0,
            usage: {
              inputTokens: 120,
              outputTokens: 45,
              cachedTokens: 30
            }
          }
        }
      ]
    });

    const { result } = await sim.run();

    expect(result.metrics).toEqual({
      totalInputTokens: 120,
      totalOutputTokens: 45,
      totalCachedTokens: 30,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 1
    });
  });

  it("treats missing exitCode as success while preserving usage totals", async () => {
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
      turns: [
        {
          output: {
            stdout: "",
            usage: {
              inputTokens: 3,
              outputTokens: 2,
              cachedTokens: 0
            }
          }
        }
      ]
    });

    const { result } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(result.metrics).toEqual({
      totalInputTokens: 3,
      totalOutputTokens: 2,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 1
    });
  });

  it("forwards usage to onTaskComplete when available", async () => {
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
      turns: [
        {
          output: {
            stdout: "",
            exitCode: 0,
            usage: {
              inputTokens: 9,
              outputTokens: 4
            }
          }
        }
      ]
    });

    const { result, taskCompletions } = await sim.run();

    expect(result.metrics).toEqual({
      totalInputTokens: 9,
      totalOutputTokens: 4,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 1
    });

    expect(taskCompletions).toHaveLength(1);
    expect(taskCompletions[0]?.usage).toEqual({
      inputTokens: 9,
      outputTokens: 4
    });
  });

  it("does not include usage in onTaskComplete when unavailable", async () => {
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

    const { result, taskCompletions } = await sim.run();

    expect(result.metrics).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 1
    });

    expect(taskCompletions).toHaveLength(1);
    expect(taskCompletions[0]?.usage).toBeUndefined();
  });

  it("passes configured logDir to each agent run", async () => {
    const sim = createPipelineSimulation({
      plan: {
        tasks: [
          {
            id: "quick-fix",
            title: "Quick fix",
            prompt: "Fix the timeout regression",
            status: "open"
          },
          {
            id: "slow-fix",
            title: "Slow fix",
            prompt: "Fix another regression",
            status: "open"
          }
        ]
      },
      config: {
        logDir: "/repo/.poe-code/pipeline/plans/logs/quick-fix-yolo.jsonl"
      },
      turns: [successTurn(), successTurn()]
    });

    const { result, runs } = await sim.run();

    expect(result.metrics).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 2,
      tasksFailed: 0,
      stepsCompleted: 2
    });

    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.logDir)).toEqual([
      "/repo/.poe-code/pipeline/plans/logs/quick-fix-yolo.jsonl",
      "/repo/.poe-code/pipeline/plans/logs/quick-fix-yolo.jsonl"
    ]);
  });

  it("forwards an explicitly empty logDir value", async () => {
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
      config: {
        logDir: ""
      },
      turns: [successTurn()]
    });

    const { result, runs } = await sim.run();

    expect(result.metrics).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 1
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.logDir).toBe("");
  });

  it("leaves logDir undefined when not configured", async () => {
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

    const { result, runs } = await sim.run();

    expect(result.metrics).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 1
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.logDir).toBeUndefined();
  });

  it("runs stepped tasks in order and marks each step done", async () => {
    const sim = createPipelineSimulation({
      projectSteps: {
        implement: {
          mode: "yolo",
          prompt: "Implement {{id}}"
        },
        test: {
          mode: "read",
          prompt: "Test {{id}}"
        },
        commit: {
          mode: "yolo",
          prompt: "Commit {{id}}"
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
    expect(result.metrics).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 3,
      tasksFailed: 0,
      stepsCompleted: 3
    });
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

  it("aggregates usage across multi-step runs with missing usage entries", async () => {
    const sim = createPipelineSimulation({
      projectSteps: {
        implement: {
          mode: "yolo",
          prompt: "Implement {{id}}"
        },
        test: {
          mode: "read",
          prompt: "Test {{id}}"
        },
        commit: {
          mode: "yolo",
          prompt: "Commit {{id}}"
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
      turns: [
        {
          output: {
            stdout: "",
            exitCode: 0,
            usage: {
              inputTokens: 50,
              outputTokens: 20,
              cachedTokens: 7
            }
          }
        },
        {
          output: {
            stdout: "",
            exitCode: 0
          }
        },
        {
          output: {
            stdout: "",
            exitCode: 0,
            usage: {
              inputTokens: 15,
              outputTokens: 5
            }
          }
        }
      ]
    });

    const { result } = await sim.run();

    expect(result.metrics).toEqual({
      totalInputTokens: 65,
      totalOutputTokens: 25,
      totalCachedTokens: 7,
      tasksCompleted: 3,
      tasksFailed: 0,
      stepsCompleted: 3
    });
  });

  it("marks the current step failed and stops on non-zero exit", async () => {
    const sim = createPipelineSimulation({
      projectSteps: {
        implement: {
          mode: "edit",
          prompt: "Implement {{id}}"
        },
        test: {
          mode: "read",
          prompt: "Test {{id}}"
        },
        commit: {
          mode: "edit",
          prompt: "Commit {{id}}"
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
    expect(result.metrics).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 1,
      stepsCompleted: 2
    });
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

  it("counts usage and failed metrics for non-zero exits", async () => {
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
      turns: [
        {
          output: {
            stdout: "",
            stderr: "failed",
            exitCode: 1,
            usage: {
              inputTokens: 11,
              outputTokens: 6,
              cachedTokens: 2
            }
          }
        }
      ]
    });

    const { result, taskCompletions, readPlan } = await sim.run();

    expect(result.stopReason).toBe("failed");
    expect(result.metrics).toEqual({
      totalInputTokens: 11,
      totalOutputTokens: 6,
      totalCachedTokens: 2,
      tasksCompleted: 0,
      tasksFailed: 1,
      stepsCompleted: 1
    });
    expect(taskCompletions).toHaveLength(1);
    expect(taskCompletions[0]?.success).toBe(false);
    expect(taskCompletions[0]?.usage).toEqual({
      inputTokens: 11,
      outputTokens: 6,
      cachedTokens: 2
    });
    expect((await readPlan()).tasks[0]?.status).toBe("failed");
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

  it("uses per-step agent and model overrides", async () => {
    const sim = createPipelineSimulation({
      projectSteps: {
        implement: {
          mode: "yolo",
          prompt: "Implement {{id}}",
          agent: "codex",
          model: "o3"
        },
        review: {
          mode: "read",
          prompt: "Review {{id}}",
          agent: "claude-code"
        }
      },
      plan: {
        tasks: [
          {
            id: "feat",
            title: "Feature",
            prompt: "Add feature",
            status: {
              implement: "open",
              review: "open"
            }
          }
        ]
      },
      turns: [successTurn(), successTurn()]
    });

    const { runs } = await sim.run();

    expect(runs[0]?.agent).toBe("codex");
    expect(runs[0]?.model).toBe("o3");
    expect(runs[1]?.agent).toBe("claude-code");
    expect(runs[1]?.model).toBeUndefined();
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
    expect(result.metrics).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
      tasksCompleted: 2,
      tasksFailed: 0,
      stepsCompleted: 2
    });
    expect(plan.tasks.map((task) => task.status)).toEqual(["done", "done", "open"]);
  });

  it("continues with last good plan when steps.yaml is corrupted mid-run", async () => {
    const onReloadError = vi.fn();

    const sim = createPipelineSimulation({
      projectSteps: {
        implement: { mode: "yolo", prompt: "Implement {{id}}" }
      },
      plan: {
        tasks: [
          { id: "one", title: "One", prompt: "One", status: { implement: "open" } },
          { id: "two", title: "Two", prompt: "Two", status: { implement: "open" } }
        ]
      },
      onPlanReloadError: onReloadError,
      turns: [
        {
          output: { stdout: "", exitCode: 0 },
          fileChanges: {
            ".poe-code/pipeline/steps.yaml": "this is: [invalid yaml"
          }
        },
        successTurn()
      ]
    });

    const { result } = await sim.run();

    expect(onReloadError).toHaveBeenCalled();
    expect(result.stopReason).toBe("completed");
    expect(result.runsCompleted).toBe(2);
  });

  it("runs setup before tasks and teardown after all tasks complete", async () => {
    const sim = createPipelineSimulation({
      plan: {
        setup: { mode: "yolo", prompt: "Prepare the workspace" },
        teardown: { mode: "yolo", prompt: "Clean up" },
        tasks: [
          { id: "task-1", title: "Task 1", prompt: "Do task 1", status: "open" }
        ]
      },
      turns: [successTurn(), successTurn(), successTurn()]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual([
      "Prepare the workspace",
      "Do task 1",
      "Clean up"
    ]);
    expect(result.metrics.stepsCompleted).toBe(3);
    expect(result.metrics.tasksCompleted).toBe(1);
  });

  it("stops before tasks when setup fails", async () => {
    const sim = createPipelineSimulation({
      plan: {
        setup: { mode: "yolo", prompt: "Setup" },
        tasks: [
          { id: "task-1", title: "Task 1", prompt: "Do task 1", status: "open" }
        ]
      },
      turns: [failTurn("setup failed")]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("failed");
    expect(result.runsCompleted).toBe(0);
    expect(prompts).toEqual(["Setup"]);
  });

  it("disables steps.yaml setup when plan sets setup: null", async () => {
    const sim = createPipelineSimulation({
      projectStepsSetup: { mode: "yolo", prompt: "Setup from steps.yaml" },
      plan: {
        setup: null,
        tasks: [{ id: "task-1", title: "Task 1", prompt: "Do task 1", status: "open" }]
      },
      turns: [successTurn()]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual(["Do task 1"]);
  });

  it("overrides steps.yaml setup when plan defines its own setup", async () => {
    const sim = createPipelineSimulation({
      projectStepsSetup: { mode: "yolo", prompt: "Setup from steps.yaml" },
      plan: {
        setup: { mode: "yolo", prompt: "Custom setup from plan" },
        tasks: [{ id: "task-1", title: "Task 1", prompt: "Do task 1", status: "open" }]
      },
      turns: [successTurn(), successTurn()]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual(["Custom setup from plan", "Do task 1"]);
  });

  it("returns failed when teardown fails after all tasks complete", async () => {
    const sim = createPipelineSimulation({
      plan: {
        teardown: { mode: "yolo", prompt: "Teardown" },
        tasks: [
          { id: "task-1", title: "Task 1", prompt: "Do task 1", status: "open" }
        ]
      },
      turns: [successTurn(), failTurn("teardown failed")]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("failed");
    expect(result.runsCompleted).toBe(1);
    expect(prompts).toEqual(["Do task 1", "Teardown"]);
  });

  it("expands {{file '...'}} in task prompts", async () => {
    const sim = createPipelineSimulation({
      files: {
        "docs/context.md": "# Context\nUse this context."
      },
      plan: {
        tasks: [
          {
            id: "task-1",
            title: "Task 1",
            prompt: "Preamble\n{{file 'docs/context.md'}}\nDo the work.",
            status: "open"
          }
        ]
      },
      turns: [successTurn()]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual(["Preamble\n# Context\nUse this context.\nDo the work."]);
  });

  it("interpolates vars into task prompt", async () => {
    const sim = createPipelineSimulation({
      plan: {
        vars: { env: "production" },
        tasks: [
          {
            id: "task-1",
            title: "Deploy",
            prompt: "Deploy to {{env}}.",
            status: "open"
          }
        ]
      },
      turns: [successTurn()]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual(["Deploy to production."]);
  });

  it("resolves a file-backed var and interpolates it into task prompt", async () => {
    const sim = createPipelineSimulation({
      files: {
        "docs/plans/my-feature.md": "# My Feature\nBuild the thing."
      },
      plan: {
        vars: { plan_doc: "{{file 'docs/plans/my-feature.md'}}" },
        tasks: [
          {
            id: "task-1",
            title: "Implement",
            prompt: "{{plan_doc}}\n\nDo the implementation.",
            status: "open"
          }
        ]
      },
      turns: [successTurn()]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual(["# My Feature\nBuild the thing.\n\nDo the implementation."]);
  });

  it("expands {{file '...'}} in setup/teardown prompts", async () => {
    const sim = createPipelineSimulation({
      files: {
        "docs/setup-instructions.md": "Install dependencies."
      },
      plan: {
        setup: { mode: "yolo", prompt: "{{file 'docs/setup-instructions.md'}}" },
        tasks: [
          { id: "task-1", title: "Task 1", prompt: "Do task 1", status: "open" }
        ]
      },
      turns: [successTurn(), successTurn()]
    });

    const { result, prompts } = await sim.run();

    expect(result.stopReason).toBe("completed");
    expect(prompts).toEqual(["Install dependencies.", "Do task 1"]);
  });
});
