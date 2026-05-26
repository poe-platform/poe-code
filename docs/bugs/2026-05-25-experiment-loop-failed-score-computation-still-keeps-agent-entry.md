# Experiment loop failed score computation still keeps agent entry

## Summary

When an experiment agent logs a `keep` entry without scores, `@poe-code/experiment-loop` runs the configured metric evaluator to supply the missing scores. If that required metric evaluation fails, the loop nevertheless accepts the original `keep` entry, increments `experimentsKept`, and does not reset the candidate changes.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("failed scoring of an agent keep entry", () => {
  it("does not retain a keep entry when required metric evaluation fails", async () => {
    const docPath = "/repo/.poe-code/experiments/evaluate-keep.md";
    const volume = Volume.fromJSON({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: tests",
        "  script: npm test",
        "  direction: maximize",
        "baseline: { tests: 10 }",
        "---",
        "Improve tests",
      ].join("\n"),
    });
    const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => undefined),
    };
    const runAgent = vi.fn(async (_input: AgentRunInput) => {
      await fs.appendFile(
        docPath.replace(/\.md$/, ".journal.jsonl"),
        `${JSON.stringify({
          commit: "candidate",
          status: "keep",
          output: "candidate",
          agentOutput: "done",
          durationMs: 1,
          timestamp: "2026-05-25T00:00:00.000Z",
        })}\n`,
      );
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const exec = vi.fn(async () => ({
      stdout: "failed\n",
      stderr: "tests failed\n",
      exitCode: 1,
    }));

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec,
      runAgent,
    });

    console.log(JSON.stringify({
      result,
      resets: vi.mocked(git.reset).mock.calls,
      execCalls: exec.mock.calls,
    }));
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

The metric command fails, but the run still reports one kept experiment and never resets it:

```text
{"result":{"stopReason":"max_experiments","docPath":"/repo/.poe-code/experiments/evaluate-keep.md","experimentsCompleted":1,"experimentsKept":1,"totalDurationMs":6},"resets":[],"execCalls":[["npm test",{"cwd":"/repo","timeout":180000}]]}
AssertionError: expected experimentsKept to be 0, received 1
```

## Observed Behavior

After the agent writes a scoreless journal entry, `runExperimentLoop()` in `packages/experiment-loop/src/run/loop.ts` invokes `evaluateChain()` when metrics exist. It writes calculated scores only when `allMetricsPassed(...)` succeeds, but leaves `newEntry.status` unchanged when evaluation fails. The subsequent status branch accepts any existing `keep` entry, increments `experimentsKept`, updates `baselineHash` to the candidate commit, and skips `git.reset()` even though no required metric passed.

## Expected Behavior

If the loop performs required metric validation for a scoreless `keep` entry, failure to obtain passing metric results should prevent that candidate from being retained. The run should discard/reset the candidate or fail clearly rather than honoring an unvalidated keep result.

## Impact

An agent can request a keep without supplying scores, fail the system's own configured evaluation command, and still have its changes treated as accepted baseline state. This defeats measured experiment gating and lets failed candidates become the basis for subsequent iterations.
