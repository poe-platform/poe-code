---
name: "Experiment loop agent error leaves partial candidate edits unreset"
---

# Experiment loop agent error leaves partial candidate edits unreset

## Summary

`@poe-code/experiment-loop` propagates a non-cancellation exception thrown by an in-flight experiment agent, but does not restore candidate workspace mutations the agent made before failing. A crashed or unavailable agent can therefore reject the run while leaving partial unjournaled edits applied in the repository.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("experiment agent failure after mutation", () => {
  it("restores candidate changes before rejecting an agent error", async () => {
    const docPath = "/repo/.poe-code/experiments/fail.md";
    const candidatePath = "/repo/src/candidate.txt";
    const fs = createFsFromVolume(Volume.fromJSON({
      [docPath]: ["---", "agent: claude-code", "metric: []", "---", "Improve"].join("\n"),
      [candidatePath]: "original\n"
    }, "/")).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => fs.writeFile(candidatePath, "original\n"))
    };
    const runAgent = vi.fn(async (_input: AgentRunInput) => {
      await fs.writeFile(candidatePath, "partial agent edit\n");
      throw new Error("agent crashed");
    });

    await expect(runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      runAgent
    })).rejects.toThrow("agent crashed");

    const candidate = await fs.readFile(candidatePath, "utf8");
    console.log(JSON.stringify({ candidate, resets: vi.mocked(git.reset).mock.calls }));
    expect(candidate).toBe("original\n");
    expect(git.reset).toHaveBeenCalledWith("base-1", "/repo");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The agent error propagates while its partial edit remains in place and no reset occurs:

```text
{"candidate":"partial agent edit\n","resets":[]}
AssertionError: expected 'partial agent edit\n' to be 'original\n'
```

## Observed Behavior

During each iteration, `runExperimentLoop()` in `packages/experiment-loop/src/run/loop.ts` captures the baseline Git hash before awaiting `runAgent()`. Its surrounding `catch` branch handles only `AbortError` specially; all other agent exceptions are immediately rethrown. The `git.reset(preExperimentHash, cwd)` recovery calls exist only after a completed agent run when a discard or missing journal entry is processed. In the reproduction, `runAgent()` modifies a candidate file and throws before writing a journal entry, so the function rejects with `"agent crashed"` and never attempts rollback.

## Expected Behavior

If an experiment agent fails after it may have changed the candidate workspace, the loop should restore the pre-experiment baseline before rejecting, or explicitly provide a durable unresolved-recovery state. A thrown agent exception must not silently leave partial unvalidated changes applied.

## Impact

Agent runtime crashes, provider outages, tool errors, or other rejected experiment executions can leave the repository dirty with incomplete candidate edits even though the experiment reports failure and records no accepted result. Subsequent runs, reviews, or local development may unknowingly build on abandoned autonomous changes, undermining rollback safety and experiment reproducibility.
