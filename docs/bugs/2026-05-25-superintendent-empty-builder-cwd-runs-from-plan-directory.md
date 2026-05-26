# Superintendent empty builder cwd runs from plan directory

## Summary

The exported `@poe-code/superintendent` schema requires `builder.cwd` to be a non-empty string, but `parseSuperintendentDoc()` accepts `builder.cwd: ''`. Instead of rejecting the invalid role configuration or using the loop workspace default, the runtime resolves the blank value relative to the document path and launches the builder from the plan directory.

## Reproduction

Create the following disposable probe at `packages/superintendent/src/runtime/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runLoop, type SuperintendentFileSystem } from "./loop.js";

it("accepts a blank builder cwd and runs from the plan directory", async () => {
  const docPath = "/repo/docs/plans/feature.md";
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        [docPath]: [
          "---",
          "kind: superintendent",
          "version: 1",
          "builder:",
          "  cwd: ''",
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

  expect(runAgent.mock.calls[0]?.[0].cwd).toBe("/repo/docs/plans");
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/superintendent/src/runtime/__probe__.test.ts --reporter verbose
rm packages/superintendent/src/runtime/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/superintendent/src/runtime/__probe__.test.ts > accepts a blank builder cwd and runs from the plan directory
```

## Observed Behavior

`packages/superintendent/src/document/parse.ts` declares `builder.cwd` with `minLength: 1`, but `parseRequiredRole()` accepts the empty string through `expectString()`. `packages/superintendent/src/runtime/resolve-cwd.ts` treats any defined relative value as a path to resolve beside the document, and `path.resolve("/repo/docs/plans", "")` yields `"/repo/docs/plans"`. The probe therefore observes the builder running there instead of the supplied loop workspace `"/repo"`.

## Expected Behavior

`parseSuperintendentDoc()` should reject an explicitly blank `builder.cwd` value before launching the builder, consistent with the non-empty schema constraint.

## Impact

A malformed superintendent plan can execute autonomous code-changing work in the documentation directory instead of the intended project workspace. The builder may fail to find project files, create artifacts under `docs/plans`, or make edits relative to an unexpected directory while the invalid plan is accepted as runnable.
