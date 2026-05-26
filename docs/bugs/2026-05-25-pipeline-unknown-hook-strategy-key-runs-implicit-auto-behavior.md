# Pipeline unknown hook strategy key runs implicit auto behavior

## Summary

The exported `@poe-code/pipeline` schema forbids unknown properties within step hook configurations, but `parsePlan()` ignores them. A setup phase that misspells `hooks.strategy: transform` as `hooks.stratgey: transform` is accepted and forwards hooks without a strategy, silently switching execution to the downstream implicit/default hook behavior.

## Reproduction

Create the following disposable probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runPipeline } from "./run/pipeline.js";

it("ignores a misspelled hook strategy and forwards implicit auto behavior", async () => {
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        "/repo/docs/plans/plan.md": [
          "---",
          "kind: pipeline",
          "version: 1",
          "setup:",
          "  prompt: Prepare",
          "  hooks:",
          "    from: hook-pack",
          "    stratgey: transform",
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

  expect(runAgent.mock.calls[0]?.[0].hooks).toEqual({ from: "hook-pack" });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
rm packages/pipeline/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/pipeline/src/__probe__.test.ts > ignores a misspelled hook strategy and forwards implicit auto behavior
```

## Observed Behavior

`packages/pipeline/src/plan/parser.ts` publishes hook objects with `additionalProperties: false`, recognizing `from`, `strategy`, and `scope`. `parseHooks()` validates only the recognized fields and never rejects unknown `stratgey`. The normalized setup definition retains `{ from: "hook-pack" }` but loses its apparent `transform` strategy, and `runPipeline()` forwards that diminished hook configuration into its agent invocation.

## Expected Behavior

`parsePlan()` should reject unknown hook configuration keys such as `stratgey` rather than invoking an agent with a changed hook installation or transformation strategy.

## Impact

A single typo can alter how hook content is installed or exposed during autonomous execution. This may result in symlink versus transformed behavior, different source selection, missing isolation expectations, or divergent agent instructions while the pipeline accepts the document and proceeds normally.
