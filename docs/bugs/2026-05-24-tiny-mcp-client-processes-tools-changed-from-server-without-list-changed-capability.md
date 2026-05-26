# Tiny MCP client processes tools/list_changed from a server without the listChanged capability

## Summary

The exported `tiny-mcp-client` registers `notifications/tools/list_changed` handlers whenever the application supplies `onToolsChanged`, but does not check the capabilities negotiated from the server before executing that callback. A server that advertised no tools support or `listChanged` permission can still trigger the client's tool-refresh behavior.

## Reproduction

From the repository root, connect a client with an `onToolsChanged` callback to a server that returns an empty capability object, then send a tool-list-change notification:

```sh
cat > /tmp/tiny-mcp-client-server-notification-without-server-capability-probe.mjs <<'EOF'
import { PassThrough } from "node:stream";
import { McpClient } from "/Users/kjopek/Workspace/poe-code/packages/tiny-mcp-client/dist/internal.js";

const readable = new PassThrough();
const writable = new PassThrough();
let toolsChanged = 0;
const transport = { readable, writable, closed: new Promise(() => {}), dispose() {} };
const client = new McpClient({
  clientInfo: { name: "probe", version: "1" },
  onToolsChanged: () => { toolsChanged += 1; }
});
const iterator = writable[Symbol.asyncIterator]();
const connecting = client.connect(transport);
const initialize = JSON.parse(String((await iterator.next()).value));
readable.write(`${JSON.stringify({ jsonrpc: "2.0", id: initialize.id, result: {
  protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "server", version: "1" }
}})}\n`);
await connecting;
await iterator.next();
readable.write(`${JSON.stringify({
  jsonrpc: "2.0",
  method: "notifications/tools/list_changed"
})}\n`);
await new Promise((resolve) => setTimeout(resolve, 10));
console.log(`serverCapabilities=${JSON.stringify(client.serverCapabilities)}`);
console.log(`toolsChanged=${toolsChanged}`);
await client.close();
EOF

node /tmp/tiny-mcp-client-server-notification-without-server-capability-probe.mjs

nl -ba packages/tiny-mcp-client/src/internal.ts | sed -n '201,207p;337,354p;3246,3263p'
```

## Observed Behavior

Although the initialize result advertises no tools capability, the unexpected tools list-change notification invokes the application callback:

```text
serverCapabilities={}
toolsChanged=1
```

For protocol revision `2025-03-26`, the MCP tools specification states that servers supporting tools must declare `capabilities.tools`, and `tools.listChanged` indicates whether the server will emit `notifications/tools/list_changed`. `packages/tiny-mcp-client/src/internal.ts:201` through `packages/tiny-mcp-client/src/internal.ts:207` register the callback solely from client options; after server capabilities are stored at `packages/tiny-mcp-client/src/internal.ts:337` through `packages/tiny-mcp-client/src/internal.ts:354`, notification dispatch at `packages/tiny-mcp-client/src/internal.ts:3246` through `packages/tiny-mcp-client/src/internal.ts:3263` does not enforce those negotiated server capabilities.

## Expected Behavior

The client should invoke `onToolsChanged` only after the connected server has advertised `capabilities.tools.listChanged: true`. Notifications for optional features the server did not negotiate should be ignored or surfaced as protocol violations rather than delivered as trusted change signals.

## Impact

A non-compliant or malicious server can trigger unexpected refresh work and application state transitions through notifications it did not declare. Clients may perform redundant tool discovery, update user-visible tool registries, or react to unsupported server features despite the negotiated capability set saying that no such event source exists.
