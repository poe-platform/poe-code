# Tiny stdio MCP test server fractional Caesar shift silently truncates rotation

## Summary

`tiny-stdio-mcp-test-server` publishes the Caesar cipher tool's `shift` argument as a general JSON number and forwards fractional values into character-code arithmetic. A schema-valid input such as `shift: 1.5` does not produce a meaningful Caesar rotation or an invalid-parameter error; JavaScript truncates the fractional character code and silently returns the same result as a shift of `1`.

## Reproduction

Create the disposable probe `packages/tiny-stdio-mcp-test-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { caesarEncrypt } from "./index.js";

describe("caesar cipher fractional shifts", () => {
  it("silently truncates a schema-valid fractional rotation", () => {
    const encrypted = caesarEncrypt("azAZ", 1.5);
    console.log(JSON.stringify({ shift: 1.5, encrypted }));

    expect(encrypted).toBe("baBA");
    expect(encrypted).toBe(caesarEncrypt("azAZ", 1));
  });
});
```

Run the targeted test, then delete the probe:

```sh
npm exec -- vitest run packages/tiny-stdio-mcp-test-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-stdio-mcp-test-server/src/__probe__.test.ts
```

The probe passes and prints that fractional shift `1.5` is silently reduced to the one-position ciphertext:

```text
{"shift":1.5,"encrypted":"baBA"}
✓ packages/tiny-stdio-mcp-test-server/src/__probe__.test.ts > caesar cipher fractional shifts > silently truncates a schema-valid fractional rotation
```

## Observed Behavior

The tool schema declares `shift` with `type: "number"` in `packages/tiny-stdio-mcp-test-server/src/index.ts:3` through `packages/tiny-stdio-mcp-test-server/src/index.ts:10`, and both server factories pass it directly to `caesarEncrypt()` at lines 33 through 45 and 62 through 76. The exported encryption helper adds the supplied value inside `String.fromCharCode(...)` at lines 12 through 29. For `"azAZ"` and `1.5`, the arithmetic produces fractional code points, which `String.fromCharCode()` converts to integer characters; the result is `"baBA"`, identical to a shift of `1`, without any validation error.

## Expected Behavior

A Caesar cipher rotation should accept integer offsets only, or explicitly define and expose a different fractional-shift behavior. Since the public tool currently advertises arbitrary numeric input, it should reject non-integer `shift` values before execution rather than returning a silently truncated ciphertext.

## Impact

MCP clients and test integrations can send an input accepted by the published schema and receive a plausible-looking but semantically altered ciphertext. This makes the deterministic test server unreliable for validating numeric argument handling: fractional values are neither rejected nor represented faithfully, so client bugs and request-generation errors can pass unnoticed.
