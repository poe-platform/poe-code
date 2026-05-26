# Tiny stdio MCP test server negative Caesar shifts produce punctuation

## Summary

The `tiny-stdio-mcp-test-server` advertises a Caesar-cipher encryption tool with a numeric shift parameter, but negative shifts do not wrap alphabetic characters backward through the alphabet. Instead, letters near `A` or `a` are converted into punctuation because JavaScript's remainder operator preserves negative values.

## Reproduction

Add the following temporary probe as `packages/tiny-stdio-mcp-test-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { caesarEncrypt } from "./index.js";

describe("negative Caesar shifts", () => {
  it("maps alphabetic input into punctuation instead of wrapping backward", () => {
    const encrypted = caesarEncrypt("abc ABC", -1);

    console.log(JSON.stringify({ encrypted }));
    expect(encrypted).toBe("`ab @AB");
  });
});
```

Run:

```sh
npm exec vitest run -- packages/tiny-stdio-mcp-test-server/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"encrypted":"`ab @AB"}
✓ packages/tiny-stdio-mcp-test-server/src/__probe__.test.ts > negative Caesar shifts > maps alphabetic input into punctuation instead of wrapping backward
```

Remove the temporary probe after confirming the reproduction.

## Observed Behavior

Calling `caesarEncrypt("abc ABC", -1)` returns `` `ab @AB `` rather than rotating the input backward. In `packages/tiny-stdio-mcp-test-server/src/index.ts`, both letter branches compute `(... + shift) % 26` directly; for negative intermediate values, JavaScript yields a negative remainder, which is then added to the character-code base and escapes the alphabetic range.

## Expected Behavior

The tool's numeric shift should implement normal Caesar-cipher rotation in either direction. A shift of `-1` should rotate `abc ABC` to `zab ZAB`, keeping alphabetic input alphabetic and wrapping around each alphabet boundary.

## Impact

This test MCP server is intended for exercising MCP tool use and integration behavior. Clients or test plans that invoke the cipher with backward shifts receive invalid encryption output, causing false failures and making the advertised tool unreliable for valid numeric inputs.
