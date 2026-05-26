# Design system color invalid hex silently renders black

## Summary

The exported `color.hex()` helper accepts malformed six-character hexadecimal color values and silently renders them as black. Calling `color.hex("#zzzzzz")` produces the same ANSI foreground sequence as valid black input instead of rejecting an invalid color specification.

## Reproduction

Create a disposable probe at `packages/design-system/src/components/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { color } from "./color.js";

describe("color invalid hex input", () => {
  const originalForceColor = process.env.FORCE_COLOR;
  afterEach(() => {
    if (originalForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = originalForceColor;
  });

  it("silently renders malformed hex input as black", () => {
    process.env.FORCE_COLOR = "1";
    const output = color.hex("#zzzzzz")("text");

    console.log(JSON.stringify({ output }));
    expect(output).toBe("\u001b[38;2;0;0;0mtext\u001b[0m");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/design-system/src/components/__probe__.test.ts --reporter verbose
rm packages/design-system/src/components/__probe__.test.ts
```

## Observed Behavior

The probe passes and prints an ordinary black truecolor foreground sequence for the malformed input:

```text
{"output":"\u001b[38;2;0;0;0mtext\u001b[0m"}
```

`normalizeHex()` in `packages/design-system/src/components/color.ts` accepts any input whose normalized length is `3` or `6`, uses `Number.parseInt(..., 16)` for each channel, and returns `NaN` channels for invalid hexadecimal characters. `rgbStyle()` then passes those values through `clampRgb()`, which converts `NaN` to `0`, making malformed values indistinguishable from black.

## Expected Behavior

An exported explicit-color API should reject malformed hexadecimal values rather than silently select a different valid visual color. Inputs containing non-hex characters should surface a clear error before emitting terminal styling.

## Impact

Theme configuration, plugin branding, or dynamic presentation code can contain invalid color values while producing plausible but incorrect terminal output. Errors are hidden as black styling, making visual regressions difficult to diagnose and potentially rendering important text unreadable against dark backgrounds.
