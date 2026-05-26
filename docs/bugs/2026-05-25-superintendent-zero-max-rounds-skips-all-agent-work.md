# Superintendent zero max rounds skips all agent work

## Summary

The exported `@poe-code/superintendent` document schema requires `max_rounds` to be an integer of at least `1`, but `parseSuperintendentDoc()` accepts any finite number. A document containing `max_rounds: 0` is therefore accepted and `runLoop()` returns `max_rounds` before invoking the builder or any other agent.

## Reproduction

Create the following disposable probe at `packages/superintendent/src/runtime/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runLoop, type SuperintendentFileSystem } from "./loop.js";

it("accepts max_rounds zero and stops before any agent can run", async () => {
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
          "max_rounds: 0",
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

  const result = await runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs, runAgent });

  expect(result.stopReason).toBe("max_rounds");
  expect(result.round).toBe(0);
  expect(runAgent).not.toHaveBeenCalled();
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/superintendent/src/runtime/__probe__.test.ts --reporter verbose
rm packages/superintendent/src/runtime/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/superintendent/src/runtime/__probe__.test.ts > accepts max_rounds zero and stops before any agent can run
```

## Observed Behavior

`packages/superintendent/src/document/parse.ts` publishes `max_rounds` with an integer minimum of `1`, but `parseFrontmatter()` reads it through `expectNumber()`, which accepts `0`, negative values, and fractional values. `runLoop()` checks `state.round >= state.maxRounds` before starting a round. With initial `status.round: 0` and `max_rounds: 0`, the loop exits immediately with `stopReason: "max_rounds"` while a pending task remains and no agent is invoked.

## Expected Behavior

`parseSuperintendentDoc()` should reject `max_rounds` values that are not positive integers, in accordance with the public document schema, before the runtime decides whether agent work should begin.

## Impact

A malformed or generated plan can be accepted as a valid superintendent document yet perform no autonomous work at all. This silently turns an intended build/inspect/review run into an immediate terminal-looking result with pending tasks untouched, undermining orchestration and any automation that trusts validated plan documents to execute at least one permitted round.
