# Design system help formatter negative indent throws RangeError

## Summary

The exported `@poe-code/design-system` `formatColumns()` API accepts numeric layout options without validating that `indent` is a non-negative usable count. Passing `indent: -1` causes the formatting operation to throw a native `RangeError` from `String.repeat()` instead of rejecting the option intentionally or rendering safely.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatColumns } from "./components/help-formatter.js";

describe("help formatter negative indent", () => {
  it("throws from String.repeat for a negative indent option", () => {
    expect(() => formatColumns({
      rows: [{ left: "run", right: "Run one command" }],
      indent: -1
    })).toThrowError(RangeError);
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
✓ packages/design-system/src/__probe__.test.ts > help formatter negative indent > throws from String.repeat for a negative indent option
```

## Observed Behavior

Calling `formatColumns({ rows: [{ left: "run", right: "Run one command" }], indent: -1 })` throws a native `RangeError` before producing any help text.

`packages/design-system/src/index.ts` publicly exports the help formatter utilities. `formatColumns()` takes `indent?: number`, assigns the supplied value directly at `packages/design-system/src/components/help-formatter.ts:97` through `packages/design-system/src/components/help-formatter.ts:110`, and then constructs indentation with `" ".repeat(indent)` at `packages/design-system/src/components/help-formatter.ts:111`. Negative input reaches the JavaScript runtime unchecked and causes `String.repeat()` to throw.

## Expected Behavior

Layout option handling should reject invalid negative indentation with a deliberate argument error or clamp it to a safe value before rendering. A public formatter should not expose an incidental native exception for a malformed numeric option.

## Impact

SDK consumers configuring help output dynamically can crash CLI help, command lists, or generated documentation when a computed indentation value becomes negative. Instead of degraded formatting or a clear configuration diagnostic, the entire rendering request fails with a low-level exception.
