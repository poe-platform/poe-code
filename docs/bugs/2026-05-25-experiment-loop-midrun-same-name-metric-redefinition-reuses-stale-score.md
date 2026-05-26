# Experiment loop midrun same-name metric redefinition reuses stale score

## Summary

`@poe-code/experiment-loop` keys retained baseline values only by metric name while re-reading metric definitions before each iteration. If an accepted iteration rewrites a metric named `score` from one script and direction to a different objective with the same name, the next prompt reuses the previous objective's score as the new metric's baseline.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("same-named metric redefinition between iterations", () => {
  it("reuses the old metric score after its script and direction change", async () => {
    const docPath = "/repo/.poe-code/experiments/redefined-metric.md";
    const journalPath = "/repo/.poe-code/experiments/redefined-metric.journal.jsonl";
    const initialDoc = [
      "---", "agent: claude-code", "metric:", "  name: score", "  script: npm run quality", "  direction: maximize",
      "baseline: { score: 10 }", "max_experiments: 2", "---", "Improve it"
    ].join("\n");
    const changedDoc = [
      "---", "agent: claude-code", "metric:", "  name: score", "  script: npm run duration", "  direction: minimize",
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
        commit: `keep-${iteration}`, status: "keep", scores: { score: iteration === 1 ? 12 : 8 },
        output: "better", agentOutput: "done", durationMs: 1, timestamp: "2026-05-25T00:00:00.000Z"
      })}\n`);
      if (iteration === 1) await fs.writeFile(docPath, changedDoc);
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await runExperimentLoop({
      cwd: "/repo", homeDir: "/home/user", docPath, fs, git,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })), runAgent
    });
    console.log(JSON.stringify({ secondPrompt: prompts[1] }));
    expect(prompts[1]).not.toContain("npm run duration`, (baseline: 12)");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The probe fails because the previous quality score appears as the duration metric's baseline:

```text
{"secondPrompt":"Improve it\n\n## Metrics\n\n- score: minimize, script: `npm run duration`, (baseline: 12)\n..."}
AssertionError: expected second prompt not to contain `npm run duration`, (baseline: 12)`
```

## Observed Behavior

The first kept iteration uses `score` as a maximizing quality metric and records score `12`. It then updates the active document so `score` now means a minimizing duration metric and requests `baseline: null`. The second prompt displays `npm run duration` with `(baseline: 12)`, despite no duration baseline being measured and despite the score originating from a different script with opposite optimization semantics.

In `packages/experiment-loop/src/run/loop.ts`, a kept journal entry replaces `baseline` with its `scores` object. Subsequent prompts call `formatMetrics()` using the newly read metric definition but retrieve comparator values solely through `baseline?.[m.name]`. Metric identity is therefore reduced to the string name and does not account for changed script, direction, or tolerance settings.

## Expected Behavior

Changing a metric's script or comparison semantics should invalidate prior baseline scores even when its display name remains unchanged. The loop should collect a new baseline for the redefined objective or reject unsupported mid-run redefinition before agent work proceeds.

## Impact

A live experiment plan can silently compare unrelated measurements, such as treating a quality score as a duration target. Agents receive misleading objectives, and retained journal decisions mix incompatible measurements under one key, making optimization results and later auditing unreliable.
