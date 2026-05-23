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

const mockedSuperintendent = vi.hoisted(() => ({ runLoop: vi.fn() }));

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

vi.mock("@poe-code/superintendent", () => ({
  runLoop: mockedSuperintendent.runLoop
}));

vi.mock("./clone.js", () => ({
  cloneTarget: vi.fn(async (input: { dest: string }) => {
    await copyFixtureClone(input.dest);
    return { resolvedSha: "fixture-sha" };
  })
}));

const { runEval } = await import("./run.js");

registerRunIntegrationCleanup();

describe("runEval superintendent integration", () => {
  beforeEach(() => {
    mockedSuperintendent.runLoop.mockReset().mockResolvedValue({ stopReason: "completed" });
  });
  it("records nested agent ACP events through the superintendent boundary", async () => {
    const outDir = await createRunOutDir();
    const outsidePath = "/private/agent-eval-superintendent-cheat.txt";
    mockedAgentSpawn.spawnStreaming.mockReturnValueOnce({
      events: (async function* () {
        yield* nestedAcpEvents(outsidePath);
      })(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    });
    mockedSuperintendent.runLoop.mockImplementationOnce(
      async (options: { runAgent: (input: object) => Promise<unknown> }) => {
        await options.runAgent({ agent: "codex", prompt: "nested", cwd: "/tmp" });
        return { stopReason: "completed" };
      }
    );

    const result = await runEval({
      sourceDir: sourceFixture("superintendent"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      judge: "off",
      verifyOracle: false
    });

    await assertObservedNestedEvents({ outDir, result, expectedPath: outsidePath });
  });

  it("runs a superintendent eval and writes artifacts", async () => {
    const outDir = await createRunOutDir();

    const result = await runEval({
      sourceDir: sourceFixture("superintendent"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      judge: "off",
      verifyOracle: false
    });

    expect(mockedSuperintendent.runLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        docPath: expect.stringContaining("docs/plans/eval-task.md"),
        cwd: expect.stringContaining("clone"),
        builderAgent: "codex:openai/gpt-5"
      })
    );
    await assertSuccessfulRun({ outDir, result, kind: "superintendent" });
  });
});
