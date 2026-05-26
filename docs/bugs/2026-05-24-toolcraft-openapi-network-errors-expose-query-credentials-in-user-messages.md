# Toolcraft OpenAPI network errors expose query credentials in user messages

## Summary

`@poe-code/toolcraft-openapi` converts low-level fetch failures into user-facing network errors, but those error messages embed the complete request URL. If an API operation carries authentication in a query parameter, a DNS, abort, timeout, or generic fetch failure can disclose that credential before any HTTP response exists.

## Reproduction

Add the following temporary probe as `packages/toolcraft-openapi/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { requestJson } from "./http.js";

describe("network failures with query credentials", () => {
  it("includes query tokens in the surfaced network error message", async () => {
    let message = "";
    try {
      await requestJson({
        baseUrl: "https://api.example.test",
        path: "/items",
        method: "GET",
        auth: "none",
        tokenSource: { async getToken() { return undefined; } },
        query: { api_key: "network-secret-token" },
        fetch: async () => { throw new TypeError("fetch failed"); }
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    console.log(JSON.stringify({ message }));
    expect(message).toContain("network-secret-token");
  });
});
```

Run:

```sh
npm exec vitest run -- packages/toolcraft-openapi/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"message":"Network request failed: https://api.example.test/items?api_key=network-secret-token."}
✓ packages/toolcraft-openapi/src/__probe__.test.ts > network failures with query credentials > includes query tokens in the surfaced network error message
```

Remove the temporary probe after confirming the reproduction.

## Observed Behavior

A generic rejected fetch produces a `UserError` string that includes `api_key=network-secret-token` verbatim. `requestJson()` passes its fully expanded URL to `classifyNetworkError()` in `packages/toolcraft-openapi/src/http.ts`, and `classifyNetworkError()` in `packages/toolcraft-openapi/src/network-error.ts` interpolates the unredacted URL into generic failure, abort, and timeout messages.

## Expected Behavior

User-facing network errors should sanitize sensitive URL query parameters before including a request location in messages. Credential-bearing values must remain redacted consistently across response errors, transport failures, cancellations, and timeouts.

## Impact

Connectivity failures and cancellations are commonly surfaced directly in CLI output or logs. Query-authenticated API operations can therefore reveal credentials merely because the network is unavailable or a request is aborted, leaking secrets during routine troubleshooting and retry flows.
