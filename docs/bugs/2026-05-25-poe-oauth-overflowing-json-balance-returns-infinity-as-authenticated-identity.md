# Poe OAuth overflowing JSON balance returns Infinity as authenticated identity

## Summary

The exported `@poe-code/poe-oauth` `checkAuth()` helper accepts any JavaScript `number` returned in the Poe balance response, without requiring it to be finite. A standards-valid JSON response containing `current_point_balance: 1e309` is parsed by JavaScript as `Infinity`, and `checkAuth()` returns that value as a successful authenticated account identity.

## Reproduction

Create a disposable Vitest probe at `packages/poe-oauth/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkAuth } from "./check-auth.js";

describe("poe-oauth overflowing JSON balance", () => {
  it("returns JSON exponent overflow as an infinite authenticated balance", async () => {
    const identity = await checkAuth({
      apiKey: "sk-valid",
      fetch: async () => new Response(
        '{"email":"person@example.test","current_point_balance":1e309}',
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    });

    console.log(JSON.stringify({
      email: identity?.email,
      balance: String(identity?.balance),
      finite: Number.isFinite(identity?.balance),
    }));
    expect(identity).toEqual({ email: "person@example.test", balance: Infinity });
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/poe-oauth/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-oauth/src/__probe__.test.ts
```

The probe prints:

```text
{"email":"person@example.test","balance":"Infinity","finite":false}
✓ packages/poe-oauth/src/__probe__.test.ts > poe-oauth overflowing JSON balance > returns JSON exponent overflow as an infinite authenticated balance
```

## Observed Behavior

`packages/poe-oauth/src/index.ts` exports `checkAuth()`. In `packages/poe-oauth/src/check-auth.ts`, successful response payloads are mapped with `balance: typeof data.current_point_balance === "number" ? data.current_point_balance : null`. JSON numeric literals with sufficiently large exponents are valid JSON, and JavaScript's JSON parser produces `Infinity` for `1e309`. The helper consequently resolves `{ email: "person@example.test", balance: Infinity }` and identifies the key as authenticated despite exposing a non-finite account-balance value.

## Expected Behavior

Authenticated identity data should include a balance only when the response contains a finite numeric value. Numeric overflow or other non-finite decoded values should be normalized to `null` or rejected as a malformed API response rather than returned as valid account data.

## Impact

Callers that display, compare, aggregate, serialize, or use the returned balance to guide usage decisions can receive impossible account state after an otherwise successful authentication check. `Infinity` may serialize inconsistently as `null`, bypass low-balance checks, distort UI output or telemetry, and allow malformed or unexpectedly large server responses to contaminate trusted authentication metadata.
