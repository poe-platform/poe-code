# Experiment loop zero max experiments still executes baseline metric

## Summary

`@poe-code/experiment-loop` accepts `max_experiments: 0` as an explicit instruction to perform no experiment iterations, and returns a result reporting zero completed experiments. When the plan's baseline is unset, however, the loop still executes the configured metric command before checking the zero iteration limit.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("zero-experiment execution policy", () => {
  it("does not execute baseline metrics when no experiments are allowed", async () => {
    const docPath = "/repo/.poe-code/experiments/disabled.md";
    const volume = Volume.fromJSON({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: tests",
        "  script: npm test",
        "  direction: maximize",
        "baseline: null",
        "max_experiments: 0",
        "---",
        "Do not run experiments",
      ].join("\n"),
    });
    const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => undefined),
    };
    const exec = vi.fn(async () => ({ stdout: "1\n", stderr: "", exitCode: 0 }));
    const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      fs,
      git,
      exec,
      runAgent,
    });

    console.log(JSON.stringify({ result, execCalls: exec.mock.calls }));
    expect(result.experimentsCompleted).toBe(0);
    expect(runAgent).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The probe reports no completed experiments but still observes an executed metric command:

```text
{"result":{"stopReason":"max_experiments","docPath":"/repo/.poe-code/experiments/disabled.md","experimentsCompleted":0,"experimentsKept":0,"totalDurationMs":5},"execCalls":[["npm test",{"cwd":"/repo","timeout":180000}]]}
AssertionError: expected metric executor not to be called
```

## Observed Behavior

In `packages/experiment-loop/src/run/loop.ts`, initialization loads the document and, when `baseline === null`, calls `evaluateChain()` to collect baseline scores before entering the `while` loop. The `max_experiments` check occurs only inside that later loop. As a result, a plan containing `max_experiments: 0` can execute arbitrary metric scripts even though it immediately returns `experimentsCompleted: 0` and never invokes an agent.

## Expected Behavior

An explicit zero experiment limit should prevent experiment-associated command execution, including automatic baseline measurement, or the API should clearly document and separately gate baseline-only execution. A no-run plan should not silently run its metric scripts before reporting that no experiments were permitted.

## Impact

Users or automation can set `max_experiments: 0` expecting a disabled or inspection-only plan, yet still execute commands from the plan's metric definition. This creates surprising side effects, consumes runtime, and can execute untrusted plan commands despite a configuration that appears to prohibit running experiments.
