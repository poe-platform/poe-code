# Plan browser CR-only experiment journal displays final state as open

## Summary

`@poe-code/plan-browser` parses an experiment journal by splitting its JSONL contents only on line-feed (`\n`) characters. A valid journal encoded with carriage-return-only (`\r`) line separators therefore fails to expose its last status: two entries ending in `{"status":"keep"}` are treated as invalid combined JSON, and the browser displays the experiment as `open`.

## Reproduction

Create a disposable Vitest probe at `packages/plan-browser/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getLastExperimentState } from "./format.js";

describe("plan-browser CR-only experiment journal", () => {
  it("returns the last status from CR-only JSONL journal entries", () => {
    const content = [
      JSON.stringify({ status: "discard" }),
      JSON.stringify({ status: "keep" })
    ].join("\r");

    expect(getLastExperimentState(content)).toBe("keep");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/plan-browser/src/__probe__.test.ts --reporter verbose
rm -f packages/plan-browser/src/__probe__.test.ts
```

## Observed Behavior

The parser returns the normal initial-state label instead of the recorded final state:

```text
FAIL  packages/plan-browser/src/__probe__.test.ts > plan-browser CR-only experiment journal > returns the last status from CR-only JSONL journal entries
AssertionError: expected 'open' to be 'keep' // Object.is equality

Expected: "keep"
Received: "open"
```

`getLastExperimentState()` in `packages/plan-browser/src/format.ts:183` applies `journalContent.split("\n")`, leaving CR-only JSONL records as one concatenated string such as `{"status":"discard"}\r{"status":"keep"}`. That combined value fails `JSON.parse()`, the loop discovers no usable entry, and the helper returns `"open"` at line 200. `readExperimentState()` forwards this value for readable journals at `packages/plan-browser/src/format.ts:264`, and experiment metadata presents it through `formatExperimentDetail()` at `packages/plan-browser/src/format.ts:327`.

## Expected Behavior

Experiment journal parsing should recognize valid line-separated JSON entries regardless of conventional text newline style, including CR-only separators, or reject unsupported journal line endings clearly. A recorded final experiment status must not silently revert to the ordinary initial `open` state.

## Impact

Experiments with CR-only journal files can appear newly open after prior iterations were kept, discarded, or otherwise completed. Users may rerun already-decided experiments, overlook accepted results, or misread workflow progress because the plan browser presents a plausible but false state instead of the journal's authoritative latest entry.
