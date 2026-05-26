# Pipeline unknown hook scope key drops requested source scope

## Summary

The exported `@poe-code/pipeline` schema forbids unknown properties within hook configurations, but `parsePlan()` ignores them. A setup phase that misspells `hooks.scope: user` as `hooks.scoep: user` is accepted and invoked without the requested scope, altering which hook sources downstream execution may resolve.

## Reproduction

Create the following disposable probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runPipeline } from "./run/pipeline.js";

it("ignores a misspelled hook scope and forwards no requested scope", async () => {
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
          "    scoep: user",
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
✓ packages/pipeline/src/__probe__.test.ts > ignores a misspelled hook scope and forwards no requested scope
```

## Observed Behavior

`packages/pipeline/src/plan/parser.ts` publishes hook objects with `additionalProperties: false`, recognizing a `scope` value of `project`, `user`, or `merged`. `parseHooks()` does not reject unknown `scoep`; it returns only `{ from: "hook-pack" }`. `runPipeline()` forwards that reduced hook configuration to its setup agent, omitting the explicit user-only scope represented by the source document.

## Expected Behavior

`parsePlan()` should reject unknown hook keys such as `scoep` before invoking an agent without the source scope the plan author attempted to require.

## Impact

A small typo can broaden or otherwise change which hook instructions are applied to autonomous setup execution. Project-local or merged content may be used where user-only hooks were intended, causing unexpected instructions, edits, or policy behavior.
