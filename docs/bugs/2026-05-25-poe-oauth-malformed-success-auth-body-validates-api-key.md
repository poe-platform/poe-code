# Poe OAuth malformed successful auth body validates API key

## Summary

The exported `@poe-code/poe-oauth` `checkAuth()` helper treats any successfully parsed JSON body returned with HTTP `200` as an authenticated identity, even when the body is not an identity object at all. A balance endpoint response containing the valid JSON array `[]` resolves to `{ email: null, balance: null }`, and the CLI and SDK validation adapters interpret that non-null result as proof that the submitted API key is valid.

## Reproduction

Create a disposable Vitest probe at `packages/poe-oauth/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { checkAuth } from "./check-auth.js";

describe("poe-oauth malformed successful auth response", () => {
  it("does not authenticate a key when a 200 response is an array instead of identity data", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    await expect(
      checkAuth({ apiKey: "candidate-key", fetch: fetchMock as typeof fetch })
    ).resolves.toBeNull();
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/poe-oauth/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-oauth/src/__probe__.test.ts
```

## Observed Behavior

The assertion fails because an array response is converted into an apparently valid, non-null identity:

```text
FAIL  packages/poe-oauth/src/__probe__.test.ts > poe-oauth malformed successful auth response > does not authenticate a key when a 200 response is an array instead of identity data
AssertionError: expected { email: null, balance: null } to be null

- Expected:
null

+ Received:
{
  "balance": null,
  "email": null,
}
```

`checkAuth()` casts `await response.json()` to `CurrentBalanceResponse` without validating that the decoded value is an object, then returns an identity object for every HTTP-success response in `packages/poe-oauth/src/check-auth.ts:19`. Property reads from `[]` yield `undefined`, which are normalized to two `null` fields rather than causing authentication to fail. The CLI and SDK wire authentication validation as `(await checkAuth({ apiKey })) !== null` in `src/cli/container.ts:168` and `src/sdk/container.ts:146`, so this malformed response accepts the candidate key.

## Expected Behavior

API-key validation should succeed only when the successful endpoint response has the expected identity-object shape, or at minimum contains a valid authentication signal. Structurally invalid JSON roots such as arrays, primitive values, or empty unrelated objects should return `null` or reject as malformed responses rather than authenticate a key.

## Impact

If the authentication endpoint is misconfigured, proxied incorrectly, or returns an unexpected successful payload, login and configuration flows can accept and persist a rejected or unverified API key. Subsequent authenticated operations then fail later with confusing credential errors even though initial validation reported success, undermining the purpose of preflight key verification in both CLI and SDK paths.
