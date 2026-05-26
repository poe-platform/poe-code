# Tiny MCP client rejected initialize handshake leaves the client stuck in initializing

## Summary

The exported `tiny-mcp-client` `McpClient.connect()` installs the transport and moves its state to `initializing` before validating the server's initialize response, but it does not dispose or release that connection when the handshake is rejected. A server that returns an unsupported protocol version makes `connect()` reject while the client remains attached to the failed transport and refuses a replacement connection.

## Reproduction

From the repository root, answer the first initialize request with a mismatched protocol version and then attempt to connect using a new transport:

```sh
cat > /tmp/tiny-mcp-client-rejected-initialize-wedges-state-probe.mjs <<'EOF'
import { PassThrough } from "node:stream";
import { McpClient } from "/Users/kjopek/Workspace/poe-code/packages/tiny-mcp-client/dist/internal.js";

function transportPair() {
  const readable = new PassThrough();
  const writable = new PassThrough();
  let disposed = 0;
  return {
    readable,
    writable,
    transport: {
      readable,
      writable,
      closed: new Promise(() => {}),
      dispose() { disposed += 1; }
    },
    get disposed() { return disposed; }
  };
}

const client = new McpClient({ clientInfo: { name: "probe", version: "1.0.0" } });
const first = transportPair();
const firstConnect = client.connect(first.transport);
const firstLine = await first.writable[Symbol.asyncIterator]().next();
const firstRequest = JSON.parse(String(firstLine.value));
first.readable.write(`${JSON.stringify({
  jsonrpc: "2.0",
  id: firstRequest.id,
  result: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    serverInfo: { name: "bad-server", version: "1.0.0" }
  }
})}\n`);
try {
  await firstConnect;
} catch (error) {
  console.log(`firstError=${error.message}`);
}
console.log(`stateAfterReject=${client.state}`);
console.log(`firstDisposed=${first.disposed}`);
const second = transportPair();
try {
  await client.connect(second.transport);
  console.log("secondConnect=resolved");
} catch (error) {
  console.log(`secondConnect=${error.message}`);
}
await client.close();
console.log(`stateAfterClose=${client.state}`);
console.log(`firstDisposedAfterClose=${first.disposed}`);
EOF

node /tmp/tiny-mcp-client-rejected-initialize-wedges-state-probe.mjs

nl -ba packages/tiny-mcp-client/src/internal.ts | sed -n '116,170p;296,357p'
```

## Observed Behavior

`connect()` rejects because the server protocol version is unsupported, but the failed transport remains installed and a second connection attempt is rejected as though the first connection had succeeded:

```text
firstError=Unsupported protocol version: 2024-11-05
stateAfterReject=initializing
firstDisposed=0
secondConnect=MCP client is already connected
stateAfterClose=closed
firstDisposedAfterClose=1
```

`packages/tiny-mcp-client/src/internal.ts:160` through `packages/tiny-mcp-client/src/internal.ts:163` refuse connections while the state is `initializing`. `packages/tiny-mcp-client/src/internal.ts:297` through `packages/tiny-mcp-client/src/internal.ts:321` assign the transport and enter that state before the handshake completes, but `packages/tiny-mcp-client/src/internal.ts:337` through `packages/tiny-mcp-client/src/internal.ts:347` throw on an unsupported protocol version without disposing the transport, clearing the message layer, or changing the state.

## Expected Behavior

When initialization fails, `connect()` should clean up the rejected transport and return the client to a state that permits a fresh connection, or explicitly close the client as part of the failure. A failed handshake should not require an extra manual `close()` call to release hidden retained connection state.

## Impact

Protocol mismatches and other initialize-result validation failures leave applications with a client object that has already reported connection failure but cannot be retried. Retry and fallback logic must discover and work around an undocumented partial connection state, while the rejected transport remains live until explicitly closed.
