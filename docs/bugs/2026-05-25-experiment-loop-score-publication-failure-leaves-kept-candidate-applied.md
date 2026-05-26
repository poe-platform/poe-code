# Experiment loop score publication failure leaves kept candidate applied

## Summary

`@poe-code/experiment-loop` evaluates a scoreless agent-authored `keep` entry and obtains passing metric results, but rewrites the journal with those computed scores before it performs any keep/discard handling. If that journal write fails, the public run rejects without restoring the candidate worktree changes, leaving an unrecorded accepted-looking candidate applied even though its validated score was never published.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("computed score journal persistence failure", () => {
  it("restores candidate changes when score publication fails", async () => {
    const docPath = "/repo/.poe-code/experiments/score-write.md";
    const journalPath = docPath.replace(/\.md$/, ".journal.jsonl");
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
        "---",
        "Improve tests"
      ].join("\n"),
      [candidatePath]: "original\n"
    });
    const baseFs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    let journalWrites = 0;
    const fs: ExperimentFileSystem = {
      ...baseFs,
      async writeFile(path: string, content: string) {
        if (path === journalPath) {
          journalWrites += 1;
          if (journalWrites === 2) {
            throw new Error("disk full publishing scores");
          }
        }
        await baseFs.writeFile(path, content);
      }
    };
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => {
        await baseFs.writeFile(candidatePath, "original\n");
      })
    };
    const runAgent = vi.fn(async (_input: AgentRunInput) => {
      await baseFs.writeFile(candidatePath, "kept candidate\n");
      await baseFs.appendFile(
        journalPath,
        `${JSON.stringify({
          commit: "candidate-1",
          status: "keep",
          output: "candidate",
          agentOutput: "done",
          durationMs: 1,
          timestamp: "2026-05-25T00:00:00.000Z"
        })}\n`
      );
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(
      runExperimentLoop({
        cwd: "/repo",
        homeDir: "/home/user",
        docPath,
        maxExperiments: 1,
        fs,
        git,
        exec: vi.fn(async () => ({ stdout: "2\n", stderr: "", exitCode: 0 })),
        runAgent
      })
    ).rejects.toThrow("disk full publishing scores");

    const candidate = await baseFs.readFile(candidatePath, "utf8");
    const journal = await baseFs.readFile(journalPath, "utf8");
    console.log(JSON.stringify({ candidate, journal, resets: vi.mocked(git.reset).mock.calls }));
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

The metric succeeds, the journal rewrite fails, and the candidate edit remains applied without any reset:

```text
{"candidate":"kept candidate\n","journal":"{\"commit\":\"candidate-1\",\"status\":\"keep\",\"output\":\"candidate\",\"agentOutput\":\"done\",\"durationMs\":1,\"timestamp\":\"2026-05-25T00:00:00.000Z\"}\n","resets":[]}
AssertionError: expected 'kept candidate\n' to be 'original\n'
```

## Observed Behavior

After the agent applies the candidate and appends a scoreless `keep` record, `runExperimentLoop()` in `packages/experiment-loop/src/run/loop.ts` obtains passing results from `evaluateChain()`, then immediately awaits `journal.updateLast({ scores })`. `ExperimentJournal.updateLast()` in `packages/experiment-loop/src/journal/journal.ts` performs a full `writeFile()` replacement of the journal. When that publication write rejects, execution exits before the `newEntry.status === "keep"` branch or any `git.reset()` recovery path runs. The original scoreless `keep` line remains durable, while the candidate file remains modified.

## Expected Behavior

A failure to persist system-computed scores must not leave candidate changes applied in an unresolved state. The loop should roll back the candidate before rejecting, or otherwise make durable state explicitly reflect that score publication and acceptance did not complete.

## Impact

A transient filesystem or storage failure while publishing verified scores can leave autonomous code changes in the workspace even though the run failed and the journal does not contain the validation evidence required for acceptance. Subsequent execution or human inspection can encounter an applied candidate paired with incomplete experiment history, undermining rollback safety and reproducibility.
