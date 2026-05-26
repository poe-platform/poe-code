# Experiment loop negative max experiments is ignored and runs agent

## Summary

`@poe-code/experiment-loop` advertises `max_experiments` as a non-negative integer, but its frontmatter parser silently drops a configured negative value instead of rejecting the document. A plan containing `max_experiments: -1` therefore falls back to an unbounded runtime limit and begins executing autonomous agent iterations.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("invalid max_experiments frontmatter", () => {
  it("rejects a negative configured limit instead of omitting it and continuing", async () => {
    const docPath = "/repo/.poe-code/experiments/negative-limit.md";
    const journalPath = "/repo/.poe-code/experiments/negative-limit.journal.jsonl";
    const volume = Volume.fromJSON({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: tests",
        "  script: npm test",
        "  direction: maximize",
        "baseline: { tests: 1 }",
        "max_experiments: -1",
        "---",
        "Must not run",
      ].join("\n"),
    });
    const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => undefined),
    };
    const controller = new AbortController();
    const runAgent = vi.fn(async (_input: AgentRunInput) => {
      await fs.appendFile(
        journalPath,
        `${JSON.stringify({
          commit: "discard",
          status: "discard",
          output: "ran",
          agentOutput: "done",
          durationMs: 1,
          timestamp: "2026-05-25T00:00:00.000Z",
        })}\n`,
      );
      controller.abort();
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      fs,
      git,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      runAgent,
      signal: controller.signal,
    });

    console.log(JSON.stringify({ result, agentCalls: runAgent.mock.calls.length }));
    expect(runAgent).not.toHaveBeenCalled();
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The abort guard stops the otherwise unbounded run after its first unintended iteration:

```text
{"result":{"stopReason":"cancelled","docPath":"/repo/.poe-code/experiments/negative-limit.md","experimentsCompleted":1,"experimentsKept":0,"totalDurationMs":5},"agentCalls":1}
AssertionError: expected agent runner not to be called
```

## Observed Behavior

`parseNonNegativeInteger()` in `packages/experiment-loop/src/frontmatter/frontmatter.ts` returns `undefined` for negative values, and `parseExperimentFrontmatterData()` omits `max_experiments` from the normalized document rather than surfacing invalid configuration. Later, `validateMaxExperiments()` in `packages/experiment-loop/src/run/loop.ts` sees `undefined` and returns `Number.POSITIVE_INFINITY`, so the explicitly invalid limit becomes an unlimited run and the agent is invoked.

## Expected Behavior

An explicitly provided invalid `max_experiments` value should make the plan invalid before any autonomous work begins. It should not be silently omitted and converted into an unbounded default execution policy.

## Impact

A typo or malformed generated plan intended to constrain or disable iteration can instead start unlimited agent work. This reverses the safety implication of the invalid limit, potentially producing unbounded runtime and code-changing side effects until externally cancelled.
