# Superintendent empty builder agent still invokes provider

## Summary

The exported `@poe-code/superintendent` schema requires `builder.agent` to be a non-empty string, but `parseSuperintendentDoc()` accepts `builder.agent: ''`. A superintendent plan with an empty builder provider therefore reaches autonomous execution and invokes the agent runner with an empty provider identifier instead of being rejected during parsing.

## Reproduction

Create the following disposable probe at `packages/superintendent/src/runtime/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runLoop, type SuperintendentFileSystem } from "./loop.js";

it("accepts a blank builder agent and invokes an empty provider id", async () => {
  const docPath = "/repo/docs/plans/feature.md";
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        [docPath]: [
          "---",
          "kind: superintendent",
          "version: 1",
          "builder:",
          "  agent: ''",
          "  prompt: Build",
          "superintendent:",
          "  prompt: Inspect",
          "owner:",
          "  prompt: Review",
          "max_rounds: 1",
          "status:",
          "  state: in_progress",
          "  round: 0",
          "  review_turn: 0",
          "---",
          "# Plan",
          "",
          "## Task Board",
          "",
          "- [ ] Ship it",
          ""
        ].join("\n")
      },
      "/"
    )
  ).promises as unknown as SuperintendentFileSystem;
  const runAgent = vi.fn(async () => ({ stdout: "worked", stderr: "", exitCode: 0 }));

  await runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs, runAgent });

  expect(runAgent.mock.calls[0]?.[0].agent).toBe("");
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/superintendent/src/runtime/__probe__.test.ts --reporter verbose
rm packages/superintendent/src/runtime/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/superintendent/src/runtime/__probe__.test.ts > accepts a blank builder agent and invokes an empty provider id
```

## Observed Behavior

`packages/superintendent/src/document/parse.ts` declares role `agent` fields with `minLength: 1`, but `parseRequiredRole()` validates supplied values only through `expectString()`, which checks the JavaScript type and returns an empty string unchanged. `packages/superintendent/src/runtime/run-builder.ts` then forwards `doc.frontmatter.builder.agent` into `runAutonomousAgent()`. The reproduction observes the first autonomous invocation receiving `agent: ""`.

## Expected Behavior

`parseSuperintendentDoc()` should reject an explicitly empty `builder.agent` value before the plan can invoke any autonomous role, consistent with its published non-empty string schema.

## Impact

Malformed superintendent documents can pass validation and initiate autonomous execution with an invalid provider identifier. Depending on downstream provider lookup and error handling, this can fail after work has started, select unintended fallback behavior, or create misleading logs for a plan that should have been rejected before execution.
