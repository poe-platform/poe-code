# Tiny stdio MCP test server NaN Caesar shift emits null bytes

## Summary

`caesarEncrypt()` and the exposed `caesar_cipher_encrypt` tool accept `NaN` as a numeric shift. Encrypting ordinary alphabetic text with that value maps every ASCII letter to a NUL byte (`\0`) instead of rejecting the invalid shift or returning readable encrypted text.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-stdio-mcp-test-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { caesarEncrypt } from "./index.js";

describe("non-finite Caesar shift", () => {
  it("turns alphabetic input into NUL characters for NaN shift", () => {
    expect(caesarEncrypt("Abc", Number.NaN)).toBe("\0\0\0");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/tiny-stdio-mcp-test-server/src/__probe__.test.ts --reporter verbose
```

The probe passes, proving alphabetic input is emitted as embedded null bytes when the accepted numeric argument is `NaN`.

## Observed Behavior

`caesarEncrypt()` uses `((char.charCodeAt(0) - base + shift) % 26) + base` without checking that `shift` is finite. With `Number.NaN`, the arithmetic remains `NaN`, and `String.fromCharCode(NaN)` coerces that value to character code zero. Each input letter therefore becomes `\0`, while nonletters remain unchanged.

## Expected Behavior

The SDK helper and MCP tool should reject non-finite shift values such as `NaN`, or normalize only valid finite integer shifts. A Caesar cipher fixture should never transform ordinary text into binary control bytes because of a malformed numeric option.

## Impact

Clients can receive invisible NUL-filled tool output from a nominally text-only deterministic test server. This corrupts downstream assertions, logs, JSON/text displays, and protocol smoke tests in a way distinct from ordinary negative-shift wrapping defects.
