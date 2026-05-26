# Tiny HTTP MCP server invalid forwarded protocol crashes authentication challenge

## Summary

`tiny-http-mcp-server` builds its bearer authentication challenge from forwarded-origin headers without validating them. An unauthenticated request containing an invalid `X-Forwarded-Proto` value causes protected-resource metadata URL construction to throw `Invalid URL`, so the server fails during challenge creation instead of responding with a normal `401` authentication requirement.

## Reproduction

From the repository root, run this isolated passing probe that attempts to authorize a request without credentials but with a malformed forwarded protocol value:

```sh
cat > /tmp/tiny-http-mcp-invalid-forwarded-proto-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { authorizeBearerRequest } from "./auth.js";

describe("tiny HTTP MCP malformed forwarded challenge origin", () => {
  it("throws while constructing a missing-token challenge for an invalid forwarded protocol", async () => {
    const outcome = await authorizeBearerRequest({
      headers: { host: "service.example.test", "x-forwarded-proto": "not a protocol" },
      socket: {}
    } as never, {
      resource: "https://service.example.test/mcp",
      authorizationServers: ["https://auth.example.test"],
      verifier: { async verify() { throw new Error("unused"); } }
    }).then(
      (value) => ({ resolved: value }),
      (error: unknown) => ({ rejected: error instanceof Error ? error.message : String(error) })
    );
    console.log(JSON.stringify({ outcome }));
    expect(outcome).toHaveProperty("rejected");
  });
});
EOF
cp /tmp/tiny-http-mcp-invalid-forwarded-proto-probe.test.ts packages/tiny-http-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-http-mcp-server/src/__probe__.test.ts /tmp/tiny-http-mcp-invalid-forwarded-proto-probe.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

Challenge generation rejects with an uncaught URL-construction error rather than returning a bearer-auth result:

```text
{"outcome":{"rejected":"Invalid URL"}}
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > tiny HTTP MCP malformed forwarded challenge origin > throws while constructing a missing-token challenge for an invalid forwarded protocol
```

`packages/tiny-http-mcp-server/src/auth.ts:108` through `packages/tiny-http-mcp-server/src/auth.ts:114` use `x-forwarded-proto` as the request protocol whenever the header is nonempty. `getProtectedResourceMetadataUrl()` at `packages/tiny-http-mcp-server/src/auth.ts:262` through `packages/tiny-http-mcp-server/src/auth.ts:270` concatenates that value into a base URL for `new URL(...)`, which throws before `authorizeBearerRequest()` can return the missing-token `401` challenge.

## Expected Behavior

Malformed forwarding headers on an unauthenticated request should not crash OAuth challenge construction. The server should ignore invalid untrusted forwarded-origin data or return a controlled authentication response using its canonical or direct request origin.

## Impact

Any client able to send requests to an OAuth-protected MCP endpoint can cause authentication handling to throw before returning `401` by adding a malformed forwarding header. Depending on the hosting integration, this can produce HTTP `500` responses, error logs, or unhandled middleware failures, allowing unauthenticated denial of service against the authentication entrypoint.
