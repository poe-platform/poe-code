---
name: "Experiment loop midrun metric change runs without new baseline"
---

# Experiment loop midrun metric change runs without new baseline

## Summary

`@poe-code/experiment-loop` deliberately re-reads an experiment document before each iteration, allowing its configured metric to change while a run is active. When a retained first experiment rewrites the plan from one metric to a different metric with `baseline: null`, the second autonomous iteration starts without first measuring a baseline for the new metric.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("metric change between experiments", () => {
  it("runs a newly configured metric without establishing its baseline", async () => {
    const docPath = "/repo/.poe-code/experiments/metric-swap.md";
    const journalPath = "/repo/.poe-code/experiments/metric-swap.journal.jsonl";
    const initialDoc = [
      "---", "agent: claude-code", "metric:", "  name: tests", "  script: npm test", "  direction: maximize",
      "baseline: { tests: 1 }", "max_experiments: 2", "---", "Improve it"
    ].join("\n");
    const changedDoc = [
      "---", "agent: claude-code", "metric:", "  name: duration", "  script: npm run duration", "  direction: minimize",
      "baseline: null", "max_experiments: 2", "---", "Improve it"
    ].join("\n");
    const fs = createFsFromVolume(Volume.fromJSON({ [docPath]: initialDoc })).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = { currentHash: vi.fn(async () => "base-1"), reset: vi.fn(async () => undefined) };
    const prompts: string[] = [];
    let iteration = 0;
    const runAgent = vi.fn(async (input: AgentRunInput) => {
      prompts.push(input.prompt);
      iteration += 1;
      await fs.appendFile(journalPath, `${JSON.stringify({
        commit: `keep-${iteration}`, status: "keep", scores: iteration === 1 ? { tests: 2 } : { duration: 5 },
        output: "better", agentOutput: "done", durationMs: 1, timestamp: "2026-05-25T00:00:00.000Z"
      })}\n`);
      if (iteration === 1) await fs.writeFile(docPath, changedDoc);
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const result = await runExperimentLoop({
      cwd: "/repo", homeDir: "/home/user", docPath, fs, git,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })), runAgent
    });
    console.log(JSON.stringify({ result, secondPrompt: prompts[1] }));
    expect(prompts[1]).toContain("- duration: minimize, script: `npm run duration`, (baseline:");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The probe fails because the second prompt contains the new metric with no measured baseline:

```text
{"result":{"stopReason":"max_experiments","docPath":"/repo/.poe-code/experiments/metric-swap.md","experimentsCompleted":2,"experimentsKept":2,"totalDurationMs":6},"secondPrompt":"Improve it\n\n## Metrics\n\n- duration: minimize, script: `npm run duration`\n..."}
AssertionError: expected second prompt to contain a baseline for `duration`
```

## Observed Behavior

The first iteration is kept under the original `tests` metric. That agent rewrites the active document to define a different `duration` metric and explicitly set `baseline: null`. `runExperimentLoop()` re-reads and uses the updated metric in the second prompt, but it does not execute `npm run duration` to establish the requested new baseline before launching the second agent iteration. The run even accepts a second `keep` entry under the new metric.

In `packages/experiment-loop/src/run/loop.ts`, initial baseline evaluation occurs only once before the `while` loop using `initialFrontmatter.metric`. Inside the loop, `readDoc()` and `normalizeMetrics(frontmatter.metric)` consume updated plan contents on every iteration, but no corresponding baseline initialization occurs when the freshly read metric set or `baseline` declaration changes.

## Expected Behavior

If a re-read experiment plan changes the active metric definition to one requiring a new baseline, the loop should establish that baseline before any agent is asked to optimize the new objective, or reject unsupported mid-run metric reconfiguration clearly. It must not accept experiments against an unmeasured comparator.

## Impact

Agents or users can update experiment objectives during a live run, after which later iterations perform code-changing work under a metric with no valid starting measurement. The resulting keep decisions and journal history combine incompatible objectives and make optimization progress impossible to interpret reliably.
