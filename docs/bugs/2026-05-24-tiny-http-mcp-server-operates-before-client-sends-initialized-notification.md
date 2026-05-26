# Tiny HTTP MCP server operates before the client sends notifications/initialized

## Summary

The bundled MCP server switches into its operational state immediately when it handles an `initialize` request, rather than waiting for the client to send the required `notifications/initialized` acknowledgement. A stateful HTTP session can invoke tools methods and receive server-originated tool-change notifications after the initialize response even when it never completes the lifecycle handshake.

## Reproduction

From the repository root, issue `initialize`, deliberately omit `notifications/initialized`, then invoke `tools/list` and open the session event stream before causing a tool-change notification:

```sh
cat > /tmp/tiny-http-operates-before-initialized-notification-probe.mjs <<'EOF'
import { createHttpServer, nodeFetch } from "/Users/kjopek/Workspace/poe-code/packages/tiny-http-mcp-server/dist/index.js";

const server = createHttpServer({ name: "probe", version: "1", enableJsonResponse: true });
const handle = await server.listenHttp({ port: 0 });
try {
  const initialize = await nodeFetch(handle.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" }
    })
  });
  const sessionId = initialize.headers.get("mcp-session-id");
  await initialize.text();
  const list = await nodeFetch(handle.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Mcp-Session-Id": sessionId ?? ""
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })
  });
  console.log(`sessionId=${sessionId}`);
  console.log(`listStatus=${list.status}`);
  console.log(`listBody=${await list.text()}`);
  const stream = await nodeFetch(handle.url, {
    method: "GET",
    headers: { Accept: "text/event-stream", "Mcp-Session-Id": sessionId ?? "" }
  });
  const reader = stream.body.getReader();
  await server.notifyToolsChanged();
  const event = await reader.read();
  console.log(`notification=${new TextDecoder().decode(event.value).trim()}`);
  await reader.cancel();
} finally {
  await handle.close();
}
EOF

node /tmp/tiny-http-operates-before-initialized-notification-probe.mjs

nl -ba packages/tiny-stdio-mcp-server/src/server.ts | sed -n '55,105p;236,244p'
nl -ba packages/tiny-http-mcp-server/src/http-transport.ts | sed -n '142,180p;209,252p'
```

## Observed Behavior

Without ever sending `notifications/initialized`, the session successfully executes `tools/list` and receives an asynchronous tools-change event:

```text
sessionId=06922521-6cf8-46cb-8d88-8c31f2f05b8e
listStatus=200
listBody={"jsonrpc":"2.0","id":2,"result":{"tools":[]}}
notification=data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}
```

For MCP lifecycle revision `2025-03-26`, initialization completes only after the client acknowledges the initialize result with `notifications/initialized`, and servers must not send ordinary requests or notifications before that acknowledgement. `packages/tiny-stdio-mcp-server/src/server.ts:66` through `packages/tiny-stdio-mcp-server/src/server.ts:99` set the shared `initialized` flag while producing the initialize response, while `packages/tiny-stdio-mcp-server/src/server.ts:240` through `packages/tiny-stdio-mcp-server/src/server.ts:243` emit notifications based on that premature state. The HTTP transport exposes the session GET stream at `packages/tiny-http-mcp-server/src/http-transport.ts:209` through `packages/tiny-http-mcp-server/src/http-transport.ts:252` without requiring the client acknowledgement.

## Expected Behavior

The server should remain in initialization phase after returning the initialize result and transition to normal request and notification handling only after that same session supplies `notifications/initialized`. Before then, ordinary methods such as `tools/list` should be rejected and asynchronous tool-change events should not be emitted.

## Impact

Clients that reject, abandon, or never acknowledge initialization can still exercise server functionality and subscribe to updates. This breaks lifecycle negotiation boundaries, enables work to occur in sessions that were never fully established, and may expose tools or server changes to connections that should still be non-operational.
