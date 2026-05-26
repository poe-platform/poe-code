# Experiment loop onMetricResult failure leaves unvalidated keep applied

## Summary

`@poe-code/experiment-loop` evaluates metrics for an agent-authored `keep` journal entry that omits scores, but invokes the optional `onMetricResult` observer while that validation is still in progress. If the observer throws, the run rejects before either attaching scores or rolling back the candidate, leaving an unvalidated kept edit applied in the workspace.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("metric observer rejection after candidate mutation", () => {
  it("rejects before rolling back an unevaluated candidate", async () => {
    const docPath = "/repo/.poe-code/experiments/metric-observer.md";
    const journalPath = "/repo/.poe-code/experiments/metric-observer.journal.jsonl";
    const candidatePath = "/repo/src/candidate.txt";
    const fs = createFsFromVolume(Volume.fromJSON({
      [docPath]: [
        "---", "agent: claude-code", "metric:", "  name: tests", "  script: npm test", "  direction: maximize",
        "baseline: { tests: 1 }", "max_experiments: 1", "---", "Improve it"
      ].join("\n"),
      [candidatePath]: "original\n"
    })).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => fs.writeFile(candidatePath, "original\n"))
    };
    const runAgent = vi.fn(async (_input: AgentRunInput) => {
      await fs.writeFile(candidatePath, "unscored candidate\n");
      await fs.appendFile(journalPath, `${JSON.stringify({
        commit: "keep-1", status: "keep", output: "candidate", agentOutput: "done",
        durationMs: 1, timestamp: "2026-05-25T00:00:00.000Z"
      })}\n`);
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(runExperimentLoop({
      cwd: "/repo", homeDir: "/home/user", docPath, fs, git,
      exec: vi.fn(async () => ({ stdout: "2\n", stderr: "", exitCode: 0 })), runAgent,
      onMetricResult: () => { throw new Error("metric observer failed"); }
    })).rejects.toThrow("metric observer failed");

    const candidate = await fs.readFile(candidatePath, "utf8");
    console.log(JSON.stringify({ candidate, resets: vi.mocked(git.reset).mock.calls, journal: await fs.readFile(journalPath, "utf8") }));
    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");
    expect(candidate).toBe("original\n");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The probe fails because the unscored keep remains in both workspace and journal after the callback error:

```text
{"candidate":"unscored candidate\n","resets":[],"journal":"{\"commit\":\"keep-1\",\"status\":\"keep\",\"output\":\"candidate\",...}\n"}
AssertionError: expected "vi.fn()" to be called with arguments: [ 'base-1', '/repo' ]
```

## Observed Behavior

The agent modifies a candidate file and records `status: "keep"` without scores. The metric executor obtains a passing score, but `onMetricResult` throws while results are being processed. `runExperimentLoop()` propagates that observer failure without calling `git.reset()`, without adding measured scores to the journal entry, and without returning a completed result. The unvalidated candidate edit remains applied.

In `packages/experiment-loop/src/run/loop.ts`, scoreless entries enter `evaluateChain(...)` before the subsequent keep/discard handling and reset branches. Since `options.onMetricResult` is passed directly into that evaluation, a thrown observer error aborts control flow before `journal.updateLast({ scores })` or any rollback path runs.

## Expected Behavior

An optional metric-result observer must not interrupt required candidate validation in a way that strands unvalidated changes. The loop should finish validation and either accept or reset the candidate independently of observer reporting, or compensate by resetting before rejecting.

## Impact

UI, telemetry, or logging callbacks can cause an experiment run to fail while leaving source edits that were never validated or recorded with metric scores. Subsequent runs can encounter a persisted `keep` entry lacking required evidence and a dirty workspace whose apparent acceptance does not match the rejected API result.
