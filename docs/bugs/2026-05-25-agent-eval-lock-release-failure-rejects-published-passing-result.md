# Agent Eval lock release failure rejects a published passing result

## Summary

The exported `@poe-code/agent-eval` `runEval()` API writes completed evaluation artifacts, including a passing `result.json`, while holding its run-directory lock and awaits lock release in a `finally` block afterward. If releasing that lock fails, `runEval()` rejects instead of returning the passing result that has already been published to disk.

## Reproduction

1. Add this disposable probe as `packages/agent-eval/src/run/__probe__.test.ts`:

```ts
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSpawnMock } from "@poe-code/agent-spawn/testing";
import {
  copyFixtureClone,
  createRunOutDir,
  registerRunIntegrationCleanup,
  sourceFixture
} from "./run.integration-helper.js";

const mocked = vi.hoisted(() => ({
  releaseLock: vi.fn(async () => {
    throw new Error("run lock release denied");
  }),
  runScorer: vi.fn(async () => ({ passed: 1, total: 1, cases: [] })),
  spawnStreaming: vi.fn()
}));

vi.mock("@poe-code/file-lock", () => ({
  acquireFileLock: vi.fn(async () => mocked.releaseLock)
}));
vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  const spawnMock = createSpawnMock();
  return { ...actual, ...spawnMock.factory(), spawnStreaming: mocked.spawnStreaming };
});
vi.mock("./clone.js", () => ({
  cloneTarget: vi.fn(async (input: { dest: string }) => {
    await copyFixtureClone(input.dest);
    return { resolvedSha: "fixture-sha" };
  })
}));
vi.mock("./scorer.js", () => ({ runScorer: mocked.runScorer }));

import { runEval } from "./run.js";

registerRunIntegrationCleanup();

describe("runEval lock release failure probe", () => {
  it("rejects after publishing a passing result when run lock release fails", async () => {
    mocked.spawnStreaming.mockReturnValue({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    });
    const outDir = await createRunOutDir();

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
    ).rejects.toThrow("run lock release denied");

    const runId = (await readdir(outDir))[0]!;
    const result = JSON.parse(await readFile(path.join(outDir, runId, "result.json"), "utf8"));
    expect(result).toMatchObject({ verdict: "pass", correctness: 1 });
  });
});
```

2. Run the focused probe:

```sh
npm exec -- vitest run packages/agent-eval/src/run/__probe__.test.ts --reporter verbose
```

3. Remove the disposable probe after validation.

The probe passes on the current implementation:

```text
✓ packages/agent-eval/src/run/__probe__.test.ts > runEval lock release failure probe > rejects after publishing a passing result when run lock release fails
```

## Observed Behavior

The mocked dispatch and scorer complete successfully, and `runEval()` publishes `result.json` containing `verdict: "pass"` and `correctness: 1`. The run-directory lock release callback then rejects with `run lock release denied`, causing the exported `runEval()` promise to reject rather than return its already published passing result.

## Expected Behavior

Failure to release a run-directory lock after completed result publication should not replace the authoritative evaluation outcome. The API should return the published evaluation result while surfacing lock cleanup trouble separately, or expose both outcomes without making a passing published run appear to have failed ordinarily.

## Impact

Lock-file deletion or release failures can make a passing evaluation look like a framework failure to matrix runners and callers even while the run directory records a pass. Automation may retry or discard a valid completed score, resulting in contradictory reporting and redundant evaluation work.
