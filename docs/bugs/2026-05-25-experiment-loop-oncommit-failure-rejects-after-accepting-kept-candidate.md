# Experiment loop onCommit failure rejects after accepting kept candidate

## Summary

`@poe-code/experiment-loop` invokes its optional `onCommit` observer after accepting a `keep` journal entry and advancing the active baseline. If that observer throws, the exported run rejects even though the candidate edit and persisted keep decision remain applied, leaving callers with a failure result for already accepted experiment progress.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("commit observer rejection", () => {
  it("rejects after accepting a keep entry without restoring the candidate", async () => {
    const docPath = "/repo/.poe-code/experiments/observer.md";
    const journalPath = "/repo/.poe-code/experiments/observer.journal.jsonl";
    const candidatePath = "/repo/src/candidate.txt";
    const fs = createFsFromVolume(Volume.fromJSON({
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
    })).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => fs.writeFile(candidatePath, "original\n"))
    };
    const runAgent = vi.fn(async (_input: AgentRunInput) => {
      await fs.writeFile(candidatePath, "kept candidate\n");
      await fs.appendFile(journalPath, `${JSON.stringify({
        commit: "keep-1", status: "keep", scores: { tests: 2 }, output: "better",
        agentOutput: "done", durationMs: 1, timestamp: "2026-05-25T00:00:00.000Z"
      })}\n`);
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(runExperimentLoop({
      cwd: "/repo", homeDir: "/home/user", docPath, fs, git,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })), runAgent,
      onCommit: () => { throw new Error("observer failed"); }
    })).rejects.toThrow("observer failed");

    const candidate = await fs.readFile(candidatePath, "utf8");
    console.log(JSON.stringify({ candidate, resets: vi.mocked(git.reset).mock.calls }));
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

The probe demonstrates that the observer failure rejects the run after the kept mutation remains present:

```text
{"candidate":"kept candidate\n","resets":[]}
AssertionError: expected "vi.fn()" to be called with arguments: [ 'base-1', '/repo' ]
```

## Observed Behavior

The agent records a successful `keep` entry and applies a candidate change. `runExperimentLoop()` then throws the `onCommit` observer error to its caller, while `git.reset()` is never invoked and the candidate file remains changed. The journal already contains the keep decision that caused baseline advancement.

In `packages/experiment-loop/src/run/loop.ts`, the `keep` branch increments `experimentsKept`, assigns `baselineHash` and `baseline`, and then invokes `options.onCommit?.(newEntry.commit)`. A thrown observer error escapes through the outer catch without compensating reset or a completed run result.

## Expected Behavior

Observer callback failures should not convert already accepted experiment progress into an ambiguous failed API outcome. The loop should either treat notifications as non-authoritative after state acceptance and return the successful result, or roll back the accepted candidate and journal/state transition before rejecting.

## Impact

Consumers that use `onCommit` for UI updates, telemetry, or bookkeeping can receive a rejected experiment run while source changes and accepted journal state remain in place. Retry logic may rerun work on top of an already-kept candidate, while monitoring and orchestration report the original successful improvement as a failure.
