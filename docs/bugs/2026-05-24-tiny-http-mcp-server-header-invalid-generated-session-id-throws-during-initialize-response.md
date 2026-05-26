# Tiny HTTP MCP server header-invalid generated session ID throws during initialize response

## Summary

`tiny-http-mcp-server` exposes a configurable `sessionIdGenerator`, but does not validate generated identifiers before storing them and emitting them in the `Mcp-Session-Id` response header. A generator value containing a header-invalid control character causes normal initialization handling to throw a Node HTTP exception instead of returning a controlled MCP response.

## Reproduction

From the repository root, run a disposable Vitest probe that supplies a newline-containing session ID through the documented generator option and invokes the public request handler directly:

```sh
cat > /tmp/tiny-http-mcp-invalid-session-id-direct-probe.test.ts <<'PROBE'
import { Readable } from "node:stream";
import { ServerResponse, type IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "./test-support.js";

describe("tiny HTTP MCP invalid generated session id", () => {
  it("throws when a configured generator returns a header-invalid id", async () => {
    const server = createTestMcpServer({ enableJsonResponse: true, sessionIdGenerator: () => "bad\nsession" });
    const request = Object.assign(Readable.from([JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })]), {
      method: "POST",
      headers: { "content-type": "application/json" },
    }) as IncomingMessage;
    const response = new ServerResponse(request);
    let message = "";
    try {
      await server.handleRequest(request, response);
    } catch (error) {
      message = String(error);
    }
    console.log(JSON.stringify({ message }));
    expect(message).toContain('Invalid character in header content ["Mcp-Session-Id"]');
  });
});
PROBE
cp /tmp/tiny-http-mcp-invalid-session-id-direct-probe.test.ts packages/tiny-http-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-http-mcp-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The initialization request rejects with Node's invalid-header exception rather than producing an HTTP or JSON-RPC response:

```text
{"message":"TypeError [ERR_INVALID_CHAR]: Invalid character in header content [\"Mcp-Session-Id\"]"}
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > tiny HTTP MCP invalid generated session id > throws when a configured generator returns a header-invalid id
```

`packages/tiny-http-mcp-server/src/http-transport.ts:126` through `packages/tiny-http-mcp-server/src/http-transport.ts:133` accept the generator's raw string and store it as a session identifier. `packages/tiny-http-mcp-server/src/http-transport.ts:330` through `packages/tiny-http-mcp-server/src/http-transport.ts:352` then copy that value into response headers without validating the visible-ASCII/session-header invariant before calling `res.writeHead()`.

## Expected Behavior

Generated session identifiers should be validated before session creation and before header emission. A non-visible or header-invalid value should yield a controlled configuration or protocol error without throwing during request response handling.

## Impact

A misconfigured or adversarial custom session ID generator can convert routine initialization requests into unhandled server exceptions and failed HTTP connections. This creates a denial-of-service path in deployments using application-supplied session ID generation and violates the package's own visible-ASCII session expectation.
