---
name: "Experiment loop wrong document kind still runs agent"
---

# Experiment loop wrong document kind still runs agent

## Summary

`@poe-code/experiment-loop` exports a document schema that requires `kind: experiment`, but its runtime frontmatter normalization ignores `kind` entirely. A markdown document explicitly marked `kind: pipeline` is accepted by `runExperimentLoop()` and launches an experiment agent iteration as though it were a valid experiment plan.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, ExperimentFileSystem, ExperimentGit } from "./types.js";

describe("experiment document kind validation", () => {
  it("does not execute a document explicitly marked as another workflow kind", async () => {
    const docPath = "/repo/.poe-code/experiments/not-experiment.md";
    const volume = Volume.fromJSON({
      [docPath]: [
        "---",
        "kind: pipeline",
        "version: 1",
        "agent: claude-code",
        "metric:",
        "  name: tests",
        "  script: npm test",
        "  direction: maximize",
        "baseline: { tests: 1 }",
        "---",
        "Wrong workflow kind",
      ].join("\n"),
    });
    const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    const git: ExperimentGit = {
      currentHash: vi.fn(async () => "base-1"),
      reset: vi.fn(async () => undefined),
    };
    const runAgent = vi.fn(async (_input: AgentRunInput) => {
      await fs.appendFile(
        docPath.replace(/\.md$/, ".journal.jsonl"),
        `${JSON.stringify({
          commit: "discard",
          status: "discard",
          output: "ran",
          agentOutput: "done",
          durationMs: 1,
          timestamp: "2026-05-25T00:00:00.000Z",
        })}\n`,
      );
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      maxExperiments: 1,
      fs,
      git,
      exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      runAgent,
    });

    console.log(JSON.stringify(runAgent.mock.calls.map(([input]) => input.agent)));
    expect(runAgent).not.toHaveBeenCalled();
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

The explicitly non-experiment document still starts a Claude Code experiment iteration:

```text
["claude-code"]
AssertionError: expected agent runner not to be called
```

## Observed Behavior

`experimentDocumentSchema` in `packages/experiment-loop/src/frontmatter/frontmatter.ts` declares `kind` as a required constant equal to `"experiment"`. However, `parseExperimentFrontmatterData()` normalizes only `agent`, `extends`, `metric`, `baseline`, `max_experiments`, and `metric_timeout`; it neither reads nor validates `kind`. `runExperimentLoop()` consumes that normalized result and proceeds to generate experiment instructions and invoke the configured agent despite the source document explicitly claiming a different workflow kind.

## Expected Behavior

The runtime should enforce the document identity required by its exported schema before executing plan contents. A document whose `kind` is not `experiment` should be rejected clearly and must not launch experiment work.

## Impact

A misrouted or incorrectly authored workflow document can execute under the wrong runtime, invoking autonomous code changes and journal mutations using semantics that do not match its declared plan kind. This defeats schema-based routing and increases the risk of executing unintended workflows.
