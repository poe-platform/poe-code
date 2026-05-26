# Tiny OAuth test server accepts mailto issuer then fails HTTP requests

## Summary

`createOAuthTestServer()` treats any absolute URL without a fragment as an acceptable issuer, including non-hierarchical URLs such as `mailto:oauth@example.test`. The server then listens successfully but ordinary HTTP requests fail internally while endpoint URLs are derived from that unusable issuer.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createOAuthTestServer } from "./index.js";

describe("issuer scheme validation", () => {
  it("accepts a non-hierarchical issuer then fails ordinary requests", async () => {
    const server = createOAuthTestServer({
      issuer: "mailto:oauth@example.test",
      signingKeySeed: "probe",
    });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });

    try {
      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const request = import("node:http").then(({ default: http }) => {
          const call = http.request(handle.url, (incoming) => {
            let body = "";
            incoming.on("data", (chunk) => { body += String(chunk); });
            incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, body }));
          });
          call.on("error", reject);
          call.end();
        });
        request.catch(reject);
      });

      expect(response.status).toBe(500);
      expect(response.body).toContain("Invalid URL");
    } finally {
      await handle.close();
    }
  });
});
```

Run:

```sh
npm exec -- vitest run packages/tiny-oauth-test-server/src/__probe__.test.ts --reporter verbose
```

The probe passes: construction and listening succeed, but a normal request to the live server receives HTTP `500` containing `Invalid URL`.

## Observed Behavior

`parseAbsoluteUrl()` validates only that `new URL(value)` succeeds and that no fragment is present. `normalizeIssuer()` therefore accepts `mailto:oauth@example.test`. Once the listener handles a request, `getEndpointPaths()` tries to construct HTTP OAuth endpoint URLs relative to that non-hierarchical issuer using `new URL(authorizePath, issuer)`, which throws. The request-level error handler serializes the exception as an HTTP `500` response.

## Expected Behavior

The fixture should reject issuer URLs that cannot act as an HTTP authorization-server base URL before it starts listening. At minimum, configured issuers should be restricted to supported hierarchical HTTP(S) URLs with usable origins and paths.

## Impact

A fixture can appear to initialize and listen successfully while all normal OAuth metadata and endpoint requests fail as internal server errors. This delays feedback about invalid setup and turns a configuration mistake into misleading server-side request failures in integration tests and demos.
