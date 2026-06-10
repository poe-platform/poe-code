import { mkdir, readFile, symlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpawnMock } from "@poe-code/agent-spawn/testing";
import {
  assertObservedNestedEvents,
  assertSuccessfulRun,
  copyFixtureClone,
  createRunOutDir,
  nestedAcpEvents,
  registerRunIntegrationCleanup,
  sourceFixture
} from "./run.integration-helper.js";

const mockedFs = vi.hoisted(() => ({
  failedStatTarget: undefined as string | undefined
}));

const mockedAgentSpawn = vi.hoisted(() => ({
  spawnMock: undefined as ReturnType<typeof createSpawnMock> | undefined,
  spawnStreaming: vi.fn()
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      const [target] = args;
      if (String(target) === mockedFs.failedStatTarget) {
        throw new Error("starter stat denied");
      }

      return actual.stat(...args);
    }
  };
});

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

vi.mock("./clone.js", () => ({
  cloneTarget: vi.fn(async (input: { dest: string }) => {
    await copyFixtureClone(input.dest);
    return { resolvedSha: "fixture-sha" };
  })
}));

const { runEval } = await import("./run.js");
const { cloneTarget } = await import("./clone.js");
const mockedCloneTarget = vi.mocked(cloneTarget);

registerRunIntegrationCleanup();

afterEach(() => {
  mockedFs.failedStatTarget = undefined;
});

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("runEval plan integration", () => {
  it("rejects target plan destinations through symlinked clone ancestors", async () => {
    const outDir = await createRunOutDir();
    const outsideDir = path.join(path.dirname(outDir), "outside-plan-target");
    await mkdir(outsideDir, { recursive: true });
    mockedAgentSpawn.spawnStreaming.mockClear();
    mockedCloneTarget.mockImplementationOnce(async (input) => {
      await copyFixtureClone(input.dest);
      await mkdir(path.join(input.dest, "docs"), { recursive: true });
      await symlink(outsideDir, path.join(input.dest, "docs", "plans"));
      return { resolvedSha: "fixture-sha" };
    });

    await expect(
      runEval({
        sourceDir: sourceFixture("plan"),
        evalId: "task",
        agent: "codex",
        model: "openai/gpt-5",
        outDir,
        judge: "off",
        verifyOracle: false
      })
    ).rejects.toThrow("target.plan_dest must stay within the canonical clone directory.");

    expect(mockedAgentSpawn.spawnStreaming).not.toHaveBeenCalled();
    await expect(readFile(path.join(outsideDir, "eval-task.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("does not treat inherited starter stat error codes as missing starter directories", async () => {
    const outDir = await createRunOutDir();
    mockedFs.failedStatTarget = path.join(sourceFixture("plan"), "task", "starter");
    mockedAgentSpawn.spawnStreaming.mockClear();

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        runEval({
          sourceDir: sourceFixture("plan"),
          evalId: "task",
          agent: "codex",
          model: "openai/gpt-5",
          outDir,
          judge: "off",
          verifyOracle: false
        })
      ).rejects.toThrow("starter stat denied");
    });

    expect(mockedAgentSpawn.spawnStreaming).not.toHaveBeenCalled();
  });

  it("records direct agent ACP events for budget and anti-cheat consumers", async () => {
    const outDir = await createRunOutDir();
    const outsidePath = "/private/agent-eval-plan-cheat.txt";
    mockedAgentSpawn.spawnStreaming.mockReturnValueOnce({
      events: (async function* () {
        yield* nestedAcpEvents(outsidePath);
      })(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    });

    const result = await runEval({
      sourceDir: sourceFixture("plan"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      judge: "off",
      verifyOracle: false
    });

    await assertObservedNestedEvents({ outDir, result, expectedPath: outsidePath });
  });

  it("runs a plan eval and writes artifacts", async () => {
    const outDir = await createRunOutDir();
    mockedAgentSpawn.spawnStreaming.mockReturnValueOnce({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    });

    const result = await runEval({
      sourceDir: sourceFixture("plan"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      judge: "off",
      verifyOracle: false
    });

    expect(mockedAgentSpawn.spawnStreaming).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "codex",
        cwd: expect.stringContaining("clone"),
        model: "openai/gpt-5",
        prompt: expect.stringContaining("Implement the plan fixture.")
      })
    );
    await assertSuccessfulRun({ outDir, result, kind: "plan" });
  });

  it("writes oracle results plus named metrics to result.json", async () => {
    const outDir = await createRunOutDir();
    mockedAgentSpawn.spawnStreaming.mockReturnValueOnce({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    });

    const result = await runEval({
      sourceDir: sourceFixture("metrics"),
      evalId: "task",
      agent: "codex",
      model: "openai/gpt-5",
      outDir,
      judge: "off",
      verifyOracle: false
    });

    expect(result.metrics).toEqual([
      expect.objectContaining({
        id: "task_completion",
        score: 1,
        passed: true,
        status: "executed"
      }),
      expect.objectContaining({ id: "plan_adherence", status: "disabled" }),
      expect.objectContaining({
        id: "tool_correctness",
        score: 1,
        passed: true,
        status: "executed"
      }),
      expect.objectContaining({ id: "step_efficiency", score: 1, passed: true, status: "executed" })
    ]);
    const persisted = JSON.parse(
      await readFile(path.join(outDir, result.runId, "result.json"), "utf8")
    );
    expect(persisted.tests.pass_rate).toBe(1);
    expect(persisted.metrics).toEqual(result.metrics);
  });
});
