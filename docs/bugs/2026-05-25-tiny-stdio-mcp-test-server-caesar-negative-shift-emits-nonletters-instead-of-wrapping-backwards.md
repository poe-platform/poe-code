# Tiny stdio MCP test server Caesar negative shift emits nonletters instead of wrapping backwards

## Summary

`tiny-stdio-mcp-test-server` exposes a Caesar cipher tool whose `shift` input schema accepts arbitrary numbers, but its exported encryption implementation handles negative shifts incorrectly. A valid negative shift maps letters before `A`/`a` into punctuation rather than wrapping backward through the alphabet.

## Reproduction

Add the following disposable test as `packages/tiny-stdio-mcp-test-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { caesarEncrypt } from "./index.js";

describe("caesar cipher negative shifts", () => {
  it("maps alphabetic input outside the alphabet instead of wrapping backwards", () => {
    expect(caesarEncrypt("aA", -1)).toBe("`@");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/tiny-stdio-mcp-test-server/src/__probe__.test.ts --reporter verbose
```

The test passes:

```text
✓ packages/tiny-stdio-mcp-test-server/src/__probe__.test.ts > caesar cipher negative shifts > maps alphabetic input outside the alphabet instead of wrapping backwards
```

Remove the disposable probe after confirmation.

## Observed Behavior

The package declares `shift` as an optional numeric tool input and directly passes it to `caesarEncrypt()`. That function calculates `((codePoint - alphabetStart + shift) % 26) + alphabetStart`. In JavaScript, `%` retains the sign of a negative dividend, so shifting `"aA"` by `-1` returns ``"`@"`` instead of alphabetic ciphertext.

## Expected Behavior

A Caesar cipher should wrap shifts in both directions. Since the public MCP schema accepts negative numeric shifts, `caesar_cipher_encrypt({ text: "aA", shift: -1 })` should produce `"zZ"`, or negative shifts should be rejected explicitly before execution.

## Impact

The public test-server tool returns invalid Caesar-cipher results for legitimate schema-valid input. Integrations and agent tests that use negative shifts receive punctuation instead of encrypted letters, so the deterministic fixture cannot reliably exercise bidirectional rotation behavior or validate clients against its advertised numeric parameter.
