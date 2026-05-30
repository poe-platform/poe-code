---
name: "Experiment loop empty metric chain runs agent without objective"
---

# Experiment loop empty metric chain runs agent without objective

## Summary

`@poe-code/experiment-loop` permits an experiment document with `metric: []` and proceeds to launch an autonomous agent iteration with an empty Metrics section. An experiment can therefore make changes and log keep/discard state without any configured objective metric, rather than being rejected as an invalid plan.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("empty experiment metric chain", () => {
  it("does not run an agent when the plan defines no metrics", async () => {
    const docPath = "/repo/.poe-code/experiments/no-metrics.md";
    const volume = Volume.fromJSON({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric: []",
        "baseline: {}",
        "---",
        "No objective metric",
      ].join("\n"),
    });
    const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => undefined),
    };
    let prompt = "";
    const runAgent = vi.fn(async (input: AgentRunInput) => {
      prompt = input.prompt;
      await fs.appendFile(
        docPath.replace(/\.md$/, ".journal.jsonl"),
        `${JSON.stringify({
          commit: "base-1",
          status: "discard",
          output: "done",
          agentOutput: "done",
          durationMs: 1,
          timestamp: "2026-05-25T00:00:00.000Z",
        })}\n`,
      );
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const result = await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      runAgent,
    });

    console.log(JSON.stringify({
      result,
      agentCalls: runAgent.mock.calls.length,
      metricsBlock: prompt.split("## Journal")[0],
    }));
    expect(runAgent).not.toHaveBeenCalled();
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The probe fails because an agent iteration is launched with a blank metric section:

```text
{"result":{"stopReason":"max_experiments","docPath":"/repo/.poe-code/experiments/no-metrics.md","experimentsCompleted":1,"experimentsKept":0,"totalDurationMs":6},"agentCalls":1,"metricsBlock":"No objective metric\n\n## Metrics\n\n\n\n"}
AssertionError: expected agent runner not to be called
```

## Observed Behavior

`parseMetric()` in `packages/experiment-loop/src/frontmatter/frontmatter.ts` accepts an empty array because it maps and validates zero entries, then returns `[]`. In `packages/experiment-loop/src/run/loop.ts`, `normalizeMetrics()` rejects only falsy values; an empty array is truthy and is returned unchanged. Prompt generation formats no metric lines, but `runExperimentLoop()` still invokes the autonomous agent runner and counts a completed experiment iteration.

## Expected Behavior

An experiment plan should require at least one objective metric before it may launch an agent iteration. Empty metric arrays should be rejected during parsing or runtime normalization rather than producing an executable experiment with no success criterion.

## Impact

A malformed plan can run autonomous code-changing work without any configured measurement or acceptance signal. The agent is instructed to commit and journal work while the Metrics section is empty, undermining the purpose of an experiment loop and allowing unmeasured changes to execute under an apparently valid experiment document.
