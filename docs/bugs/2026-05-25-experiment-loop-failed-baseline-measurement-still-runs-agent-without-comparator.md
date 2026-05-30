---
name: "Experiment loop failed baseline measurement still runs agent without comparator"
---

# Experiment loop failed baseline measurement still runs agent without comparator

## Summary

`@poe-code/experiment-loop` supports `baseline: null` by evaluating the configured metrics before autonomous iteration. If that required baseline measurement fails, the loop leaves its baseline unresolved but still launches the agent with a metrics prompt that contains no baseline comparator.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("failed automatic baseline", () => {
  it("still starts an agent iteration without a measured baseline", async () => {
    const docPath = "/repo/.poe-code/experiments/no-baseline.md";
    const journalPath = "/repo/.poe-code/experiments/no-baseline.journal.jsonl";
    const fs = createFsFromVolume(Volume.fromJSON({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: tests",
        "  script: npm test",
        "  direction: maximize",
        "baseline: null",
        "max_experiments: 1",
        "---",
        "Improve it"
      ].join("\n")
    })).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => undefined)
    };
    const runAgent = vi.fn(async (input: AgentRunInput) => {
      await fs.appendFile(journalPath, `${JSON.stringify({
        commit: "discard-1",
        status: "discard",
        output: "no baseline",
        agentOutput: "ran anyway",
        durationMs: 1,
        timestamp: "2026-05-25T00:00:00.000Z"
      })}\n`);
      return { stdout: input.prompt, stderr: "", exitCode: 0 };
    });

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      fs,
      git,
      exec: vi.fn(async () => ({ stdout: "metric failed", stderr: "", exitCode: 1 })),
      runAgent
    });

    console.log(JSON.stringify({ result, prompt: runAgent.mock.calls[0]?.[0]?.prompt }));
    expect(runAgent).not.toHaveBeenCalled();
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The probe fails because the autonomous iteration starts even though its initial metric command exited unsuccessfully:

```text
{"result":{"stopReason":"max_experiments","docPath":"/repo/.poe-code/experiments/no-baseline.md","experimentsCompleted":1,"experimentsKept":0,"totalDurationMs":5},"prompt":"Improve it\n\n## Metrics\n\n- tests: maximize, script: `npm test`\n..."}
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
```

## Observed Behavior

The configured metric command exits nonzero during the automatic baseline phase. `runExperimentLoop()` does not establish a baseline or invoke `onBaselineCollected`, but it proceeds into the experiment loop and calls `runAgent()` once. The generated prompt advertises `- tests: maximize, script: \`npm test\`` without any `(baseline: ...)` value against which an improvement could be evaluated.

In `packages/experiment-loop/src/run/loop.ts`, baseline collection sets `baseline` only when `allMetricsPassed(initialMetrics, baselineResults)` succeeds. When that condition is false, control simply continues to the `while` loop with `baseline === null`; there is no failure, cancellation, or skip path before agent invocation.

## Expected Behavior

When a plan requires automatic baseline measurement and the baseline metrics do not pass, the experiment loop should stop with a clear error or unsuccessful result before launching any autonomous agent work. It must not ask an agent to optimize a metric whose starting comparator was never obtained.

## Impact

A failing or misconfigured baseline script can still trigger code-changing agent iterations under an undefined objective. The resulting changes may consume experiment budget, produce misleading discard or keep history, and encourage optimization decisions without a valid starting measurement.
