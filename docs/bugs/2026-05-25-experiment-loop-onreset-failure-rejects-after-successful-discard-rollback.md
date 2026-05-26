# Experiment loop onReset failure rejects after successful discard rollback

## Summary

`@poe-code/experiment-loop` invokes its optional `onReset` observer after it has successfully rolled back a discarded candidate. If that observer throws, the exported run rejects even though the candidate has already been restored and its discard journal entry remains persisted, replacing a completed discard outcome with an observer failure.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("reset observer rejection", () => {
  it("rejects after successfully resetting a discarded candidate", async () => {
    const docPath = "/repo/.poe-code/experiments/discard-observer.md";
    const journalPath = "/repo/.poe-code/experiments/discard-observer.journal.jsonl";
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
      await fs.writeFile(candidatePath, "discarded candidate\n");
      await fs.appendFile(journalPath, `${JSON.stringify({
        commit: "discard-1", status: "discard", output: "worse", agentOutput: "done",
        durationMs: 1, timestamp: "2026-05-25T00:00:00.000Z"
      })}\n`);
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(runExperimentLoop({
      cwd: "/repo", homeDir: "/home/user", docPath, fs, git,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })), runAgent,
      onReset: () => { throw new Error("reset observer failed"); }
    })).rejects.toThrow("reset observer failed");

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

The probe passes while showing that the run rejects only after rollback has already succeeded:

```text
{"candidate":"original\n","resets":[["base-1","/repo"]]}
✓ packages/experiment-loop/src/__probe__.test.ts > reset observer rejection > rejects after successfully resetting a discarded candidate
```

## Observed Behavior

The agent writes a discard entry and changes a candidate file. `runExperimentLoop()` invokes `git.reset("base-1", "/repo")`, restoring the original file, and then propagates the thrown `onReset` error instead of returning its normal completed result. The discard journal entry is already durable and the rollback has already been applied when the public promise rejects.

In `packages/experiment-loop/src/run/loop.ts`, the discard branch first awaits `git.reset(preExperimentHash, options.cwd)` and only afterward calls `options.onReset?.(preExperimentHash)`. A failure from that observer escapes the outer run without a result that reports the successfully completed discard iteration.

## Expected Behavior

Optional observer failures should not replace an already completed discard-and-rollback outcome with a failed experiment API result. The loop should report the successful discard state and surface observer diagnostics separately, or explicitly model notification failures without making callers infer whether rollback occurred.

## Impact

Telemetry, UI, or bookkeeping callbacks can make a correctly rolled-back experiment appear to have failed before completion. Retry logic and orchestration may rerun a discarded attempt or report inconsistent counters even though the journal and workspace already reflect a finished rollback.
