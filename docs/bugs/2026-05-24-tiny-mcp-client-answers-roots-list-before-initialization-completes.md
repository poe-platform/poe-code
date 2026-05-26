# Tiny MCP client answers roots/list before initialization completes

## Summary

The exported `tiny-mcp-client` installs optional server-request handlers before its initialize handshake has completed. A server can send `roots/list` while `connect()` is still awaiting the initialize response, and the client immediately invokes the application's root provider and returns filesystem roots before entering the operational phase.

## Reproduction

From the repository root, begin connecting a client configured with `onRootsList`, but send a server `roots/list` request before returning any initialize result:

```sh
cat > /tmp/tiny-mcp-client-responds-to-server-request-before-initialize-probe.mjs <<'EOF'
import { PassThrough } from "node:stream";
import { McpClient } from "/Users/kjopek/Workspace/poe-code/packages/tiny-mcp-client/dist/internal.js";

const readable = new PassThrough();
const writable = new PassThrough();
const transport = { readable, writable, closed: new Promise(() => {}), dispose() {} };
let called = 0;
const client = new McpClient({
  clientInfo: { name: "probe", version: "1.0.0" },
  onRootsList: () => {
    called += 1;
    return [{ uri: "file:///secret-root", name: "secret" }];
  }
});
const iterator = writable[Symbol.asyncIterator]();
const connectPromise = client.connect(transport);
const initialize = JSON.parse(String((await iterator.next()).value));
readable.write(`${JSON.stringify({
  jsonrpc: "2.0",
  id: "request-before-init",
  method: "roots/list"
})}\n`);
const response = JSON.parse(String((await iterator.next()).value));
console.log(`state=${client.state}`);
console.log(`initializeMethod=${initialize.method}`);
console.log(`handlerCalled=${called}`);
console.log(`responseId=${response.id}`);
console.log(`responseResult=${JSON.stringify(response.result)}`);
await client.close();
try { await connectPromise; } catch (error) { console.log(`connectClosed=${error.message}`); }
EOF

node /tmp/tiny-mcp-client-responds-to-server-request-before-initialize-probe.mjs

nl -ba packages/tiny-mcp-client/src/internal.ts | sed -n '160,208p;296,341p;3225,3243p'
```

## Observed Behavior

The roots callback runs and the client returns the sensitive root while its state is still `initializing` and before the server has supplied the initialize response:

```text
state=initializing
initializeMethod=initialize
handlerCalled=1
responseId=request-before-init
responseResult={"roots":[{"uri":"file:///secret-root","name":"secret"}]}
connectClosed=MCP client closed
```

The MCP lifecycle specification for protocol revision `2025-03-26` states that a server should not send requests other than pings and logging before receiving `notifications/initialized`. `packages/tiny-mcp-client/src/internal.ts:187` through `packages/tiny-mcp-client/src/internal.ts:199` register `roots/list` handlers before sending initialize, and `packages/tiny-mcp-client/src/internal.ts:297` through `packages/tiny-mcp-client/src/internal.ts:341` leave the client in `initializing` while the request is pending. Incoming requests are dispatched immediately at `packages/tiny-mcp-client/src/internal.ts:3225` through `packages/tiny-mcp-client/src/internal.ts:3243` without a lifecycle gate.

## Expected Behavior

Before the initialize handshake is complete and the client has sent `notifications/initialized`, server requests other than the protocol-permitted initialization exceptions should be rejected or ignored without invoking application callbacks. In particular, a premature `roots/list` request should not disclose filesystem roots.

## Impact

A non-compliant or malicious MCP server can retrieve client-provided filesystem root metadata during connection setup, before the connection has been accepted for normal operation. This exposes application state during a handshake that may subsequently fail or be closed, and bypasses the lifecycle boundary intended to protect negotiated optional features.
