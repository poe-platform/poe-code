---
name: "Agent Eval Judge `__proto__` Rubric Score Is Dropped and Mean Becomes Zero"
---

# Agent Eval Judge `__proto__` Rubric Score Is Dropped and Mean Becomes Zero

## Summary

The exported `judgeRun()` API accepts a judge rubric containing the key `__proto__`, parses a valid JSON judge response for that requested score, but silently drops the score from its returned results and reports `mean: 0`. Score normalization copies configured rubric keys into an ordinary object with bracket assignment, so that key is not retained as numeric score data.

## Reproduction

Create a disposable Vitest probe at `packages/agent-eval/src/run/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

const spawnAutonomousMock = vi.hoisted(() => vi.fn());
vi.mock("@poe-code/agent-spawn", () => ({
  getSpawnConfig: () => ({ modes: { read: [] } }),
  spawn: {},
  spawnAutonomous: spawnAutonomousMock,
  spawnStreaming: vi.fn()
}));
vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

import { judgeRun } from "./judge.js";

describe("judge rubric special names", () => {
  beforeEach(() => { vol.reset(); spawnAutonomousMock.mockReset(); });

  it("drops an explicit __proto__ score from returned judge scores", async () => {
    vol.fromJSON({ "/repo/file.ts": "x" });
    spawnAutonomousMock.mockResolvedValue({ text: '{"__proto__":5}' });

    const result = await judgeRun({
      evalDef: { plan: { body: "Do work." } },
      cloneDir: "/repo",
      traceJsonPath: "/trace.json",
      trace: { events: [], usage: { inputTokens: 0, outputTokens: 0 } },
      testsResult: { passed: 1, total: 1 },
      spec: { agent: "codex", model: "judge", rubric: ["__proto__"] },
      agentUnderTest: "claude-code"
    } as never);

    expect(Object.hasOwn(result, "__proto__")).toBe(false);
    expect(result.mean).toBe(0);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-eval/src/run/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that a valid score returned for the configured rubric dimension is lost. Remove the disposable probe after validation.

## Observed Behavior

For rubric `["__proto__"]` and judge JSON output `{"__proto__":5}`, `judgeRun()` returns a result with no own `__proto__` score and `mean === 0`. In `packages/agent-eval/src/run/judge.ts`, `parseJudgeScores()` initializes `scores` as `{}`, writes each requested rubric key through `scores[key] = clampScore(source[key])`, and computes the mean only from `Object.values(scores)`.

## Expected Behavior

Every configured rubric dimension accepted by `judgeRun()` should be preserved in its returned score object and included in the calculated mean, including a key named `__proto__`, or invalid rubric names should be rejected explicitly before a judge is invoked.

## Impact

An evaluation can receive a valid maximum score for a configured judge dimension yet record that dimension as absent and calculate a zero aggregate judge score. This can incorrectly fail or penalize evaluation runs while hiding that the judge returned the requested assessment.
