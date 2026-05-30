---
name: "Experiment loop unknown agent key falls back to default agent"
---

# Experiment loop unknown agent key falls back to default agent

## Summary

The exported `@poe-code/experiment-loop` document schema forbids unknown frontmatter properties, but `parseExperimentFrontmatterData()` ignores unrecognized fields. A plan that misspells `agent: codex` as `agnet: codex` is accepted and `runExperimentLoop()` silently invokes the default `claude-code` agent instead.

## Reproduction

Create the following disposable probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runExperimentLoop } from "./run/loop.js";
import type { AgentRunInput, AgentRunResult, ExperimentFileSystem, ExperimentGit } from "./types.js";

it("ignores a misspelled agent key and runs the default agent", async () => {
  const docPath = "/repo/.poe-code/experiments/test.md";
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        [docPath]: [
          "---",
          "kind: experiment",
          "version: 1",
          "agnet: codex",
          "metric:",
          "  name: tests",
          "  script: node metric.mjs",
          "  direction: maximize",
          "baseline: { tests: 1 }",
          "---",
          "# Improve it",
          ""
        ].join("\n")
      },
      "/"
    )
  ).promises as unknown as ExperimentFileSystem;
  const git: ExperimentGit = {
    reset: vi.fn(async () => undefined),
    currentHash: vi.fn(async () => "base")
  };
  const runAgent = vi.fn(async (_input: AgentRunInput): Promise<AgentRunResult> => ({
    stdout: "",
    stderr: "",
    exitCode: 1
  }));

  await runExperimentLoop({
    cwd: "/repo",
    homeDir: "/home/test",
    docPath,
    maxExperiments: 1,
    fs,
    git,
    exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    runAgent
  });

  expect(runAgent.mock.calls[0]?.[0].agent).toBe("claude-code");
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm packages/experiment-loop/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/experiment-loop/src/__probe__.test.ts > ignores a misspelled agent key and runs the default agent
```

## Observed Behavior

`packages/experiment-loop/src/frontmatter/frontmatter.ts` publishes an experiment schema with `additionalProperties: false`, but `parseExperimentFrontmatterData()` extracts recognized fields without rejecting leftovers. Since `agnet` is ignored, no document-level agent override remains. `runExperimentLoop()` merges the parsed document with its default layer `{ agent: "claude-code" }`, and the probe observes the autonomous call running `claude-code` rather than the intended `codex` value.

## Expected Behavior

`parseExperimentFrontmatterData()` should reject unknown document fields such as `agnet`, particularly when they are likely misspellings of execution-defining configuration, before resolving a fallback agent or invoking any autonomous work.

## Impact

A single-character typo can execute an unintended agent provider during an experiment run. This can change credentials, model behavior, tool access, cost, and repository modifications while the document is accepted and the workflow appears to run normally.
