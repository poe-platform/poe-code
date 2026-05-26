# Plan browser displays unknown experiment journal status verbatim

## Summary

`@poe-code/plan-browser` trusts any non-empty string stored in an experiment journal entry's `status` field. A readable journal containing an invalid status such as `"completed"` is therefore displayed as if it were a real experiment workflow state, even though experiment journal entries only define `"keep"` and `"discard"` outcomes.

## Reproduction

Create a disposable Vitest probe at `packages/plan-browser/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getLastExperimentState } from "./format.js";

describe("plan-browser invalid experiment journal status", () => {
  it("does not display a status outside the experiment journal contract", () => {
    const content = JSON.stringify({ status: "completed" });

    expect(getLastExperimentState(content)).toBe("open");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/plan-browser/src/__probe__.test.ts --reporter verbose
rm -f packages/plan-browser/src/__probe__.test.ts
```

## Observed Behavior

The invalid journal state is returned directly instead of being rejected or ignored:

```text
FAIL  packages/plan-browser/src/__probe__.test.ts > plan-browser invalid experiment journal status > does not display a status outside the experiment journal contract
AssertionError: expected 'completed' to be 'open' // Object.is equality

Expected: "open"
Received: "completed"
```

`getLastExperimentState()` in `packages/plan-browser/src/format.ts:183` parses journal lines and returns any non-empty string found at `parsed.status`, without validating it against known journal outcomes. In contrast, `JournalEntry.status` in `packages/experiment-loop/src/types.ts:101` permits only `"keep"` or `"discard"`. `readExperimentState()` forwards the unchecked string for readable journals at `packages/plan-browser/src/format.ts:264`, and experiment metadata exposes it through `formatExperimentDetail()` at `packages/plan-browser/src/format.ts:327`.

## Expected Behavior

The plan browser should display only supported experiment states derived from valid journal entries. Entries with an unknown `status` value should be rejected, ignored in favor of an earlier valid entry, or represented as unavailable/corrupt state rather than presented verbatim as a real workflow outcome.

## Impact

Malformed, forward-incompatible, or tampered journal files can cause the plan browser to claim arbitrary experiment states that the experiment loop never produces. Users may incorrectly treat an experiment as completed or otherwise resolved, skip needed work, or misdiagnose workspace progress because corrupted status data is presented as authoritative.
