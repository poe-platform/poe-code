---
name: "Experiment loop reset failure leaves discarded candidate applied"
---

# Experiment loop reset failure leaves discarded candidate applied

## Summary

`@poe-code/experiment-loop` accepts an agent-authored `discard` journal entry before it attempts to reset the candidate workspace. If `git.reset()` then fails, the run rejects while the persisted history says the experiment was discarded and the rejected candidate edits remain applied on disk.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("discard rollback failure", () => {
  it("persists a discarded decision while leaving the rejected candidate applied", async () => {
    const docPath = "/repo/.poe-code/experiments/reset-failure.md";
    const journalPath = "/repo/.poe-code/experiments/reset-failure.journal.jsonl";
    const candidatePath = "/repo/src/candidate.txt";
    const fs = createFsFromVolume(Volume.fromJSON({
      [docPath]: ["---", "agent: claude-code", "metric:", "  name: tests", "  script: npm test", "  direction: maximize", "baseline: { tests: 1 }", "max_experiments: 1", "---", "Improve it"].join("\n"),
      [candidatePath]: "original\n"
    })).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => { throw new Error("reset denied"); })
    };
    const runAgent = vi.fn(async (_input: AgentRunInput) => {
      await fs.writeFile(candidatePath, "discarded candidate\n");
      await fs.appendFile(journalPath, `${JSON.stringify({ commit: "discard-1", status: "discard", output: "worse", agentOutput: "done", durationMs: 1, timestamp: "2026-05-25T00:00:00.000Z" })}\n`);
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(runExperimentLoop({ cwd: "/repo", homeDir: "/home/user", docPath, fs, git, exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })), runAgent })).rejects.toThrow("reset denied");
    const candidate = await fs.readFile(candidatePath, "utf8");
    const journal = await fs.readFile(journalPath, "utf8");
    console.log(JSON.stringify({ candidate, journal }));
    expect(candidate).toBe("original\n");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The probe fails because the discard history persists while the rejected candidate file remains changed:

```text
{"candidate":"discarded candidate\n","journal":"{\"commit\":\"discard-1\",\"status\":\"discard\",...}\n"}
AssertionError: expected 'discarded candidate\n' to be 'original\n'
```

## Observed Behavior

The agent mutates a candidate file and appends a valid `discard` journal entry. `runExperimentLoop()` then calls the injected `git.reset()` implementation, which rejects with `reset denied`. The API rejects, but the journal still records the candidate as discarded while the workspace file retains `discarded candidate` rather than its pre-experiment contents.

In `packages/experiment-loop/src/run/loop.ts`, the loop obtains the newly appended journal entry before branching on `newEntry.status`. For a discard it then awaits `git.reset(preExperimentHash, options.cwd)`. There is no compensation or state marker when that rollback attempt fails after the agent has already persisted the discard outcome.

## Expected Behavior

A discarded experiment must not remain applied while durable history says it was rejected. If rollback cannot complete, the system should report and persist an explicit unresolved rollback state or avoid committing the discard decision as final until candidate restoration succeeds.

## Impact

Reset failures produce contradictory repository state: journal and orchestration consumers see a rejected experiment, while builds and later runs operate on its still-applied changes. Users may unknowingly ship or build upon edits that the experiment system already recorded as discarded.
