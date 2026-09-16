import { expect, it } from "vitest";
import { createPipelineSimulation, failTurn, successTurn } from "../testing/simulation.js";
import { runPipeline } from "./pipeline.js";
import { parsePlan, pipelineDocumentSchema } from "../plan/parser.js";

it("validates the durable setup marker", () => {
  const document = (value: string) => `kind: pipeline\nversion: 1\ntasks: []\nsetupCompleted: ${value}\n`;
  expect(parsePlan(document("true")).setupCompleted).toBe(true);
  expect(parsePlan(document("false")).setupCompleted).toBe(false);
  expect(() => parsePlan(document("done"))).toThrow("setupCompleted");
  expect(pipelineDocumentSchema.properties?.setupCompleted).toMatchObject({ type: "boolean" });
});

it("skips inherited setup after completion even when the task fails", async () => {
  const first = await createPipelineSimulation({
    plan: { tasks: [{ id: "work", title: "Work", prompt: "Work", status: "open" }], teardown: null },
    projectStepsSetup: { prompt: "Prepare" },
    turns: [successTurn(), failTurn()]
  }).run();
  const second = await createPipelineSimulation({
    plan: await first.readPlan(),
    projectStepsSetup: { prompt: "Prepare" },
    turns: [successTurn()]
  }).run();
  expect(second.prompts).toEqual(["Work"]);
});

it.each(["success", "failure", "cancellation"])("persists setup only after %s", async (outcome) => {
  const first = await createPipelineSimulation({
    plan: {
      extends: "default",
      setup: { prompt: "Prepare" },
      teardown: null,
      tasks: [
        { id: "one", title: "One", prompt: "First", status: "open" },
        { id: "two", title: "Two", prompt: "Second", status: "open" }
      ]
    },
    turns: [outcome === "success" ? successTurn() : failTurn(), successTurn()],
    config: { maxRuns: 1 }
  }).run();
  if (outcome === "cancellation") {
    // Retry the failed setup with an interrupted agent before resuming.
    const error = new Error("Interrupted");
    error.name = "AbortError";
    await runPipeline({
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "/repo/docs/plans/plan.md",
      agent: "codex",
      fs: first.fs,
      runAgent: async () => {
        throw error;
      }
    });
  }
  const prompts: string[] = [];
  await runPipeline({
    cwd: "/repo",
    homeDir: "/home/test",
    plan: "/repo/docs/plans/plan.md",
    agent: "codex",
    fs: first.fs,
    archive: false,
    runAgent: async ({ prompt }) => {
      prompts.push(prompt);
      return { exitCode: 0, stdout: "", stderr: "" };
    }
  });
  expect(prompts).toEqual(outcome === "success" ? ["Second"] : ["Prepare", "First", "Second"]);
});
