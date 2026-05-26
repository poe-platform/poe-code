# Tiny HTTP MCP server bearer challenge trusts client forwarded host for OAuth discovery

## Summary

`tiny-http-mcp-server` constructs its `WWW-Authenticate` OAuth protected-resource discovery URL from `X-Forwarded-Host` and `X-Forwarded-Proto` on every incoming request, without an option or trust boundary indicating that the request came through a trusted reverse proxy. A direct unauthenticated client can therefore make the server advertise attacker-controlled OAuth discovery metadata in its bearer challenge.

## Reproduction

From the repository root, run this isolated passing probe supplying forwarding headers directly to the exported bearer challenge helper:

```sh
cat > /tmp/tiny-http-mcp-forwarded-challenge-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { createBearerChallenge } from "./auth.js";

describe("tiny HTTP MCP bearer discovery forwarding headers", () => {
  it("advertises attacker-controlled resource metadata from client supplied forwarded headers", () => {
    const challenge = createBearerChallenge({
      headers: {
        host: "service.example.test",
        "x-forwarded-host": "attacker.example.test",
        "x-forwarded-proto": "https"
      },
      socket: {}
    } as never);
    console.log(challenge);
    expect(challenge).toContain('resource_metadata="https://attacker.example.test/.well-known/oauth-protected-resource"');
  });
});
EOF
cp /tmp/tiny-http-mcp-forwarded-challenge-probe.test.ts packages/tiny-http-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-http-mcp-server/src/__probe__.test.ts /tmp/tiny-http-mcp-forwarded-challenge-probe.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The bearer challenge points OAuth discovery at the host supplied by the unauthenticated request rather than the request's actual service host:

```text
Bearer realm="mcp", resource_metadata="https://attacker.example.test/.well-known/oauth-protected-resource"
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > tiny HTTP MCP bearer discovery forwarding headers > advertises attacker-controlled resource metadata from client supplied forwarded headers
```

`packages/tiny-http-mcp-server/src/auth.ts:108` through `packages/tiny-http-mcp-server/src/auth.ts:124` always prefer `x-forwarded-proto` and `x-forwarded-host` whenever present. `getProtectedResourceMetadataUrl()` at `packages/tiny-http-mcp-server/src/auth.ts:262` through `packages/tiny-http-mcp-server/src/auth.ts:270` then feeds those untrusted values into the `resource_metadata` parameter emitted by `createBearerChallenge()`.

## Expected Behavior

OAuth discovery challenges should use a configured canonical public URL, or forwarded headers only when the server is explicitly configured to trust a known proxy. Direct client-supplied forwarding headers must not alter the protected-resource metadata location advertised by the server.

## Impact

An attacker or misconfigured client can redirect MCP OAuth discovery to an external host by triggering an authentication challenge with crafted forwarding headers. OAuth-capable clients that follow the advertised metadata can be sent to attacker-controlled authorization configuration, enabling phishing, credential-flow confusion, or denial of authentication for the protected server.
