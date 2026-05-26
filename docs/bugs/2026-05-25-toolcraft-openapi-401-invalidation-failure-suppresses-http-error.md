# Toolcraft OpenAPI 401 invalidation failure suppresses HTTP error

## Summary

The exported `toolcraft-openapi` `requestJson()` API awaits token-source invalidation immediately after receiving HTTP `401 Unauthorized`. If credential cleanup rejects, the cleanup exception replaces the already-received `HttpError`, so callers lose the authoritative server response and cannot tell that authentication failed.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft-openapi/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { HttpError, requestJson } from "./http.js";

describe("unauthorized invalidation failure", () => {
  it("rejects with storage cleanup failure instead of the received HTTP 401", async () => {
    const cleanupError = new Error("credential store unavailable");
    let caught: unknown;

    try {
      await requestJson({
        baseUrl: "https://api.example.test",
        path: "/resource",
        method: "GET",
        auth: "required",
        tokenSource: {
          getToken: async () => "expired-token",
          invalidate: vi.fn(async () => { throw cleanupError; })
        },
        fetch: vi.fn(async () => new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          statusText: "Unauthorized",
          headers: { "content-type": "application/json" }
        }))
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(cleanupError);
    expect(caught).not.toBeInstanceOf(HttpError);
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
✓ packages/toolcraft-openapi/src/__probe__.test.ts > unauthorized invalidation failure > rejects with storage cleanup failure instead of the received HTTP 401
```

## Observed Behavior

The mocked API returns a complete JSON `401 Unauthorized` response, but `requestJson()` rejects with the exact `Error("credential store unavailable")` thrown from `tokenSource.invalidate()` and not with an `HttpError`. In `packages/toolcraft-openapi/src/http.ts`, the response has already been read and normalized before the `401` branch awaits invalidation; only after that await succeeds does the function parse the response body and construct its public `HttpError`. The built-in `bearerTokenAuth()` provider implements invalidation by deleting persisted secret state, so an encrypted-store or Keychain cleanup failure can take this path during ordinary authenticated requests.

## Expected Behavior

Once an HTTP response has been received, `requestJson()` should preserve and surface that response as the primary request outcome. Failure to invalidate local credentials should either be recorded as secondary context/cause or reported separately without suppressing the `401 Unauthorized` error and response details.

## Impact

Callers handling authentication expiry or access revocation can receive a local credential-store failure instead of the actual API denial. This obscures whether a request reached the server, hides response status and body details needed for remediation, and can cause SDK or CLI workflows to diagnose an authentication failure as only a local persistence problem.
