# Superintendent unknown max rounds key expands loop budget

## Summary

The exported `@poe-code/superintendent` schema forbids unknown top-level fields, but `parseSuperintendentDoc()` ignores them. A plan that misspells `max_rounds: 1` as `max_round: 1` is accepted and receives the default budget of `100` rounds, allowing additional autonomous agent work beyond the intended one-round limit.

## Reproduction

Create the following disposable probe at `packages/superintendent/src/runtime/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runLoop, type SuperintendentFileSystem } from "./loop.js";

it("ignores a misspelled max_rounds limit and starts a second build", async () => {
  const docPath = "/repo/docs/plans/feature.md";
  const fs = createFsFromVolume(
    Volume.fromJSON(
      {
        [docPath]: [
          "---",
          "kind: superintendent",
          "version: 1",
          "builder:",
          "  prompt: Build",
          "superintendent:",
          "  prompt: Inspect",
          "owner:",
          "  prompt: Review",
          "max_round: 1",
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
  const runAgent = vi.fn(async () => ({ stdout: "work", stderr: "", exitCode: 0 }));

  const result = await runLoop({
    docPath,
    cwd: "/repo",
    homeDir: "/home/test",
    fs,
    runAgent,
    callbacks: { shouldStop: () => runAgent.mock.calls.length >= 3 }
  });

  expect(result.stopReason).toBe("stopped");
  expect(result.round).toBe(2);
  expect(result.maxRounds).toBe(100);
  expect(runAgent).toHaveBeenCalledTimes(3);
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/superintendent/src/runtime/__probe__.test.ts --reporter verbose
rm packages/superintendent/src/runtime/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/superintendent/src/runtime/__probe__.test.ts > ignores a misspelled max_rounds limit and starts a second build
```

## Observed Behavior

`packages/superintendent/src/document/parse.ts` publishes a top-level schema with `additionalProperties: false`, but `parseFrontmatter()` never rejects unknown frontmatter keys. Because it does not find the correctly named `max_rounds` property, it defaults `maxRounds` to `100`. In the probe, the document intends a limit of one round, but it proceeds into round two and invokes a second builder before an explicit stop callback interrupts it.

## Expected Behavior

`parseSuperintendentDoc()` should reject unknown top-level fields such as `max_round`, rather than silently discarding a misspelled execution cap and applying a much larger default budget.

## Impact

A simple frontmatter typo can expand an intended single-round workflow into as many as one hundred autonomous rounds. This can multiply agent cost, runtime, and unintended edits while the plan appears to have executed successfully under the published document schema.
