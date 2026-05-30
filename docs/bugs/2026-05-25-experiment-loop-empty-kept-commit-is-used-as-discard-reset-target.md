---
name: "Experiment loop empty kept commit is used as discard reset target"
---

# Experiment loop empty kept commit is used as discard reset target

## Summary

`@poe-code/experiment-loop` restores its baseline Git target directly from the latest historical `keep` journal entry without validating the entry's `commit` field. If a prior kept entry contains `commit: ""`, a later discarded experiment invokes `git.reset("", cwd)` instead of falling back to the actual repository head or rejecting the invalid history.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("malformed retained keep commit", () => {
  it("does not reset a later discard to an empty journal commit id", async () => {
    const docPath = "/repo/.poe-code/experiments/empty-commit.md";
    const journalPath = "/repo/.poe-code/experiments/empty-commit.journal.jsonl";
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
        "Try another experiment",
      ].join("\n"),
      [journalPath]: `${JSON.stringify({
        commit: "",
        status: "keep",
        scores: { tests: 1 },
        output: "old",
        agentOutput: "old",
        durationMs: 1,
        timestamp: "2026-05-25T00:00:00.000Z",
      })}\n`,
    });
    const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "real-head"),
      reset: vi.fn(async () => undefined),
    };

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 2,
      fs,
      git,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      runAgent: vi.fn(async (_input: AgentRunInput) => {
        await fs.appendFile(
          journalPath,
          `${JSON.stringify({
            commit: "candidate",
            status: "discard",
            output: "discard",
            agentOutput: "done",
            durationMs: 1,
            timestamp: "2026-05-25T00:00:01.000Z",
          })}\n`,
        );
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    });

    console.log(JSON.stringify({
      currentHashCalls: vi.mocked(git.currentHash).mock.calls,
      resetCalls: vi.mocked(git.reset).mock.calls,
    }));
    expect(git.reset).not.toHaveBeenCalledWith("", "/repo");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The probe fails because the invalid historical value is used as the reset target without consulting the current repository hash:

```text
{"currentHashCalls":[],"resetCalls":[["","/repo"]]}
AssertionError: expected git.reset not to be called with ""
```

## Observed Behavior

`ExperimentJournal.readAll()` in `packages/experiment-loop/src/journal/journal.ts` does not validate parsed journal fields. `deriveStateFromJournal()` in `packages/experiment-loop/src/run/loop.ts` assigns `baselineHash: lastKeep?.commit`, so an empty string is treated as restored baseline state. During the next experiment iteration, `baselineHash ??= await git.currentHash(...)` does not replace an empty string because only `null` or `undefined` trigger the fallback. When that iteration is discarded, the loop calls `git.reset(preExperimentHash, cwd)` with `preExperimentHash === ""`.

## Expected Behavior

Historical kept commit identifiers should be validated before they control Git reset behavior. An empty or otherwise invalid commit value should be rejected or ignored in favor of a known valid repository hash, never passed to the reset implementation as an authoritative target.

## Impact

Malformed journal history can cause discard recovery to invoke Git operations with an invalid target rather than restoring a known baseline. In a real execution this can fail after the agent has already modified the worktree, leaving candidate changes unrecovered and the experiment state inconsistent.
