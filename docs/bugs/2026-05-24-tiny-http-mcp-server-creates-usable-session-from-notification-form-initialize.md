# Tiny HTTP MCP server creates a usable session from notification-form initialize

## Summary

`tiny-http-mcp-server` accepts an id-less JSON-RPC `initialize` notification as the message that creates a new session. The transport returns `202 Accepted` with no initialization result, but still attaches a fresh `Mcp-Session-Id`; that session immediately accepts normal MCP requests such as `tools/list` without any successful initialize response exchange.

## Reproduction

From the repository root, run a disposable Vitest probe that posts notification-form `initialize`, captures the session header from the empty `202` response, and reuses it for `tools/list`:

```sh
cat > /tmp/tiny-http-mcp-initialize-notification-probe.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { createTestMcpServer, nodeFetch } from "./test-support.js";

describe("tiny HTTP MCP initialize notification", () => {
  it("creates a usable session from id-less initialize without returning negotiation", async () => {
    const server = createTestMcpServer({ enableJsonResponse: true, sessionIdGenerator: () => "session-notify" });
    const handle = await server.listenHttp({ port: 0, hostname: "127.0.0.1" });
    try {
      const initialized = await nodeFetch(handle.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "2025-03-26" } }),
      });
      const sessionId = initialized.headers.get("mcp-session-id");
      const tools = await nodeFetch(handle.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Mcp-Session-Id": sessionId ?? "" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      const body = await tools.json();
      console.log(JSON.stringify({ initializeStatus: initialized.status, initializeBody: await initialized.text(), sessionId, toolsStatus: tools.status, toolsCount: body.result.tools.length }));
      expect(initialized.status).toBe(202);
      expect(sessionId).toBe("session-notify");
      expect(body.result.tools.length).toBeGreaterThan(0);
    } finally {
      await handle.close();
    }
  });
});
PROBE
cp /tmp/tiny-http-mcp-initialize-notification-probe.test.ts packages/tiny-http-mcp-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-http-mcp-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The HTTP request carrying only an id-less `initialize` gets an empty accepted response while also minting a session that successfully exposes all test tools:

```text
{"initializeStatus":202,"initializeBody":"","sessionId":"session-notify","toolsStatus":200,"toolsCount":14}
✓ packages/tiny-http-mcp-server/src/__probe__.test.ts > tiny HTTP MCP initialize notification > creates a usable session from id-less initialize without returning negotiation
```

`packages/tiny-http-mcp-server/src/http-transport.ts:118` through `packages/tiny-http-mcp-server/src/http-transport.ts:139` detect any `initialize` method in the parsed message list and allocate a new session before distinguishing request from notification. The transport then dispatches the id-less message into the shared server at `packages/tiny-http-mcp-server/src/http-transport.ts:142` through `packages/tiny-http-mcp-server/src/http-transport.ts:180`, which returns no body for a notification but still sends the new session header. The underlying state change occurs in `packages/tiny-stdio-mcp-server/src/server.ts:66` through `packages/tiny-stdio-mcp-server/src/server.ts:84`.

## Expected Behavior

A new HTTP session should be created only by a valid `initialize` request that receives a successful initialization result. Notification-form `initialize` must not mint a session identifier or authorize subsequent normal requests.

## Impact

Clients can obtain live MCP HTTP sessions without completing or even receiving initialization negotiation, bypassing the expected session establishment boundary. A malformed or hostile client can then enumerate or invoke tools through a session created from an invalid one-way message.
