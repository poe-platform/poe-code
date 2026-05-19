import { describe, expect, it, vi } from "vitest";
import { createSpawnMock } from "@poe-code/agent-spawn/testing";
import {
  assertSuccessfulRun,
  copyFixtureClone,
  createRunOutDir,
  registerRunIntegrationCleanup,
  sourceFixture
} from "./run.integration-helper.js";

const mockedAgentSpawn = vi.hoisted(() => ({
  spawnMock: undefined as ReturnType<typeof createSpawnMock> | undefined
}));

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  const spawnMock = createSpawnMock();
  mockedAgentSpawn.spawnMock = spawnMock;
  return {
    ...actual,
    ...spawnMock.factory()
  };
});

vi.mock("./clone.js", () => ({
  cloneTarget: vi.fn(async (input: { dest: string }) => {
    await copyFixtureClone(input.dest);
    return { resolvedSha: "fixture-sha" };
  })
}));

const { runEval } = await import("./run.js");

registerRunIntegrationCleanup();

describe("runEval plan integration", () => {
  it("runs a plan eval and writes artifacts", async () => {
    const outDir = await createRunOutDir();

    const result = await runEval({
      sourceDir: sourceFixture("plan"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      judge: "off",
      verifyOracle: false
    });

    expect(mockedAgentSpawn.spawnMock!.autonomous).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        cwd: expect.stringContaining("clone"),
        model: "openai/gpt-5",
        prompt: expect.stringContaining("Implement the plan fixture.")
      })
    );
    await assertSuccessfulRun({ outDir, result, kind: "plan" });
  });
});
