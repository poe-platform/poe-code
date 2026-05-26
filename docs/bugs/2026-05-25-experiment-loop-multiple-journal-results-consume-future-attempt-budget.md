# Experiment loop multiple journal results consume future attempt budget

## Summary

`@poe-code/experiment-loop` increments its in-memory completed count once per agent iteration, but restores completed attempts on subsequent runs by counting every persisted journal line. If a single iteration appends two result entries, it consumes two restored experiment slots and can prevent the next permitted agent iteration from ever running.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("multiple journal lines per experiment budget", () => {
  it("counts one agent iteration once even if it appends two results", async () => {
    const docPath = "/repo/.poe-code/experiments/count.md";
    const journalPath = "/repo/.poe-code/experiments/count.journal.jsonl";
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
        "Run two experiments",
      ].join("\n"),
    });
    const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "original"),
      reset: vi.fn(async () => undefined),
    };
    let calls = 0;
    const runAgent = vi.fn(async (_input: AgentRunInput) => {
      calls += 1;
      if (calls === 1) {
        await fs.appendFile(journalPath, `${JSON.stringify({
          commit: "discard-one",
          status: "discard",
          output: "one",
          agentOutput: "done",
          durationMs: 1,
          timestamp: "2026-05-25T00:00:00.000Z",
        })}\n`);
        await fs.appendFile(journalPath, `${JSON.stringify({
          commit: "discard-two",
          status: "discard",
          output: "two",
          agentOutput: "done",
          durationMs: 1,
          timestamp: "2026-05-25T00:00:01.000Z",
        })}\n`);
      } else {
        await fs.appendFile(journalPath, `${JSON.stringify({
          commit: "second",
          status: "discard",
          output: "second",
          agentOutput: "done",
          durationMs: 1,
          timestamp: "2026-05-25T00:00:02.000Z",
        })}\n`);
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const first = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      runAgent,
    });
    const second = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 2,
      fs,
      git,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      runAgent,
    });

    console.log(JSON.stringify({ first, second, calls: runAgent.mock.calls.length }));
    expect(runAgent).toHaveBeenCalledTimes(2);
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

Only one agent invocation occurs, but the resumed run considers two experiment slots consumed:

```text
{"first":{"stopReason":"max_experiments","docPath":"/repo/.poe-code/experiments/count.md","experimentsCompleted":1,"experimentsKept":0,"totalDurationMs":6},"second":{"stopReason":"max_experiments","docPath":"/repo/.poe-code/experiments/count.md","experimentsCompleted":2,"experimentsKept":0,"totalDurationMs":1},"calls":1}
AssertionError: expected agent runner to be called 2 times, but got 1 time
```

## Observed Behavior

Within a live invocation, `runExperimentLoop()` increments `experimentsCompleted` once after `runAgent()` returns, regardless of how many entries were appended. On restart, `deriveStateFromJournal()` sets `experimentsCompleted: entries.length`, treating each journal result line as a separate attempt. One agent call that appends two entries therefore restores as two completed experiments, causing a later run with `maxExperiments: 2` to stop immediately.

## Expected Behavior

Persisted history should represent experiment attempts consistently with live accounting. Either only one authoritative result may be appended per iteration, or journal records must include enough identity to count multiple result writes from one iteration as one attempted experiment.

## Impact

An agent, duplicated command invocation, or append race can prematurely exhaust future experiment budgets without actually performing the allowed number of iterations. Subsequent runs silently skip work while reporting completed counts that exceed the number of autonomous attempts performed.
