import { describe, expect, it } from "vitest";
import type {
  AgentRunUsage,
  AgentRunInput,
  AgentRunResult,
  PipelineMetrics,
  PipelinePlan,
  PipelineRunOptions,
  PipelineRunResult,
  PipelineTask,
  ResolvedStepDefinitions,
  StepDefinition
} from "@poe-code/pipeline";

describe("@poe-code/pipeline public exports", () => {
  it("exports SDK types", () => {
    const step: StepDefinition = {
      mode: "yolo",
      prompt: "Implement {{id}}"
    };
    const steps: ResolvedStepDefinitions = {
      implement: step
    };
    const task: PipelineTask = {
      id: "task-1",
      title: "Task one",
      prompt: "Fix it",
      status: "open"
    };
    const plan: PipelinePlan = {
      tasks: [task]
    };
    const input: AgentRunInput = {
      agent: "codex",
      prompt: "Fix it",
      mode: "yolo",
      cwd: "/repo"
    };
    const result: AgentRunResult = {
      stdout: "",
      stderr: "",
      exitCode: 0,
      usage: {
        inputTokens: 10,
        outputTokens: 5
      }
    };
    const metrics: PipelineMetrics = {
      totalInputTokens: 10,
      totalOutputTokens: 5,
      totalCachedTokens: 0,
      tasksCompleted: 1,
      tasksFailed: 0,
      stepsCompleted: 0
    };
    const usage: AgentRunUsage = {
      inputTokens: 10,
      outputTokens: 5
    };
    const options: PipelineRunOptions = {
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test"
    };
    const runResult = null as unknown as PipelineRunResult;

    expect(step.mode).toBe("yolo");
    expect(Object.keys(steps)).toEqual(["implement"]);
    expect(plan.tasks).toHaveLength(1);

    void input;
    void result;
    void options;
    void runResult;
    void metrics;
    void usage;
  });
});
