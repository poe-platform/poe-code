---
name: "Experiment loop duplicate metric names collapse baseline results"
---

# Experiment loop duplicate metric names collapse baseline results

## Summary

`@poe-code/experiment-loop` accepts a metric chain containing multiple metrics with the same `name`, then stores measured baseline scores in a plain object keyed only by that name. Two distinct metric executions therefore collapse into one baseline entry, with the later score overwriting the earlier result before any experiment iteration begins.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("duplicate experiment metric names", () => {
  it("does not collapse two distinct baseline measurements onto one name", async () => {
    const docPath = "/repo/.poe-code/experiments/duplicate.md";
    const volume = Volume.fromJSON({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  - name: score",
        "    script: node one.mjs",
        "    direction: maximize",
        "  - name: score",
        "    script: node two.mjs",
        "    direction: minimize",
        "baseline: null",
        "max_experiments: 0",
        "---",
        "Measure baselines",
      ].join("\n"),
    });
    const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => undefined),
    };
    let baseline: Record<string, number> | undefined;
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "10\n", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "20\n", stderr: "", exitCode: 0 });

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      fs,
      git,
      exec,
      runAgent: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      onBaselineCollected(value) {
        baseline = value;
      },
    });

    console.log(JSON.stringify(baseline));
    expect(Object.keys(baseline ?? {})).toHaveLength(2);
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The probe fails after both metrics execute successfully, because only the second result remains in the collected baseline:

```text
{"score":20}
AssertionError: expected [ 'score' ] to have a length of 2 but got 1
```

## Observed Behavior

The frontmatter parser retains both valid metric definitions even though their `name` fields are identical. When `baseline` is `null`, `runExperimentLoop()` evaluates both metrics and calls `baselineFromResults()` in `packages/experiment-loop/src/run/loop.ts`, which creates entries as `[metric.name, score]` and passes them to `Object.fromEntries(...)`. Repeated metric names overwrite prior scores, so `10` from `node one.mjs` is silently replaced by `20` from `node two.mjs`.

## Expected Behavior

A metric chain should require unique metric names before evaluation, or preserve each metric result under an unambiguous identity. Distinct executed metrics should not silently collapse into one baseline field simply because the plan repeats a name.

## Impact

Experiment plans with duplicated metric names can lose measured baseline data and subsequently reason against the wrong constraint set. One metric's result disappears from callbacks, journal-derived baselines, and future prompts, making optimization decisions and regression checks unreliable without any configuration error.
