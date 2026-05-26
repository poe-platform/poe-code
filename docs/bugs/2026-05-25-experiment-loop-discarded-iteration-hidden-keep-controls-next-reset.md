# Experiment loop discarded iteration hidden keep controls next reset

## Summary

`@poe-code/experiment-loop` lets one agent iteration append multiple journal results but resolves only the final new entry for the current run. If the same iteration appends a `keep` entry followed by a `discard` entry, it is reset as discarded in that run, yet the hidden earlier `keep` is restored on the next invocation and becomes the baseline reset target.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("multiple journal results for one experiment", () => {
  it("does not restore a hidden keep from an iteration resolved as discard", async () => {
    const docPath = "/repo/.poe-code/experiments/multiple-results.md";
    const journalPath = "/repo/.poe-code/experiments/multiple-results.journal.jsonl";
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
        "Try experiments",
      ].join("\n"),
    });
    const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    const firstGit: ExperimentGit = {
      currentHash: vi.fn(async () => "original"),
      reset: vi.fn(async () => undefined),
    };

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git: firstGit,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      runAgent: vi.fn(async (_input: AgentRunInput) => {
        await fs.appendFile(journalPath, `${JSON.stringify({
          commit: "hidden-keep",
          status: "keep",
          scores: { tests: 2 },
          output: "keep",
          agentOutput: "done",
          durationMs: 1,
          timestamp: "2026-05-25T00:00:00.000Z",
        })}\n`);
        await fs.appendFile(journalPath, `${JSON.stringify({
          commit: "discarded",
          status: "discard",
          scores: { tests: 0 },
          output: "discard",
          agentOutput: "done",
          durationMs: 1,
          timestamp: "2026-05-25T00:00:01.000Z",
        })}\n`);
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    });
    expect(firstGit.reset).toHaveBeenCalledWith("original", "/repo");

    const secondGit: ExperimentGit = {
      currentHash: vi.fn(async () => "original"),
      reset: vi.fn(async () => undefined),
    };
    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 3,
      fs,
      git: secondGit,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      runAgent: vi.fn(async (_input: AgentRunInput) => {
        await fs.appendFile(journalPath, `${JSON.stringify({
          commit: "second-discard",
          status: "discard",
          output: "discard",
          agentOutput: "done",
          durationMs: 1,
          timestamp: "2026-05-25T00:00:02.000Z",
        })}\n`);
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    });

    console.log(JSON.stringify({
      secondCurrentHash: vi.mocked(secondGit.currentHash).mock.calls,
      secondReset: vi.mocked(secondGit.reset).mock.calls,
    }));
    expect(secondGit.reset).toHaveBeenCalledWith("original", "/repo");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The first run treats the final appended entry as a discard, but the second run restores the earlier hidden keep as its reset target:

```text
{"secondCurrentHash":[],"secondReset":[["hidden-keep","/repo"]]}
AssertionError: expected reset target "original", received "hidden-keep"
```

## Observed Behavior

After an agent iteration, `runExperimentLoop()` in `packages/experiment-loop/src/run/loop.ts` checks whether journal length increased and chooses only `journalAfter[journalAfter.length - 1]` as `newEntry`. Thus a final `discard` controls immediate handling and causes reset. On a later invocation, `deriveStateFromJournal()` scans all persisted entries and selects the last entry whose `status === "keep"`, including the earlier keep from that same discarded iteration. That keep supplies `baselineHash`, so a subsequent discard resets to a candidate commit that was already rejected and reset previously.

## Expected Behavior

Each experiment iteration should have one authoritative result, or multiple appended results should be validated and normalized consistently before persistence. An iteration resolved as discarded must not leave a concealed kept baseline that controls future recovery behavior.

## Impact

An agent or corrupted append sequence can make a rejected candidate reappear as authoritative experiment state after restart. Future discards may reset to already-discarded work instead of the true baseline, corrupting iteration history and Git recovery semantics across runs.
