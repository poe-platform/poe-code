import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSpawnMock } from "@poe-code/agent-spawn/testing";
import {
  assertSuccessfulRun,
  assertObservedNestedEvents,
  copyFixtureClone,
  createRunOutDir,
  nestedAcpEvents,
  registerRunIntegrationCleanup,
  sourceFixture
} from "./run.integration-helper.js";

const mockedAgentSpawn = vi.hoisted(() => ({
  spawnMock: undefined as ReturnType<typeof createSpawnMock> | undefined,
  spawnStreaming: vi.fn()
}));

const mockedExperiment = vi.hoisted(() => ({ runExperimentLoop: vi.fn() }));

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  const spawnMock = createSpawnMock();
  mockedAgentSpawn.spawnMock = spawnMock;
  return {
    ...actual,
    ...spawnMock.factory(),
    spawnStreaming: mockedAgentSpawn.spawnStreaming
  };
});

vi.mock("@poe-code/experiment-loop", () => ({
  runExperimentLoop: mockedExperiment.runExperimentLoop
}));

vi.mock("./clone.js", () => ({
  cloneTarget: vi.fn(async (input: { dest: string }) => {
    await copyFixtureClone(input.dest);
    return { resolvedSha: "fixture-sha" };
  })
}));

const { runEval } = await import("./run.js");

registerRunIntegrationCleanup();

describe("runEval experiment integration", () => {
  beforeEach(() => {
    mockedExperiment.runExperimentLoop
      .mockReset()
      .mockResolvedValue({ stopReason: "max_experiments" });
  });
  it("records nested agent ACP events through the experiment boundary", async () => {
    const outDir = await createRunOutDir();
    const outsidePath = "/private/agent-eval-experiment-cheat.txt";
    mockedAgentSpawn.spawnStreaming.mockReturnValueOnce({
      events: (async function* () {
        yield* nestedAcpEvents(outsidePath);
      })(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    });
    mockedExperiment.runExperimentLoop.mockImplementationOnce(
      async (options: { runAgent: (input: object) => Promise<unknown> }) => {
        await options.runAgent({ agent: "codex", prompt: "nested", cwd: "/tmp" });
        return { stopReason: "max_experiments" };
      }
    );

    const result = await runEval({
      sourceDir: sourceFixture("experiment"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      judge: "off",
      verifyOracle: false
    });

    await assertObservedNestedEvents({ outDir, result, expectedPath: outsidePath });
  });

  it("runs an experiment eval and writes artifacts", async () => {
    const outDir = await createRunOutDir();

    const result = await runEval({
      sourceDir: sourceFixture("experiment"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      judge: "off",
      verifyOracle: false
    });

    expect(mockedExperiment.runExperimentLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        docPath: expect.stringContaining("docs/plans/eval-task.md"),
        cwd: expect.stringContaining("clone"),
        agent: "codex:openai/gpt-5"
      })
    );
    await assertSuccessfulRun({ outDir, result, kind: "experiment" });
  });
});
