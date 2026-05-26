# Pipeline unknown teardown agent key runs default provider

## Summary

The exported `@poe-code/pipeline` schema forbids unknown keys inside `teardown` step definitions, but `parsePlan()` ignores unrecognized step fields. A cleanup phase that misspells `agent: codex` as `agnet: codex` is accepted and executed using the pipeline invocation's default `claude-code` agent instead.

## Reproduction

Create the following disposable probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runPipeline } from "./run/pipeline.js";

it("ignores a misspelled teardown agent and cleans up with the pipeline default", async () => {
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        "/repo/docs/plans/plan.md": [
          "---",
          "kind: pipeline",
          "version: 1",
          "teardown:",
          "  agnet: codex",
          "  prompt: Clean",
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

  await runPipeline({ agent: "claude-code", cwd: "/repo", homeDir: "/home/test", plan: "docs/plans/plan.md", planDirectory: "docs/plans", fs, runAgent });

  expect(runAgent).toHaveBeenCalledTimes(2);
  expect(runAgent.mock.calls[1]?.[0]).toMatchObject({ agent: "claude-code", prompt: "Clean" });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
rm packages/pipeline/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/pipeline/src/__probe__.test.ts > ignores a misspelled teardown agent and cleans up with the pipeline default
```

## Observed Behavior

`packages/pipeline/src/plan/parser.ts` publishes the `teardown` step schema with `additionalProperties: false`, including a valid `agent` property. Its parser reads recognized fields but never rejects the misspelled `agnet`. Since the normalized cleanup phase has no explicit agent, `runPipeline()` evaluates `phaseDef.agent ?? options.agent` and launches the teardown prompt using `claude-code` rather than the apparent `codex` choice.

## Expected Behavior

`parsePlan()` should reject unknown teardown fields such as `agnet` before executing cleanup work through an unintended agent provider.

## Impact

A trivial cleanup configuration typo can run teardown actions through a different autonomous provider than intended. Cleanup commonly mutates files or external resources, so wrong-provider execution can affect credentials, permissions, cost, and final workspace state while the pipeline reports normal completion.
