---
name: "Experiment loop agent cancellation leaves candidate changes unreset"
---

# Experiment loop agent cancellation leaves candidate changes unreset

## Summary

`@poe-code/experiment-loop` returns a successful `stopReason: "cancelled"` result when its in-flight agent throws an `AbortError`, but it does not reset candidate workspace mutations made before that cancellation. A cancelled experiment can therefore leave partial agent edits in the repository while reporting zero completed and zero kept experiments.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("experiment cancellation after an in-flight mutation", () => {
  it("returns cancelled without restoring candidate changes made before agent abort", async () => {
    const docPath = "/repo/.poe-code/experiments/cancelled.md";
    const candidatePath = "/repo/src/candidate.txt";
    const volume = Volume.fromJSON({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: tests",
        "  script: npm test",
        "  direction: maximize",
        "baseline: { tests: 1 }",
        "max_experiments: 1",
        "---",
        "Improve it"
      ].join("\n"),
      [candidatePath]: "original\n"
    });
    const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => {
        await fs.writeFile(candidatePath, "original\n");
      })
    };
    const abortError = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const runAgent = vi.fn(async (_input: AgentRunInput) => {
      await fs.writeFile(candidatePath, "changed before cancel\n");
      throw abortError;
    });

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      fs,
      git,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      runAgent
    });
    const candidate = await fs.readFile(candidatePath, "utf8");

    console.log(JSON.stringify({ result, candidate, resets: vi.mocked(git.reset).mock.calls }));
    expect(result.stopReason).toBe("cancelled");
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

The probe fails with the cancellation result and retained candidate edit:

```text
{"result":{"stopReason":"cancelled","docPath":"/repo/.poe-code/experiments/cancelled.md","experimentsCompleted":0,"experimentsKept":0,"totalDurationMs":5},"candidate":"changed before cancel\n","resets":[]}
AssertionError: expected "vi.fn()" to be called with arguments: [ 'base-1', '/repo' ]
```

## Observed Behavior

After `runAgent()` changes the candidate file and throws an `AbortError`, `runExperimentLoop()` returns `stopReason: "cancelled"`, reports no completed or kept experiment, and never calls `git.reset()`. The candidate file remains changed even though the run did not accept an experiment result.

In `packages/experiment-loop/src/run/loop.ts`, the candidate baseline hash is captured before agent execution. The `runAgent()` catch block recognizes an `AbortError` and immediately returns `finalize("cancelled")` before reaching the later branches that reset discarded or unjournaled iterations.

## Expected Behavior

When cancellation occurs after an experiment agent has begun candidate work, the loop should restore the pre-experiment baseline before returning a cancelled result, or otherwise clearly preserve and report the interrupted candidate as retained work. A result stating that zero experiments completed or were kept must not leave an unaccepted mutation applied.

## Impact

Cancelling an autonomous experiment can leave incomplete source changes in the user's workspace without a journal entry, keep count, or reset callback documenting them. Supervisors and users may treat the cancelled run as harmless while partial edits persist and affect subsequent builds, tests, or experiment attempts.
