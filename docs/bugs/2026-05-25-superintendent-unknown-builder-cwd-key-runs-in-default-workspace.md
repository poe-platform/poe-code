# Superintendent unknown builder cwd key runs in default workspace

## Summary

The exported `@poe-code/superintendent` schema forbids unknown properties within role configurations, but `parseSuperintendentDoc()` ignores unrecognized builder keys. A plan that misspells `builder.cwd` as `builder.cwwd` is accepted and executes the builder in the default workflow workspace rather than the author-selected directory.

## Reproduction

Create the following disposable probe at `packages/superintendent/src/runtime/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runLoop, type SuperintendentFileSystem } from "./loop.js";

it("ignores a misspelled builder cwd and runs in the default workspace", async () => {
  const docPath = "/repo/docs/plans/feature.md";
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        [docPath]: [
          "---",
          "kind: superintendent",
          "version: 1",
          "builder:",
          "  cwwd: ../../sandbox",
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
  const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

  await runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs, runAgent });

  expect(runAgent.mock.calls[0]?.[0].cwd).toBe("/repo");
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/superintendent/src/runtime/__probe__.test.ts --reporter verbose
rm packages/superintendent/src/runtime/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/superintendent/src/runtime/__probe__.test.ts > ignores a misspelled builder cwd and runs in the default workspace
```

## Observed Behavior

`packages/superintendent/src/document/parse.ts` publishes role schemas with `additionalProperties: false` and a recognized `cwd` field, but `parseRequiredRole()` only reads expected properties and discards unknown `cwwd`. Because the normalized builder role has no `cwd`, `runBuilder()` calls `resolveRoleCwd()` with an undefined role directory, which returns the default `/repo` execution workspace instead of the apparent `../../sandbox` target.

## Expected Behavior

`parseSuperintendentDoc()` should reject unknown role fields such as `cwwd` before starting autonomous work in a fallback workspace that differs from the document author's intended location.

## Impact

A one-character typo can run builder actions against the wrong working tree. The agent may read, modify, or execute commands in the primary repository instead of an intended sandbox or subproject, producing misplaced changes and potentially broader side effects.
