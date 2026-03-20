import { describe, expect, it } from "vitest";
import {
  buildExecutionPrompt,
  selectNextExecution,
  type ExecutionSelection
} from "./runner.js";
import type { PipelinePlan, ResolvedStepDefinitions } from "../types.js";

function getSelection(plan: PipelinePlan): ExecutionSelection {
  return selectNextExecution(plan);
}

describe("selectNextExecution", () => {
  it("selects the first open stepless task", () => {
    const selection = getSelection({
      tasks: [
        { id: "one", title: "One", prompt: "One", status: "open" }
      ]
    });

    expect(selection).toMatchObject({
      kind: "run",
      task: { id: "one" }
    });
  });

  it("skips completed tasks and selects the next open one", () => {
    const selection = getSelection({
      tasks: [
        { id: "one", title: "One", prompt: "One", status: "done" },
        { id: "two", title: "Two", prompt: "Two", status: "open" }
      ]
    });

    expect(selection).toMatchObject({
      kind: "run",
      task: { id: "two" }
    });
  });

  it("returns a blocking failure for a failed stepless task", () => {
    const selection = getSelection({
      tasks: [
        { id: "one", title: "One", prompt: "One", status: "failed" },
        { id: "two", title: "Two", prompt: "Two", status: "open" }
      ]
    });

    expect(selection).toEqual({
      kind: "blocked",
      task: { id: "one", title: "One", prompt: "One", status: "failed" }
    });
  });

  it("picks the first open step in a stepped task", () => {
    const selection = getSelection({
      tasks: [
        {
          id: "one",
          title: "One",
          prompt: "One",
          status: {
            implement: "done",
            test: "open",
            commit: "open"
          }
        }
      ]
    });

    expect(selection).toMatchObject({
      kind: "run",
      task: { id: "one" },
      stepName: "test"
    });
  });

  it("blocks when any step has failed", () => {
    const selection = getSelection({
      tasks: [
        {
          id: "one",
          title: "One",
          prompt: "One",
          status: {
            implement: "done",
            test: "failed",
            commit: "open"
          }
        }
      ]
    });

    expect(selection).toMatchObject({
      kind: "blocked",
      task: { id: "one" },
      stepName: "test"
    });
  });

  it("returns completed when all work is done", () => {
    const selection = getSelection({
      tasks: [
        { id: "one", title: "One", prompt: "One", status: "done" },
        {
          id: "two",
          title: "Two",
          prompt: "Two",
          status: {
            implement: "done"
          }
        }
      ]
    });

    expect(selection).toEqual({ kind: "completed" });
  });
});

describe("buildExecutionPrompt", () => {
  const steps: ResolvedStepDefinitions = {
    implement: {
      mode: "edit",
      instruction: "{{id}} {{title}}\n{{prompt}}\nPlan: {{plan_path}}"
    }
  };

  it("interpolates step placeholders", () => {
    const prompt = buildExecutionPrompt({
      selection: {
        kind: "run",
        task: {
          id: "auth-hardening",
          title: "Harden auth flow",
          prompt: "Improve auth validation",
          status: {
            implement: "open"
          }
        },
        stepName: "implement"
      },
      steps,
      planPath: ".poe-code/pipeline/plans/plan-auth.yaml"
    });

    expect(prompt).toBe(
      "auth-hardening Harden auth flow\nImprove auth validation\nPlan: .poe-code/pipeline/plans/plan-auth.yaml"
    );
  });

  it("uses the task prompt directly for stepless tasks", () => {
    const prompt = buildExecutionPrompt({
      selection: {
        kind: "run",
        task: {
          id: "quick-fix",
          title: "Quick fix",
          prompt: "Fix the timeout regression",
          status: "open"
        }
      },
      steps,
      planPath: "ignored.yaml"
    });

    expect(prompt).toBe("Fix the timeout regression");
  });
});
