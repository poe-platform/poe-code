# Tiny MCP client reconnect retains old capabilities and allows pre-initialize calls

## Summary

The exported `tiny-mcp-client` `McpClient` preserves a previous server's negotiated capabilities after `close()`, and public method guards do not require the client state to be `ready`. When the same client object begins connecting to a new server, code can immediately issue methods supported only by the previous connection before the replacement server has answered `initialize`.

## Reproduction

From the repository root, connect once to a server advertising tools, close the client, then start a second connection without answering its initialize request before calling `listTools()`:

```sh
cat > /tmp/tiny-mcp-client-reconnect-stale-capabilities-probe.mjs <<'EOF'
import { PassThrough } from "node:stream";
import { McpClient } from "/Users/kjopek/Workspace/poe-code/packages/tiny-mcp-client/dist/internal.js";

function makeTransport() {
  const readable = new PassThrough();
  const writable = new PassThrough();
  return {
    readable,
    writable,
    iterator: writable[Symbol.asyncIterator](),
    transport: { readable, writable, closed: new Promise(() => {}), dispose() {} }
  };
}
async function nextJson(pair) {
  const item = await pair.iterator.next();
  if (item.done) throw new Error("stream ended");
  return JSON.parse(String(item.value));
}

const client = new McpClient({ clientInfo: { name: "probe", version: "1.0.0" } });
const first = makeTransport();
const firstConnect = client.connect(first.transport);
const firstInit = await nextJson(first);
first.readable.write(`${JSON.stringify({ jsonrpc: "2.0", id: firstInit.id, result: {
  protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "first", version: "1" }
}})}\n`);
await firstConnect;
await nextJson(first);
await client.close();

const second = makeTransport();
const secondConnect = client.connect(second.transport);
const secondInit = await nextJson(second);
console.log(`stateDuringReconnect=${client.state}`);
console.log(`retainedTools=${JSON.stringify(client.serverCapabilities)}`);
const listPromise = client.listTools();
const premature = await nextJson(second);
console.log(`prematureMethod=${premature.method}`);
console.log(`beforeInitializeResolved=${premature.id > secondInit.id}`);
second.readable.write(`${JSON.stringify({ jsonrpc: "2.0", id: premature.id, result: { tools: [] } })}\n`);
console.log(`prematureResult=${JSON.stringify(await listPromise)}`);
await client.close();
try { await secondConnect; } catch (error) { console.log(`connectClosed=${error.message}`); }
EOF

node /tmp/tiny-mcp-client-reconnect-stale-capabilities-probe.mjs

nl -ba packages/tiny-mcp-client/src/internal.ts | sed -n '116,163p;296,357p;360,382p'
```

## Observed Behavior

The second transport receives `tools/list` while its `initialize` request is still unanswered, because `serverCapabilities` still contains the first server's tools capability:

```text
stateDuringReconnect=initializing
retainedTools={"tools":{}}
prematureMethod=tools/list
beforeInitializeResolved=true
prematureResult={"tools":[]}
connectClosed=MCP client closed
```

`packages/tiny-mcp-client/src/internal.ts:116` through `packages/tiny-mcp-client/src/internal.ts:122` store server capabilities separately from connection state. `packages/tiny-mcp-client/src/internal.ts:297` through `packages/tiny-mcp-client/src/internal.ts:354` start a replacement initialization without clearing old negotiated metadata. `getMessageLayerOrThrow()` at `packages/tiny-mcp-client/src/internal.ts:144` through `packages/tiny-mcp-client/src/internal.ts:157` accepts the `initializing` state, while `listTools()` at `packages/tiny-mcp-client/src/internal.ts:367` through `packages/tiny-mcp-client/src/internal.ts:378` checks the retained old capabilities and transmits a new-server request before its handshake completes.

## Expected Behavior

A new connection attempt should clear all previous server-negotiated metadata before any API method can inspect it, and client operations requiring negotiation should be rejected until the replacement initialize handshake reaches the `ready` state.

## Impact

Applications reusing an `McpClient` object across endpoints or reconnect attempts can send requests that the current server has not authorized or advertised, based solely on a previous server's capabilities. This violates handshake ordering, can expose method calls to the wrong endpoint, and makes behavior dependent on stale connection history.
