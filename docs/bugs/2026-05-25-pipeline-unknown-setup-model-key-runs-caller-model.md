# Pipeline unknown setup model key runs caller model

## Summary

The exported `@poe-code/pipeline` schema forbids unknown keys inside `setup` step definitions, but `parsePlan()` ignores unrecognized step fields. A setup phase that misspells `model` as `modle` is accepted and executes using the caller-level model override instead of the model apparently selected in the plan.

## Reproduction

Create the following disposable probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runPipeline } from "./run/pipeline.js";

it("ignores a misspelled setup model and runs the caller model", async () => {
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        "/repo/docs/plans/plan.md": [
          "---",
          "kind: pipeline",
          "version: 1",
          "setup:",
          "  modle: openai/gpt-5.4",
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

  await runPipeline({ agent: "codex", model: "openai/gpt-5-mini", cwd: "/repo", homeDir: "/home/test", plan: "docs/plans/plan.md", planDirectory: "docs/plans", fs, runAgent });

  expect(runAgent.mock.calls[0]?.[0].model).toBe("openai/gpt-5-mini");
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
rm packages/pipeline/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/pipeline/src/__probe__.test.ts > ignores a misspelled setup model and runs the caller model
```

## Observed Behavior

`packages/pipeline/src/plan/parser.ts` publishes step definitions with `additionalProperties: false` and recognizes `model`, but `parseOptionalStepFields()` ignores unknown `modle`. Since the normalized setup phase has no model override, `runPipeline()` computes `phaseDef.model ?? options.model` and sends `openai/gpt-5-mini` to the preparation agent instead of the apparent plan value `openai/gpt-5.4`.

## Expected Behavior

`parsePlan()` should reject unknown setup keys such as `modle` before starting a phase with a different model configuration than the plan author specified.

## Impact

A small configuration typo can change the model used for autonomous setup work, affecting quality, cost, capability, policy behavior, and generated workspace changes while execution otherwise appears successful.
