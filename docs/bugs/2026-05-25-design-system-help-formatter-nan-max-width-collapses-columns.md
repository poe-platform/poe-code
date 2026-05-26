# Design system help formatter NaN max width collapses columns

## Summary

The exported `@poe-code/design-system` `formatColumns()` API accepts a numeric `maxLeftWidth` without validating that it is finite. Passing `maxLeftWidth: NaN` silently collapses the separation between left and right columns and causes every subsequent description word to wrap onto its own line, producing corrupt help output instead of a diagnostic.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatColumns } from "./components/help-formatter.js";

describe("help formatter NaN widths", () => {
  it("collapses column separation and wraps each right word when maxLeftWidth is NaN", () => {
    expect(formatColumns({
      rows: [{ left: "run", right: "Run one command" }],
      maxLeftWidth: Number.NaN,
      indent: 0
    })).toBe("runRun\none\ncommand");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/design-system/src/__probe__.test.ts --reporter verbose
rm -f packages/design-system/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/design-system/src/__probe__.test.ts > help formatter NaN widths > collapses column separation and wraps each right word when maxLeftWidth is NaN
```

## Observed Behavior

For an ordinary help row with left text `run` and description `Run one command`, supplying `{ maxLeftWidth: NaN, indent: 0 }` returns:

```text
runRun
one
command
```

The command name and first description word are concatenated with no separating padding, and remaining words are unnecessarily split across lines.

`packages/design-system/src/index.ts` publicly exports the help formatter utilities. `formatColumns()` computes `leftWidth` via `clamp(maxLeftContentWidth + gap, minLeftWidth, maxLeftWidth)` and `rightWidth` from that result at `packages/design-system/src/components/help-formatter.ts:97` through `packages/design-system/src/components/help-formatter.ts:112`. With `maxLeftWidth: NaN`, both widths become `NaN`; padding uses `" ".repeat(Math.max(0, NaN))`, which provides no separator, while `wrapWords()` comparisons against `NaN` fail and start a new line for every additional word.

## Expected Behavior

Column layout options should require finite widths or fall back to valid defaults. A malformed maximum width must not silently destroy the alignment and wrapping structure of rendered help content.

## Impact

SDK callers that calculate formatter widths from parsed configuration or unavailable terminal metrics can emit unreadable help and command summaries without any failure signal. This makes usage output difficult to interpret and can corrupt captured Markdown or terminal documentation used by automation and support workflows.
