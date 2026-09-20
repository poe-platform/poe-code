# tiny-stdio-mcp-server-rust

An independent Rust MCP engine with native Node bindings and JavaScript tool
callbacks. The package includes its native addon and has no external npm runtime
dependencies. It is private and under development.

Values cross the native boundary directly. Conversion preserves UTF-16 strings
and own property names, accepts shared references, and rejects cycles, accessors,
and serialization hooks. Tool result arrays omit explicit `undefined` entries;
sparse arrays are rejected. Native copying has depth, node, and string-byte
budgets, and metadata and tool arguments retain the repository's JSON limits.

The current API supports isolated message sessions, legacy initialization,
modern discovery, tool registration and listing, asynchronous tool calls, text,
image, audio, resource-link and embedded-resource results, cancellation, and
stdio connections. The reusable Rust core uses the standard library and
the sibling `mcp-protocol-rust` and `toolcraft-schema-rust` cores.

Tool input schemas compile at registration and are snapshotted. Calls validate
arguments in Rust before invoking the handler, with structured JSON-RPC schema
issues for invalid input. Set `validateToolArguments: false` to skip rejecting
schema mismatches. Arguments must still be JSON objects. Failed schema compilation
leaves an existing registration intact.

Set `maxActiveRequests` to bound running requests across sessions (default: 128).
Concurrent requests with the same ID in one session are rejected. A
`notifications/cancelled` message aborts that request; callbacks that continue
running retain capacity until they settle.

Content validates canonical base64, strict absolute resource URIs, and annotation
field types. Modern explicit results accept JSON primitives and arrays in
`structuredContent`; legacy results require an object. Ordinary callback failures
return tool error content. Throw `ToolError(code, message, data)` to return an
explicit JSON-RPC error, preserving its code and optional data.

```ts
import { createServer } from "tiny-stdio-mcp-server-rust";

const server = createServer({ name: "echo", version: "1.0" });
server.tool("echo", "Echo a message", { type: "object" }, async (args) => args.message);

const session = server.createMessageSession();
await session.handleMessage("initialize", { protocolVersion: "2025-11-25" });
const response = await session.handleMessage("tools/call", {
  name: "echo",
  arguments: { message: "Hello" }
});
session.close();
```

Use `await server.listen()` for stdin/stdout, or
`await server.connect({ readable, writable })` with your own Node streams. Rust
frames and parses incoming messages and owns the output queue's byte budget,
write completion, and backpressure state. The default line and queued-output
budgets are 1 MiB each, with at most 128 pending messages. Set
`maxStdioLineBytes`, `maxStdioOutputBytes`, and `maxPendingStdioMessages` to change
them. Caller-owned streams remain open when a connection completes.

This is an additive implementation checkpoint. HTTP transports,
output-schema enforcement, resources, prompts, subscriptions, and full result
compatibility are still being implemented. Keep existing applications on their
current MCP packages until those features and conformance checks are complete.
