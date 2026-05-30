---
name: "Experiment loop scoreless discard metric failure prevents rollback"
---

# Experiment loop scoreless discard metric failure prevents rollback

## Summary

`@poe-code/experiment-loop` evaluates configured metrics for every newly written journal entry that omits scores before it checks whether the agent already marked that entry as `discard`. If metric execution throws for a scoreless explicit discard, the run rejects before rolling back the candidate, leaving discarded changes applied in the workspace.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("scoreless discard metric failure", () => {
  it("resets an explicit discard even when metric collection fails", async () => {
    const docPath = "/repo/.poe-code/experiments/discard.md";
    const journalPath = docPath.replace(/\.md$/, ".journal.jsonl");
    const candidatePath = "/repo/src/candidate.txt";
    const fs = createFsFromVolume(Volume.fromJSON({
      [docPath]: [
        "---", "agent: claude-code", "metric:", "  name: tests", "  script: npm test", "  direction: maximize", "baseline: { tests: 1 }", "---", "Improve"
      ].join("\n"),
      [candidatePath]: "original\n"
    }, "/")).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => fs.writeFile(candidatePath, "original\n"))
    };
    const runAgent = vi.fn(async (_input: AgentRunInput) => {
      await fs.writeFile(candidatePath, "discarded candidate\n");
      await fs.appendFile(journalPath, `${JSON.stringify({
        commit: "discard-1", status: "discard", output: "discard", agentOutput: "done", durationMs: 1, timestamp: "2026-05-25T00:00:00.000Z"
      })}\n`);
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(runExperimentLoop({
      cwd: "/repo", homeDir: "/home/user", docPath, maxExperiments: 1, fs, git, runAgent,
      exec: vi.fn(async () => { throw new Error("metric runner unavailable"); })
    })).rejects.toThrow("metric runner unavailable");

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

The metric runner failure occurs before reset, leaving the explicitly discarded edit in place:

```text
{"candidate":"discarded candidate\n","resets":[]}
AssertionError: expected 'discarded candidate\n' to be 'original\n'
```

## Observed Behavior

After reading the agent's new journal entry, `runExperimentLoop()` in `packages/experiment-loop/src/run/loop.ts` enters its `if (newEntry && !newEntry.scores && metrics.length > 0)` block without first considering `newEntry.status`. It therefore awaits `evaluateChain()` for a scoreless `discard` entry. Only after that evaluation succeeds does the later `else` status branch call `git.reset(preExperimentHash, cwd)`. In the reproduction, the journal already records `status: "discard"`, but an injected metric execution exception exits the function before any reset.

## Expected Behavior

Once an agent explicitly discards its candidate, rollback should not depend on successful metric evaluation needed only to annotate or compare results. The loop should restore the baseline first, or at minimum guarantee rollback when optional scoring of a discarded attempt fails.

## Impact

Metric-runner outages, command launch errors, or infrastructure faults can cause a candidate that is durably recorded as discarded to remain applied in source files. This creates a direct contradiction between experiment history and worktree state, making retries unsafe and allowing rejected autonomous changes to affect later development or experiments.
