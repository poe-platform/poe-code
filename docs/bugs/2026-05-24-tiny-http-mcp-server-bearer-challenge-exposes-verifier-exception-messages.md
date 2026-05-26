# Tiny HTTP MCP server bearer challenge exposes verifier exception messages

## Summary

`tiny-http-mcp-server` converts any ordinary `Error` thrown by an OAuth token verifier into the public `error_description` field of its `WWW-Authenticate` bearer challenge. Verifier exceptions commonly contain operational diagnostics or credential material, so unauthenticated requests can receive internal verifier text directly in HTTP response headers.

## Reproduction

From the repository root, run this isolated passing probe with a verifier that throws diagnostic text containing sensitive values:

```sh
cat > /tmp/tiny-http-mcp-verifier-message-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { authorizeBearerRequest } from "./auth.js";

describe("tiny HTTP MCP verifier error disclosure", () => {
  it("places arbitrary verifier exception text into the bearer challenge", async () => {
    const result = await authorizeBearerRequest({
      headers: { authorization: "Bearer live-secret", host: "service.example.test" },
      socket: {}
    } as never, {
      resource: "https://service.example.test/mcp",
      authorizationServers: ["https://auth.example.test"],
      verifier: {
        async verify() {
          throw new Error("JWT rejected for live-secret because database-password=s3cr3t");
        }
      }
    });
    console.log(JSON.stringify(result));
    expect(result).toMatchObject({ ok: false, statusCode: 401 });
    if (result.ok) throw new Error("Expected challenge");
    expect(result.challenge).toContain("database-password=s3cr3t");
  });
});
EOF
cp /tmp/tiny-http-mcp-verifier-message-probe.test.ts packages/tiny-http-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-http-mcp-server/src/__probe__.test.ts /tmp/tiny-http-mcp-verifier-message-probe.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The unauthenticated bearer challenge includes the complete internal verifier exception message:

```text
{"ok":false,"statusCode":401,"challenge":"Bearer realm=\"mcp\", resource_metadata=\"http://service.example.test/.well-known/oauth-protected-resource\", error=\"invalid_token\", error_description=\"JWT rejected for live-secret because database-password=s3cr3t\""}
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > tiny HTTP MCP verifier error disclosure > places arbitrary verifier exception text into the bearer challenge
```

`packages/tiny-http-mcp-server/src/auth.ts:204` through `packages/tiny-http-mcp-server/src/auth.ts:209` translate any thrown `Error` into `{ error: "invalid_token", errorDescription: error.message }`. `authorizeBearerRequest()` then passes that message into `createBearerChallenge()` at `packages/tiny-http-mcp-server/src/auth.ts:297` through `packages/tiny-http-mcp-server/src/auth.ts:303`, exposing it as an HTTP response header.

## Expected Behavior

Unexpected token-verifier exceptions should produce a generic public `invalid_token` challenge while retaining detailed failure messages only for trusted server-side logging. Only explicitly selected safe protocol descriptions should be returned to clients.

## Impact

Anyone able to submit an invalid bearer token can trigger verifier failure paths and receive internal diagnostic text in response headers. Depending on verifier implementation, this can disclose submitted credentials, signing or database configuration, upstream error responses, filesystem paths, or other sensitive authentication internals.
