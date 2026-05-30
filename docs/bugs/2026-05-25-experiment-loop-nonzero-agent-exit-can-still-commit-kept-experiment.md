---
name: "Experiment loop nonzero agent exit can still commit kept experiment"
---

# Experiment loop nonzero agent exit can still commit kept experiment

## Summary

The exported `@poe-code/experiment-loop` `runExperimentLoop()` API awaits its configured `runAgent()` callback but does not inspect the returned process `exitCode`. If an agent writes a `keep` journal entry and then returns `{ exitCode: 1 }`, the loop still counts the experiment as kept, advances its baseline commit, and does not reset the failed attempt.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runExperimentLoop } from "./run/loop.js";
import type { ExperimentFileSystem, ExperimentGit, JournalEntry } from "./types.js";

function createFs(files: Record<string, string>): ExperimentFileSystem {
  return createFsFromVolume(Volume.fromJSON(files, "/")).promises as unknown as ExperimentFileSystem;
}

describe("experiment-loop nonzero agent exit with keep journal", () => {
  it("does not keep an experiment after the agent process reports failure", async () => {
    const docPath = "/repo/.poe-code/experiments/probe.md";
    const journalPath = "/repo/.poe-code/experiments/probe.journal.jsonl";
    const fs = createFs({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: tests",
        "  script: node scripts/metric-tests.mjs",
        "  direction: maximize",
        "baseline: { tests: 1 }",
        "---",
        "# Improve tests"
      ].join("\n")
    });
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => undefined)
    };

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      runAgent: vi.fn(async () => {
        const entry: JournalEntry = {
          commit: "bad-commit",
          status: "keep",
          scores: { tests: 2 },
          output: "tests improved",
          agentOutput: "failed after writing journal",
          durationMs: 10,
          timestamp: "2026-05-25T00:00:00.000Z"
        };
        await fs.appendFile(journalPath, `${JSON.stringify(entry)}\n`);
        return { stdout: "", stderr: "agent crashed", exitCode: 1 };
      })
    });

    console.log(JSON.stringify({ result, resets: (git.reset as ReturnType<typeof vi.fn>).mock.calls }));
    expect(result.experimentsKept).toBe(0);
    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The probe logs a kept failed experiment and fails:

```text
{"result":{"stopReason":"max_experiments","docPath":"/repo/.poe-code/experiments/probe.md","experimentsCompleted":1,"experimentsKept":1,"totalDurationMs":5},"resets":[]}
AssertionError: expected 1 to be +0 // Object.is equality
```

## Observed Behavior

`packages/experiment-loop/src/index.ts` publicly exports `runExperimentLoop()`. In `packages/experiment-loop/src/run/loop.ts`, each attempt executes `await runAgent(...)` inside a `try` block, but the returned `AgentRunResult` is discarded and no check is made for `exitCode !== 0`. The function then reads the newly appended journal entry and, when its status is `"keep"`, increments `experimentsKept`, assigns its commit as the new baseline, and invokes commit callbacks even though the agent callback explicitly reported failure.

## Expected Behavior

A nonzero agent process exit should mark the attempt as failed or discarded, prevent a newly written `keep` entry from being accepted as successful progress, and restore the pre-experiment baseline as appropriate. A failed agent run must not advance experiment state merely because it wrote journal data before failing.

## Impact

An agent process that crashes after partially executing or writing stale/malicious journal state can cause a failed experiment to be recorded as an improvement. Subsequent experiments then build from an invalid baseline commit, summary counters overstate successful progress, and users may preserve broken repository state under the false impression that the experiment completed successfully.
