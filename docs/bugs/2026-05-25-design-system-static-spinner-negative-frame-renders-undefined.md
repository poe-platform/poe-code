# Design system static spinner negative frame renders undefined

## Summary

The exported `@poe-code/design-system` `renderSpinnerFrame()` API accepts an optional numeric animation frame without validating that it is a usable non-negative index. Supplying `frame: -1` in terminal output mode indexes the spinner glyph list with a negative remainder and renders the literal text `undefined` where the spinner symbol should appear.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { renderSpinnerFrame } from "./static/spinner.js";
import { withOutputFormat } from "./internal/output-format.js";

describe("static spinner invalid frame", () => {
  const originalForceColor = process.env.FORCE_COLOR;

  afterEach(() => {
    if (originalForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = originalForceColor;
  });

  it("renders undefined instead of a spinner glyph for a negative frame", () => {
    process.env.FORCE_COLOR = "0";
    expect(withOutputFormat("terminal", () =>
      renderSpinnerFrame({ frame: -1, message: "Loading" })
    )).toContain("undefined  Loading");
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
✓ packages/design-system/src/__probe__.test.ts > static spinner invalid frame > renders undefined instead of a spinner glyph for a negative frame
```

## Observed Behavior

Calling `renderSpinnerFrame({ frame: -1, message: "Loading" })` in terminal output mode returns output containing `undefined  Loading` instead of any glyph from the exported `SPINNER_FRAMES` set.

`packages/design-system/src/index.ts` publicly exports `renderSpinnerFrame()`. In `packages/design-system/src/static/spinner.ts:29` through `packages/design-system/src/static/spinner.ts:34`, terminal rendering computes `SPINNER_FRAMES[frame % SPINNER_FRAMES.length]` directly. JavaScript evaluates `-1 % 4` as `-1`, so the array lookup returns `undefined`; that value is formatted into the user-visible line without rejection or normalization.

## Expected Behavior

The spinner renderer should normalize arbitrary animation counters into a valid cyclic index or reject invalid frame inputs clearly. It should never display the JavaScript value `undefined` as part of terminal UI output.

## Impact

Callers that decrement counters, pass signed modulo values, or otherwise surface a negative animation state produce visibly broken CLI status output. Users and captured screenshots see corrupted spinner lines during operations that may otherwise be functioning normally, reducing trust in interactive progress reporting.
