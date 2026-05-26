# Superintendent negative status round runs beyond max rounds

## Summary

The exported `@poe-code/superintendent` document schema requires `status.round` to be a non-negative integer, but `parseSuperintendentDoc()` accepts any finite numeric round. A document initialized with `status.round: -1` and `max_rounds: 1` is therefore accepted and executes two build/superintendent rounds instead of the configured single round.

## Reproduction

Create the following disposable probe at `packages/superintendent/src/runtime/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runLoop, type SuperintendentFileSystem } from "./loop.js";

it("accepts a negative current round and runs beyond max_rounds", async () => {
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
          "max_rounds: 1",
          "status:",
          "  state: in_progress",
          "  round: -1",
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
  const runAgent = vi.fn(async () => ({ stdout: "keep working", stderr: "", exitCode: 0 }));

  const result = await runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs, runAgent });

  expect(result.stopReason).toBe("max_rounds");
  expect(result.round).toBe(1);
  expect(runAgent).toHaveBeenCalledTimes(4);
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/superintendent/src/runtime/__probe__.test.ts --reporter verbose
rm packages/superintendent/src/runtime/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/superintendent/src/runtime/__probe__.test.ts > accepts a negative current round and runs beyond max_rounds
```

## Observed Behavior

`packages/superintendent/src/document/parse.ts` publishes `status.round` as an integer with a minimum of `0`, but `parseStatusBlock()` reads it through `expectNumber()`, accepting `-1`. `runLoop()` terminates only when the stored round is already at least `maxRounds`, and increments the accepted negative value before each build phase. With `max_rounds: 1` and `status.round: -1`, the runtime executes two builder/superintendent pairs, reflected by four agent invocations, before returning `stopReason: "max_rounds"` at round `1`.

## Expected Behavior

`parseSuperintendentDoc()` should reject negative `status.round` values before they affect the runtime budget or permit any autonomous agent invocation.

## Impact

A malformed or corrupted persisted document can bypass its configured autonomous-work cap and run extra agents. This can increase cost, extend execution time, and perform additional unintended modifications despite the workflow declaring a strict `max_rounds` limit.
