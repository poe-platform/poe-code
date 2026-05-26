# Poe OAuth query-bearing base URL misroutes balance validation

## Summary

The exported `poe-oauth` `checkAuth()` helper accepts a custom `baseUrl`, but constructs its balance endpoint through string concatenation. If the supplied base URL contains a query component, the intended `/usage/current_balance` path is appended inside the query value instead of becoming the request pathname, so API-key validation is sent to the wrong endpoint while the helper can still report authentication success based on that unrelated response.

## Reproduction

From the repository root, create and run a disposable probe, then delete it:

```sh
cat > packages/poe-oauth/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { checkAuth } from "./check-auth.js";

describe("Poe auth balance endpoint URL", () => {
  it("places the balance path inside a supplied query value", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ email: "a@example.test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const identity = await checkAuth({
      apiKey: "sk-probe",
      baseUrl: "https://api.example.test?tenant=demo",
      fetch: fetch as typeof globalThis.fetch,
    });

    const calledUrl = String(fetch.mock.calls[0]?.[0]);
    const parsed = new URL(calledUrl);
    console.log(JSON.stringify({ identity, calledUrl, pathname: parsed.pathname, tenant: parsed.searchParams.get("tenant") }));
    expect(identity).toEqual({ email: "a@example.test", balance: null });
    expect(calledUrl).toBe("https://api.example.test?tenant=demo/usage/current_balance");
    expect(parsed.pathname).toBe("/");
    expect(parsed.searchParams.get("tenant")).toBe("demo/usage/current_balance");
  });
});
EOF
npm exec -- vitest run packages/poe-oauth/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-oauth/src/__probe__.test.ts
```

The probe passes and shows that the request is issued at the root path with the balance suffix embedded in the query value:

```text
{"identity":{"email":"a@example.test","balance":null},"calledUrl":"https://api.example.test?tenant=demo/usage/current_balance","pathname":"/","tenant":"demo/usage/current_balance"}
✓ packages/poe-oauth/src/__probe__.test.ts > Poe auth balance endpoint URL > places the balance path inside a supplied query value
```

## Observed Behavior

`checkAuth()` invokes `createCurrentBalanceUrl(options.baseUrl ?? DEFAULT_BASE_URL)` before fetching the validation endpoint at `packages/poe-oauth/src/check-auth.ts:19` through `packages/poe-oauth/src/check-auth.ts:31`. `createCurrentBalanceUrl()` removes only a trailing slash and then constructs the URL with ```${normalizedBaseUrl}/usage/current_balance``` at `packages/poe-oauth/src/check-auth.ts:48` through `packages/poe-oauth/src/check-auth.ts:51`.

For `baseUrl: "https://api.example.test?tenant=demo"`, that expression produces `https://api.example.test?tenant=demo/usage/current_balance`. URL parsing shows a pathname of `/` and a `tenant` query value of `demo/usage/current_balance`, rather than a `/usage/current_balance` request path. Because `checkAuth()` trusts any HTTP `200` JSON response sufficiently to return an identity object, a response from the wrong route can still be interpreted as validated authentication state.

## Expected Behavior

`checkAuth()` should either reject custom API base URLs containing unsupported query or fragment components, or derive `/usage/current_balance` using URL path resolution while preserving only explicitly supported URL components. API-key validation must target the balance endpoint represented by the provided base origin/path, not an accidentally altered query string.

## Impact

Consumers that configure a Poe-compatible API endpoint with a tenant, gateway, or routing query parameter can validate credentials against an unintended path. Depending on upstream routing behavior, legitimate keys may fail validation or unrelated successful JSON responses may be treated as authentication evidence, undermining login checks for custom endpoints.
