---
name: "Experiment loop malformed journal score is reused as baseline text"
---

# Experiment loop malformed journal score is reused as baseline text

## Summary

`@poe-code/experiment-loop` reads prior kept journal entries without validating their `scores` shape, then reuses those values as the baseline for subsequent experiment prompts. A journal entry containing a string score such as `"not-a-number"` is treated as the current metric baseline and presented to the next autonomous agent iteration as though it were a valid numeric measurement.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("malformed journal score reuse", () => {
  it("does not render a string score from a prior keep as a numeric baseline", async () => {
    const docPath = "/repo/.poe-code/experiments/reuse.md";
    const journalPath = "/repo/.poe-code/experiments/reuse.journal.jsonl";
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
        "Improve tests",
      ].join("\n"),
      [journalPath]: `${JSON.stringify({
        commit: "bad",
        status: "keep",
        scores: { tests: "not-a-number" },
        output: "bad",
        agentOutput: "bad",
        durationMs: 1,
        timestamp: "2026-05-25T00:00:00.000Z",
      })}\n`,
    });
    const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => undefined),
    };
    let prompt = "";

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 2,
      fs,
      git,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      runAgent: vi.fn(async (input: AgentRunInput) => {
        prompt = input.prompt;
        await fs.appendFile(
          journalPath,
          `${JSON.stringify({
            commit: "next",
            status: "discard",
            output: "done",
            agentOutput: "done",
            durationMs: 1,
            timestamp: "2026-05-25T00:00:01.000Z",
          })}\n`,
        );
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    });

    const metricLine = prompt.match(/- tests:[^\n]*/)?.[0] ?? "";
    console.log(metricLine);
    expect(metricLine).not.toContain("not-a-number");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The probe fails because the malformed historical score is directly rendered as the next baseline:

```text
- tests: maximize, script: `npm test`, (baseline: not-a-number)
AssertionError: expected metric line not to contain 'not-a-number'
```

## Observed Behavior

`ExperimentJournal.readAll()` in `packages/experiment-loop/src/journal/journal.ts` casts parsed JSON lines to `JournalEntry` without validating fields. `deriveStateFromJournal()` in `packages/experiment-loop/src/run/loop.ts` selects the last `keep` entry and obtains its baseline through `baselineFromEntry()`, which simply returns `entry.scores`. The resulting malformed string value is then read by `formatMetrics()` and interpolated into the next agent prompt as a baseline.

## Expected Behavior

Stored journal score values should be validated as finite numeric metrics before they influence future experiment state or prompts. Malformed historical entries should be rejected, ignored, or surfaced clearly rather than silently becoming authoritative baseline text.

## Impact

Corrupted, manually edited, or agent-authored journal history can mislead all subsequent autonomous iterations about their baseline measurements. The loop may optimize against non-numeric state while displaying it as valid evidence, undermining experiment reproducibility and decision quality.
