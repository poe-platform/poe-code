# Pipeline unknown setup agent key runs default provider

## Summary

The exported `@poe-code/pipeline` schema forbids unknown keys inside `setup` step definitions, but `parsePlan()` ignores unrecognized step fields. A setup phase that misspells `agent: codex` as `agnet: codex` is accepted and executed using the pipeline invocation's default `claude-code` agent instead.

## Reproduction

Create the following disposable probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runPipeline } from "./run/pipeline.js";

it("ignores a misspelled setup agent and runs setup with the pipeline default", async () => {
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        "/repo/docs/plans/plan.md": [
          "---",
          "kind: pipeline",
          "version: 1",
          "setup:",
          "  agnet: codex",
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

  await runPipeline({ agent: "claude-code", cwd: "/repo", homeDir: "/home/test", plan: "docs/plans/plan.md", planDirectory: "docs/plans", fs, runAgent });

  expect(runAgent).toHaveBeenCalledTimes(1);
  expect(runAgent.mock.calls[0]?.[0]).toMatchObject({ agent: "claude-code", prompt: "Prepare" });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
rm packages/pipeline/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/pipeline/src/__probe__.test.ts > ignores a misspelled setup agent and runs setup with the pipeline default
```

## Observed Behavior

`packages/pipeline/src/plan/parser.ts` publishes the `setup` step schema with `additionalProperties: false`, including a valid `agent` property. Its `parseStepOverride()` and `parseOptionalStepFields()` functions only extract recognized properties and never reject unknown `agnet`. Since no parsed setup agent remains, `runPipeline()` evaluates `phaseDef.agent ?? options.agent` and launches the preparation phase with the caller-level `claude-code` default.

## Expected Behavior

`parsePlan()` should reject unknown setup fields such as `agnet` before executing a phase under a different agent provider than the plan author specified.

## Impact

A simple setup configuration typo can execute preparatory actions through an unintended autonomous provider. This can alter credentials, tool access, model behavior, cost, or workspace changes while the plan parses and the setup phase appears to run normally.
