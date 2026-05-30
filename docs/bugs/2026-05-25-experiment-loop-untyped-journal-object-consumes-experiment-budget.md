---
name: "Experiment loop untyped journal object consumes experiment budget"
---

# Experiment loop untyped journal object consumes experiment budget

## Summary

`@poe-code/experiment-loop` parses every JSON object line in an existing experiment journal as a completed `JournalEntry` without validating required fields. A journal containing only `{}` increments the restored completed-experiment count and can exhaust `maxExperiments`, preventing a valid planned experiment from running at all.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("malformed retained journal entries", () => {
  it("does not count an untyped object as a completed experiment", async () => {
    const docPath = "/repo/.poe-code/experiments/blocked-by-history.md";
    const journalPath = "/repo/.poe-code/experiments/blocked-by-history.journal.jsonl";
    const volume = Volume.fromJSON({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: tests",
        "  script: npm test",
        "  direction: maximize",
        "baseline: { tests: 1 }",
        "---",
        "Try one experiment",
      ].join("\n"),
      [journalPath]: "{}\n",
    });
    const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => undefined),
    };
    const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      runAgent,
    });

    console.log(JSON.stringify({ result, agentCalls: runAgent.mock.calls.length }));
    expect(runAgent).toHaveBeenCalledTimes(1);
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The probe fails because the untyped journal object is counted as the only allowed completed experiment:

```text
{"result":{"stopReason":"max_experiments","docPath":"/repo/.poe-code/experiments/blocked-by-history.md","experimentsCompleted":1,"experimentsKept":0,"totalDurationMs":7},"agentCalls":0}
AssertionError: expected agent runner to be called 1 time, but got 0 times
```

## Observed Behavior

`ExperimentJournal.readAll()` in `packages/experiment-loop/src/journal/journal.ts` returns `JSON.parse(line) as JournalEntry` for any syntactically valid JSON object, without checking `commit`, `status`, or other required fields. `deriveStateFromJournal()` in `packages/experiment-loop/src/run/loop.ts` sets `experimentsCompleted` to `entries.length`, so `{}` counts as a completed attempt. With `maxExperiments: 1`, the next loop immediately stops before invoking an agent.

## Expected Behavior

Only valid journal entries representing completed experiment attempts should contribute to restored execution counts. Invalid historical objects should be rejected with an actionable error or ignored safely rather than consuming the experiment budget.

## Impact

A corrupted, truncated, or manually edited journal file can silently disable future experiment execution while the loop reports that its configured budget is already exhausted. This prevents intended work from running and makes recovery difficult because the invalid historical object is not surfaced as an error.
