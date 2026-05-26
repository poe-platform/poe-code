# Experiment loop infinite metric delta advertises unbounded tolerance

## Summary

`@poe-code/experiment-loop` accepts YAML `.inf` as a metric `delta` even though `delta` is a tolerance bound, and then forwards it into the generated agent instructions as `±Infinity`. A stable metric plan can therefore declare an unbounded tolerance that makes any finite regression appear permissible to the agent instead of being rejected as invalid configuration.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("non-finite experiment delta", () => {
  it("forwards an infinite stability tolerance into agent instructions", async () => {
    const docPath = "/repo/.poe-code/experiments/steady.md";
    const volume = Volume.fromJSON({
      [docPath]: [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: tests",
        "  script: npm test",
        "  direction: stable",
        "  delta: .inf",
        "baseline: { tests: 1 }",
        "---",
        "Keep tests stable",
      ].join("\n"),
    });
    const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => undefined),
    };
    let capturedPrompt = "";

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      runAgent: vi.fn(async (input: AgentRunInput) => {
        capturedPrompt = input.prompt;
        await fs.appendFile(
          docPath.replace(/\.md$/, ".journal.jsonl"),
          `${JSON.stringify({
            commit: "base-1",
            status: "discard",
            scores: { tests: 99 },
            output: "outside finite tolerance",
            agentOutput: "discarded",
            durationMs: 1,
            timestamp: "2026-05-25T00:00:00.000Z",
          })}\n`,
        );
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    });

    console.log(capturedPrompt.match(/tests: stable[^\n]*/)?.[0]);
    expect(capturedPrompt).not.toContain("±Infinity");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The probe logs the generated metric instruction and fails:

```text
tests: stable, ±Infinity, script: `npm test`, (baseline: 1)
AssertionError: expected prompt not to contain '±Infinity'
```

## Observed Behavior

`parseExperimentFrontmatterData()` accepts `delta` whenever it is a number greater than or equal to zero in `packages/experiment-loop/src/frontmatter/frontmatter.ts`, without requiring `Number.isFinite(delta)`. YAML parses `.inf` as `Infinity`, so the metric is retained with `delta: Infinity`. During a real `runExperimentLoop()` iteration, `formatMetrics()` in `packages/experiment-loop/src/run/loop.ts` interpolates that value directly into the agent prompt as `±Infinity`.

## Expected Behavior

Metric tolerance configuration should accept only finite non-negative values. A non-finite `delta` should be rejected or omitted before a run starts, rather than becoming an unbounded tolerance in the agent-facing experiment contract.

## Impact

A malformed or generated experiment plan can silently disable the practical meaning of a `stable` tolerance by telling the agent that arbitrarily large finite changes are acceptable. This undermines regression safeguards and may cause changes to be proposed or logged under a plan whose configured quality constraint is effectively unbounded.
