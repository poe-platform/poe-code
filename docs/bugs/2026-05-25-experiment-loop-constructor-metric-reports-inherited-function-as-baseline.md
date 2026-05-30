---
name: "Experiment loop constructor metric reports inherited function as baseline"
---

# Experiment loop constructor metric reports inherited function as baseline

## Summary

`@poe-code/experiment-loop` supports arbitrary metric names, but its prompt formatter reads baseline values through ordinary property lookup on a normal object. A valid metric named `constructor` with an empty configured baseline therefore appears to have a baseline equal to JavaScript's inherited `Object` constructor function.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("inherited experiment baseline names", () => {
  it("does not report an inherited constructor as a configured baseline score", async () => {
    const docPath = "/repo/.poe-code/experiments/constructor.md";
    const volume = Volume.fromJSON({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: constructor",
        "  script: npm test",
        "  direction: maximize",
        "baseline: {}",
        "---",
        "Improve score",
      ].join("\n"),
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
      maxExperiments: 1,
      fs,
      git,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      runAgent: vi.fn(async (input: AgentRunInput) => {
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
      }),
    });

    const metricLine = prompt.match(/- constructor:[^\n]*/)?.[0] ?? "";
    console.log(metricLine);
    expect(metricLine).not.toContain("baseline:");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The probe fails with an inherited function rendered as though it were a numeric configured baseline:

```text
- constructor: maximize, script: `npm test`, (baseline: function Object() { [native code] })
AssertionError: expected metric line not to contain 'baseline:'
```

## Observed Behavior

The parsed frontmatter contains a valid metric named `constructor` and `baseline: {}`. During prompt generation, `formatMetrics()` in `packages/experiment-loop/src/run/loop.ts` reads `baseline?.[m.name]` and includes any non-`undefined` result. Because `baseline` is a regular object, `baseline.constructor` resolves to the inherited `Object` constructor even though the plan defines no own baseline for that metric. The inherited function is then interpolated directly into the experiment instructions.

## Expected Behavior

Baseline lookup should use own configured score entries only. A metric without an own baseline value should not display a baseline, regardless of whether its name matches an inherited object property such as `constructor`.

## Impact

Experiment instructions can contain fabricated baseline values and non-numeric function text for otherwise valid metric names. This can mislead the agent about the starting constraint, corrupt human interpretation of generated prompts, and make metric behavior dependent on JavaScript object prototypes rather than the plan document.
