# Pipeline unknown teardown key skips cleanup agent

## Summary

The exported `@poe-code/pipeline` document schema forbids unknown top-level properties, but `parsePlan()` ignores unrecognized fields. A plan that misspells its `teardown` phase as `taerdown` is accepted and returns a completed pipeline result without ever running the intended cleanup agent.

## Reproduction

Create the following disposable probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runPipeline } from "./run/pipeline.js";

it("ignores a misspelled teardown phase and completes without cleanup", async () => {
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        "/repo/docs/plans/plan.md": [
          "---",
          "kind: pipeline",
          "version: 1",
          "taerdown:",
          "  prompt: Clean workspace",
          "tasks:",
          "  - id: work",
          "    title: Work",
          "    prompt: Do it",
          "    status: open",
          "---",
          ""
        ].join("\n")
      },
      "/"
    )
  ).promises;
  const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

  const result = await runPipeline({
    agent: "codex",
    cwd: "/repo",
    homeDir: "/home/test",
    plan: "docs/plans/plan.md",
    planDirectory: "docs/plans",
    fs,
    runAgent
  });

  expect(result.stopReason).toBe("completed");
  expect(runAgent).toHaveBeenCalledTimes(1);
  expect(runAgent.mock.calls[0]?.[0].prompt).toBe("Do it");
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
rm packages/pipeline/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/pipeline/src/__probe__.test.ts > ignores a misspelled teardown phase and completes without cleanup
```

## Observed Behavior

`packages/pipeline/src/plan/parser.ts` publishes `pipelineDocumentSchema` with `additionalProperties: false` and a recognized `teardown` property, but `parsePlan()` reads only expected fields and never rejects leftovers. The `taerdown` object is discarded. `runPipeline()` then runs the task once, skips cleanup entirely, and returns `stopReason: "completed"` even though the document included an apparent cleanup instruction.

## Expected Behavior

`parsePlan()` should reject unknown top-level keys such as `taerdown` before task execution begins, rather than completing successfully after silently omitting an intended teardown phase.

## Impact

A minor frontmatter typo can suppress cleanup work while yielding a successful completed pipeline outcome. Workspaces may retain temporary files, modified environment state, unreleased resources, or other post-run side effects that the plan author expected teardown to remove.
