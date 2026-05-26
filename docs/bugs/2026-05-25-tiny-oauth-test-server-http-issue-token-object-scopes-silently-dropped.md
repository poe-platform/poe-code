# Tiny OAuth test server HTTP issue-token object scopes silently dropped

## Summary

The `/testing/issue-token` endpoint accepts an explicitly malformed `scopes` payload object and silently interprets it as an empty grant. The request succeeds with an access token but omits the `scope` response field instead of rejecting invalid JSON input.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
import http from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createOAuthTestServer } from "./index.js";

async function request(input: URL, body: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const call = http.request({
      hostname: input.hostname,
      port: Number(input.port),
      path: input.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (response) => resolve(new Response(
      Readable.toWeb(response) as ReadableStream<Uint8Array>,
      { status: response.statusCode, headers: response.headers as Record<string, string> },
    )));
    call.on("error", reject);
    call.end(body);
  });
}

describe("invalid HTTP issue-token scopes", () => {
  it("silently treats an object scope payload as no granted scopes", async () => {
    const server = createOAuthTestServer({ signingKeySeed: "probe" });
    const handle = await server.listen({ hostname: "127.0.0.1", port: 0 });

    try {
      const response = await request(
        new URL("/testing/issue-token", server.issuer),
        JSON.stringify({
          client_id: "client",
          resource: "https://resource.example.test/mcp",
          scopes: { requested: "mcp.read" },
        }),
      );

      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect(body).not.toHaveProperty("scope");
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

The probe passes: the malformed `scopes` object receives HTTP `200` with a token response lacking any granted-scope declaration.

## Observed Behavior

`handleIssueToken()` accepts `scopes` only when it is a string or a string array, but its fallback for every other present value is `[]`. Thus an object-valued request is not reported as malformed; it is converted into an empty granted-scope array, used to mint a successful JWT, and omitted from the successful response body.

## Expected Behavior

If the optional `scopes` property is present, the endpoint should validate its supported representations and reject invalid types with `invalid_request`. Only an omitted field should mean the caller did not request scopes.

## Impact

Client serialization mistakes and malformed fixture requests are hidden as apparently valid token issuance with reduced privileges. This can cause confusing authorization failures later in a test flow while incorrectly indicating that the token endpoint accepted the requested input contract.
