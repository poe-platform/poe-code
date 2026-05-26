# Superintendent negative review turn grants extra owner cycle

## Summary

The exported `@poe-code/superintendent` document schema requires `status.review_turn` to be a non-negative integer, but `parseSuperintendentDoc()` accepts any finite numeric value. A document persisted in review state with `review_turn: -1` is therefore accepted and permits one more owner rejection/review exchange than the runtime's five-turn cap.

## Reproduction

Create the following disposable probe at `packages/superintendent/src/runtime/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { runBuilder } from "./run-builder.js";
import type { runInspector } from "./run-inspector.js";
import type { runOwnerReview } from "./run-owner-review.js";
import type { runSuperintendent } from "./run-superintendent.js";
import { runLoop, type LoopRunners, type SuperintendentFileSystem } from "./loop.js";

it("accepts a negative review turn and grants an extra owner rejection", async () => {
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
          "  state: review",
          "  round: 1",
          "  review_turn: -1",
          "---",
          "# Plan",
          "",
          "## Task Board",
          "",
          "- [x] Ship it",
          ""
        ].join("\n")
      },
      "/"
    )
  ).promises as unknown as SuperintendentFileSystem;
  const ownerReview = vi.fn(async () => ({
    transition: { action: "request_changes" as const, feedback: "Again" }
  }));
  const superintendent = vi.fn(async () => ({
    summary: "Ready",
    transition: { action: "request_review" as const, summary: "Ready" }
  }));
  const runners: LoopRunners = {
    builder: vi.fn() as unknown as typeof runBuilder,
    inspector: vi.fn() as unknown as typeof runInspector,
    superintendent: superintendent as unknown as typeof runSuperintendent,
    ownerReview: ownerReview as unknown as typeof runOwnerReview
  };

  const result = await runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs, runners });

  expect(result.stopReason).toBe("max_rounds");
  expect(ownerReview).toHaveBeenCalledTimes(6);
  expect(superintendent).toHaveBeenCalledTimes(5);
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/superintendent/src/runtime/__probe__.test.ts --reporter verbose
rm packages/superintendent/src/runtime/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/superintendent/src/runtime/__probe__.test.ts > accepts a negative review turn and grants an extra owner rejection
```

## Observed Behavior

`packages/superintendent/src/document/parse.ts` publishes `status.review_turn` as an integer with a minimum of `0`, but `parseStatusBlock()` reads it through `expectNumber()`, accepting `-1`. The runtime increments `reviewTurn` after each owner `request_changes` transition and only returns to build mode after reaching its internal five-turn limit. Starting from `-1` shifts that counter backward, so the probe reaches six owner reviews and five intermediate superintendent review exchanges before stopping.

## Expected Behavior

`parseSuperintendentDoc()` should reject negative `status.review_turn` values before they can expand the allowed owner review budget or invoke any agent.

## Impact

A corrupted or crafted persisted document can exceed the intended review-cycle cap, causing additional owner and superintendent agent calls. This increases cost and latency and allows extra autonomous deliberation beyond the workflow limit represented by the public schema and runtime design.
