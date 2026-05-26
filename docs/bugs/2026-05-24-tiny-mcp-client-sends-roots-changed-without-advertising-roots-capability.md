# Tiny MCP client sends roots/list_changed without advertising the roots capability

## Summary

The exported `tiny-mcp-client` exposes `sendRootsChanged()` on every connected client and sends `notifications/roots/list_changed` without checking whether the client advertised support for roots or root-list-change notifications during initialization. A client initialized with an empty capability set can therefore emit a roots protocol message that contradicts its negotiated capabilities.

## Reproduction

From the repository root, connect a client without `onRootsList` or any explicit roots capability, then call `sendRootsChanged()`:

```sh
cat > /tmp/tiny-mcp-client-roots-changed-without-capability-probe.mjs <<'EOF'
import { PassThrough } from "node:stream";
import { McpClient } from "/Users/kjopek/Workspace/poe-code/packages/tiny-mcp-client/dist/internal.js";

const readable = new PassThrough();
const writable = new PassThrough();
const transport = { readable, writable, closed: new Promise(() => {}), dispose() {} };
const client = new McpClient({ clientInfo: { name: "probe", version: "1.0.0" } });
const iterator = writable[Symbol.asyncIterator]();
const connectPromise = client.connect(transport);
const initialize = JSON.parse(String((await iterator.next()).value));
console.log(`advertisedCapabilities=${JSON.stringify(initialize.params.capabilities)}`);
readable.write(`${JSON.stringify({ jsonrpc: "2.0", id: initialize.id, result: {
  protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "server", version: "1.0.0" }
}})}\n`);
await connectPromise;
const initialized = JSON.parse(String((await iterator.next()).value));
await client.sendRootsChanged();
const rootsChanged = JSON.parse(String((await iterator.next()).value));
console.log(`initializedMethod=${initialized.method}`);
console.log(`state=${client.state}`);
console.log(`rootsChangedMethod=${rootsChanged.method}`);
await client.close();
EOF

node /tmp/tiny-mcp-client-roots-changed-without-capability-probe.mjs

nl -ba packages/tiny-mcp-client/src/internal.ts | sed -n '323,354p;543,561p'
```

## Observed Behavior

The client advertises no roots capability during initialization, becomes ready, and then transmits a roots list-change notification anyway:

```text
advertisedCapabilities={}
initializedMethod=notifications/initialized
state=ready
rootsChangedMethod=notifications/roots/list_changed
```

For protocol revision `2025-03-26`, the MCP roots specification states that clients supporting roots must declare the `roots` capability during initialization and that `listChanged` indicates whether the client will emit root-list-change notifications. `packages/tiny-mcp-client/src/internal.ts:323` through `packages/tiny-mcp-client/src/internal.ts:341` advertise roots only when configured through the client's roots options, but `packages/tiny-mcp-client/src/internal.ts:554` through `packages/tiny-mcp-client/src/internal.ts:557` send `notifications/roots/list_changed` unconditionally for any non-closed client.

## Expected Behavior

`sendRootsChanged()` should reject unless the active connection declared `capabilities.roots.listChanged: true`, or the API should only exist through a roots configuration surface that guarantees the capability was negotiated. A client must not emit optional feature notifications that it did not advertise.

## Impact

Consumers can accidentally send protocol-invalid notifications to servers, causing servers to refresh roots that were never declared, reject otherwise healthy sessions, or infer unsupported client behavior. This makes wire conformance depend on callers knowing an undocumented precondition that the SDK does not enforce.
