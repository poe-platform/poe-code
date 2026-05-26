# Pipeline unknown setup key skips preparation agent

## Summary

The exported `@poe-code/pipeline` document schema forbids unknown top-level properties, but `parsePlan()` ignores unrecognized fields. A plan that misspells its `setup` phase as `setpu` is accepted and executes its task agent without ever running the intended preparation phase.

## Reproduction

Create the following disposable probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runPipeline } from "./run/pipeline.js";

it("ignores a misspelled setup phase and runs the task without preparation", async () => {
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        "/repo/docs/plans/plan.md": [
          "---",
          "kind: pipeline",
          "version: 1",
          "setpu:",
          "  prompt: Prepare workspace",
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

  await runPipeline({
    agent: "codex",
    cwd: "/repo",
    homeDir: "/home/test",
    plan: "docs/plans/plan.md",
    planDirectory: "docs/plans",
    fs,
    runAgent
  });

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
✓ packages/pipeline/src/__probe__.test.ts > ignores a misspelled setup phase and runs the task without preparation
```

## Observed Behavior

`packages/pipeline/src/plan/parser.ts` publishes `pipelineDocumentSchema` with `additionalProperties: false` and a recognized `setup` property, but `parsePlan()` reads only known execution fields and does not reject leftovers. The misspelled `setpu` object is discarded. `runPipeline()` then sees no setup definition and invokes only the task prompt, as confirmed by the single `"Do it"` agent call in the probe.

## Expected Behavior

`parsePlan()` should reject unknown top-level keys such as `setpu` before execution begins, rather than silently skipping a configured preparation phase and proceeding directly to task work.

## Impact

A minor frontmatter typo can bypass prerequisite setup actions while still launching task agents. Pipelines may execute against an unprepared workspace, missing credentials, missing generated files, or unsafe preconditions, producing incorrect modifications and misleading successful run outcomes.
