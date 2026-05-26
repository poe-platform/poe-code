# Toolcraft OpenAPI environment token 401 deletes stored fallback credential

## Summary

The exported `toolcraft-openapi` `bearerTokenAuth()` provider prefers an environment bearer token over a stored credential, but its generic unauthorized-response invalidation always deletes the stored secret. When a temporary or stale environment token receives HTTP `401`, a valid encrypted-file or Keychain fallback credential that was never transmitted is permanently removed.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft-openapi/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserError } from "toolcraft";

const store = vi.hoisted(() => {
  let value: string | null = "stored-fallback";
  return {
    get: vi.fn(async () => value),
    set: vi.fn(async (next: string) => { value = next; }),
    delete: vi.fn(async () => { value = null; }),
    reset() { value = "stored-fallback"; this.get.mockClear(); this.set.mockClear(); this.delete.mockClear(); }
  };
});

vi.mock("auth-store", () => ({
  createSecretStore: () => ({ backend: "file", store })
}));

import { bearerTokenAuth } from "./auth/bearer-token-auth.js";
import { requestJson } from "./http.js";

describe("environment bearer invalidation", () => {
  afterEach(() => {
    delete process.env.PROBE_TOKEN;
    store.reset();
  });

  it("deletes a usable stored fallback after only the environment token receives 401", async () => {
    process.env.PROBE_TOKEN = "expired-environment-token";
    const auth = bearerTokenAuth({ serviceName: "probe", envVar: "PROBE_TOKEN" });

    await expect(requestJson({
      baseUrl: "https://api.example.test",
      path: "/resource",
      method: "GET",
      auth: "required",
      tokenSource: auth,
      fetch: vi.fn(async (_url, init) => {
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer expired-environment-token");
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          statusText: "Unauthorized",
          headers: { "content-type": "application/json" }
        });
      })
    })).rejects.toThrow("401 Unauthorized");

    delete process.env.PROBE_TOKEN;
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
✓ packages/toolcraft-openapi/src/__probe__.test.ts > environment bearer invalidation > deletes a usable stored fallback after only the environment token receives 401
```

## Observed Behavior

The request sends `Authorization: Bearer expired-environment-token`, receives `401 Unauthorized`, and invokes `store.delete()`. After the environment variable is removed, `auth.getToken()` rejects with `Run 'auth login' first.` even though `stored-fallback` was present before the failed request and was never used. In `packages/toolcraft-openapi/src/auth/bearer-token-auth.ts`, `resolveToken()` chooses the environment value before reading the store, while `invalidate()` unconditionally deletes the store. In `packages/toolcraft-openapi/src/http.ts`, every `401` invokes `options.tokenSource.invalidate?.()` without knowing which source produced the transmitted token.

## Expected Behavior

Unauthorized handling should invalidate only the credential source actually used for the failed request. A failed environment override should leave an independently stored fallback intact, allowing a later request without that environment override to use the previously saved credential.

## Impact

Users who have a valid stored API token but temporarily run with an expired or mistyped environment override can lose their saved credential after a single failed request. This converts an ephemeral configuration mistake into destructive credential loss, forcing unnecessary relogin or secret recovery and making authentication failures unexpectedly mutate persistent state.
