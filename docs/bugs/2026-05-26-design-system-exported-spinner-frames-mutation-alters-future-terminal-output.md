# Design system exported spinner frames mutation alters future terminal output

## Summary

The public `@poe-code/design-system` API exports `SPINNER_FRAMES` as a read-only tuple type, but the runtime value is the mutable array that `renderSpinnerFrame()` reads for every terminal render. A caller that modifies this advertised visual-token collection can inject arbitrary spinner text into subsequent command output in the same process.

## Reproduction

Create a disposable probe at `packages/design-system/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { SPINNER_FRAMES, renderSpinnerFrame, withOutputFormat } from "./index.js";

const originalFirstFrame = SPINNER_FRAMES[0];

afterEach(() => {
  (SPINNER_FRAMES as unknown as string[])[0] = originalFirstFrame;
});

describe("design-system exported spinner frame mutation", () => {
  it("lets an exported metadata mutation alter later terminal renders", () => {
    (SPINNER_FRAMES as unknown as string[])[0] = "UNTRUSTED";

    const output = withOutputFormat("terminal", () =>
      renderSpinnerFrame({ frame: 0, message: "Loading" })
    );

    expect(output).toContain("UNTRUSTED");
    expect(output).not.toContain(originalFirstFrame);
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/design-system/src/__probe__.test.ts --reporter verbose
rm -f packages/design-system/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/design-system/src/__probe__.test.ts > design-system exported spinner frame mutation > lets an exported metadata mutation alter later terminal renders
```

## Observed Behavior

`SPINNER_FRAMES` is declared as an exported array at `packages/design-system/src/static/spinner.ts:5` and is re-exported from the public package entrypoint at `packages/design-system/src/index.ts:48` through `packages/design-system/src/index.ts:51`. Although TypeScript callers see an `as const` tuple, the runtime array remains writable. Terminal rendering reads directly from that same array at `packages/design-system/src/static/spinner.ts:29` through `packages/design-system/src/static/spinner.ts:34`. After assigning `SPINNER_FRAMES[0] = "UNTRUSTED"`, a later normal `renderSpinnerFrame({ frame: 0, message: "Loading" })` call renders that injected value instead of the package-defined spinner glyph.

## Expected Behavior

Public visual tokens should not be able to mutate rendering behavior for later calls. The exported frame collection should be immutable at runtime, or renderers should use protected canonical data so reading or handling public token metadata cannot rewrite future CLI output.

## Impact

Any plugin or same-process consumer importing the design system can silently alter progress output produced by unrelated commands and UI components later in the process. This enables misleading or malformed terminal status displays and makes visual behavior dependent on unrelated import order and mutations rather than the design-system contract.
