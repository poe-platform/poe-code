# Pipeline unknown setup skills key runs without requested capabilities

## Summary

The exported `@poe-code/pipeline` schema forbids unknown keys inside `setup` definitions, but `parsePlan()` ignores unrecognized step fields. A preparation phase that misspells `skills` as `skils` is accepted and executed without the declared skill capability being forwarded to its agent.

## Reproduction

Create the following disposable probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runPipeline } from "./run/pipeline.js";

it("ignores a misspelled setup skills field and runs without requested skills", async () => {
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        "/repo/docs/plans/plan.md": [
          "---",
          "kind: pipeline",
          "version: 1",
          "setup:",
          "  skils: [security-audit]",
          "  prompt: Prepare",
          "tasks: []",
          "---",
          ""
        ].join("\n")
      },
      "/"
    )
  ).promises;
  const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

  await runPipeline({ agent: "codex", cwd: "/repo", homeDir: "/home/test", plan: "docs/plans/plan.md", planDirectory: "docs/plans", fs, runAgent });

  expect(runAgent).toHaveBeenCalledTimes(1);
  expect(runAgent.mock.calls[0]?.[0]).not.toHaveProperty("skills");
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
rm packages/pipeline/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/pipeline/src/__probe__.test.ts > ignores a misspelled setup skills field and runs without requested skills
```

## Observed Behavior

`packages/pipeline/src/plan/parser.ts` publishes step definitions with `additionalProperties: false` and recognizes `skills`, but `parseOptionalStepFields()` only checks the correctly named property and never rejects unknown `skils`. The normalized setup phase has no `skills` entry, and `runPipeline()` invokes its preparation agent without forwarding the author-declared `security-audit` capability.

## Expected Behavior

`parsePlan()` should reject unknown setup keys such as `skils` before invoking a preparation phase without the capabilities its document appears to require.

## Impact

A small configuration typo can cause setup work to execute without required specialized instructions or integrations. This can weaken review, safety checks, repository preparation, or other capability-dependent behavior while the pipeline reports a normal phase execution.
