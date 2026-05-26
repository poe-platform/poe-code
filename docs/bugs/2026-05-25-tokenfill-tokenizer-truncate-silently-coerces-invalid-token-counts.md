# Tokenfill tokenizer truncate silently coerces invalid token counts

## Summary

The exported `tokenfill` tokenizer utility validates no `tokenCount` input in `truncate(text, tokenCount)`, even though the package describes exact token-count behavior and its top-level generator rejects non-integer counts. Calling `truncate()` with `1.5` silently returns one token, while passing `NaN` silently returns an empty string, instead of rejecting invalid requested counts.

## Reproduction

Create a disposable Vitest probe at `packages/tokenfill/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTokenizer } from "./tokenizer.js";

describe("tokenizer truncate invalid token count", () => {
  it("silently coerces non-integer and NaN counts instead of rejecting them", () => {
    const tokenizer = createTokenizer();
    try {
      const text = "one two three four";
      expect(tokenizer.count(text)).toBeGreaterThan(2);

      const fractional = tokenizer.truncate(text, 1.5);
      const notANumber = tokenizer.truncate(text, Number.NaN);

      console.log(JSON.stringify({
        fractional,
        fractionalTokens: tokenizer.count(fractional),
        notANumber,
      }));

      expect(tokenizer.count(fractional)).toBe(1);
      expect(notANumber).toBe("");
    } finally {
      tokenizer.free();
    }
  });
});
```

Run:

```sh
npm exec -- vitest run packages/tokenfill/src/__probe__.test.ts --reporter verbose
```

The test passes and prints:

```text
{"fractional":"one","fractionalTokens":1,"notANumber":""}
✓ packages/tokenfill/src/__probe__.test.ts > tokenizer truncate invalid token count > silently coerces non-integer and NaN counts instead of rejecting them
```

Remove the disposable probe after confirmation.

## Observed Behavior

`createTokenizer()` exposes `truncate(text, tokenCount)` as a public utility in `packages/tokenfill/src/tokenizer.ts`. Its implementation checks only `tokenCount <= 0`, then passes any remaining value directly to `tokens.slice(0, tokenCount)`. JavaScript coerces `1.5` to an integer slice boundary and `NaN` to zero, so invalid requests resolve successfully with outputs representing different effective token counts. By contrast, the public `tokenfill(tokenCount)` generator explicitly rejects values that are not non-negative integers in `packages/tokenfill/src/tokenfill.ts`.

## Expected Behavior

`truncate(text, tokenCount)` should enforce the same non-negative integer input contract used by the package's generator and CLI. Non-integer or non-finite requested token counts should reject with a clear argument error rather than being silently coerced into another truncation request.

## Impact

SDK consumers performing prompt budgeting or truncation from calculated limits can pass a malformed count and receive a successful but incorrectly sized result. The silent coercion hides upstream arithmetic bugs, produces misleading token-budget behavior, and makes the exported tokenizer utility inconsistent with the package's exact-count guarantee and validated generator entrypoint.
