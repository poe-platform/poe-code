---
name: "Toolcraft OpenAPI unauthenticated 401 deletes saved credential"
---

# Toolcraft OpenAPI unauthenticated 401 deletes saved credential

## Summary

The exported `toolcraft-openapi` `requestJson()` API supports `auth: "none"` requests that explicitly skip bearer-token resolution and send no `Authorization` header. However, if such an unauthenticated request receives HTTP `401 Unauthorized`, it still calls `tokenSource.invalidate()`. With the built-in `bearerTokenAuth()` provider, that invalidation deletes a saved credential unrelated to the failed request.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft-openapi/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserError } from "toolcraft";

const store = vi.hoisted(() => {
  let value: string | null = "saved-token";
  return {
    get: vi.fn(async () => value),
    set: vi.fn(async (next: string) => { value = next; }),
    delete: vi.fn(async () => { value = null; }),
    reset() { value = "saved-token"; this.get.mockClear(); this.set.mockClear(); this.delete.mockClear(); }
  };
});

vi.mock("auth-store", () => ({
  createSecretStore: () => ({ backend: "file", store })
}));

import { bearerTokenAuth } from "./auth/bearer-token-auth.js";
import { requestJson } from "./http.js";

describe("unauthenticated request invalidation", () => {
  afterEach(() => store.reset());

  it("deletes a saved token after a request that sent no authorization header receives 401", async () => {
    const auth = bearerTokenAuth({ serviceName: "probe", envVar: "PROBE_TOKEN" });

    await expect(requestJson({
      baseUrl: "https://api.example.test",
      path: "/public-route",
      method: "GET",
      auth: "none",
      tokenSource: auth,
      fetch: vi.fn(async (_url, init) => {
        expect(init?.headers).toEqual({});
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          statusText: "Unauthorized",
          headers: { "content-type": "application/json" }
        });
      })
    })).rejects.toThrow("401 Unauthorized");

    await expect(auth.getToken()).rejects.toEqual(new UserError("Run 'auth login' first."));
    expect(store.delete).toHaveBeenCalledTimes(1);
  });
});
```

Run the targeted probe, then remove it:

```sh
npm exec -- vitest run packages/toolcraft-openapi/src/__probe__.test.ts --reporter verbose
rm -f packages/toolcraft-openapi/src/__probe__.test.ts
```

The observed run is:

```text
✓ packages/toolcraft-openapi/src/__probe__.test.ts > unauthenticated request invalidation > deletes a saved token after a request that sent no authorization header receives 401
```

## Observed Behavior

The request is configured with `auth: "none"` and its outgoing headers are `{}`, confirming that the saved token is never resolved or transmitted. Nevertheless, after the response returns `401 Unauthorized`, `store.delete()` is called and a later `auth.getToken()` reports that login is required. In `packages/toolcraft-openapi/src/http.ts`, token retrieval is skipped when authentication is disabled, but the response-handling path invokes invalidation solely based on response status. In `packages/toolcraft-openapi/src/auth/bearer-token-auth.ts`, invalidation unconditionally deletes the provider's persisted secret.

## Expected Behavior

Credential invalidation must occur only for an authenticated request that actually used the credential being invalidated. Requests configured with `auth: "none"` should not mutate stored authentication state in response to their HTTP status, because no saved credential participated in the request.

## Impact

Generated or handwritten API operations that intentionally make unauthenticated calls can erase working user credentials if an endpoint answers with `401`, such as when optional-public endpoints change policy or reject anonymous access. A harmless public-route probe can therefore log a user out of unrelated authenticated operations and force credential recovery or relogin.
