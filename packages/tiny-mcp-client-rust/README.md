# tiny-mcp-client-rust

An independent Rust MCP client with native Node bindings and zero external npm
runtime dependencies. This private additive package is under development.

The first checkpoint implements client JSON-RPC envelope parsing: requests,
notifications, successful/error responses and malformed-message diagnostics.
Rust preserves UTF-16 values and legacy numeric IDs, including fractional IDs.
The client parser accepts arbitrary JSON params; server admission has separate
rules. Native diagnostics use the public `McpError` class and error constants.

`JsonRpcMessageLayer` supports asynchronous legacy requests over caller-owned
streams, out-of-order responses, notifications and server callbacks. Rust owns
request IDs, exchange limits, response matching, incoming capacity and cancellation
state; Node owns timers, stream decoding and callback signals. Canceled incoming
callbacks retain their IDs and capacity until their work settles. Disposal rejects
pending requests and aborts callback signals. Modern calls validate result envelopes,
cache metadata and normative protocol fields in Rust. `input_required` results invoke
registered roots, sampling or elicitation callbacks, validate their responses, then
retry with fresh IDs and snapshotted arguments. Retry rounds and per-round inputs
are bounded, and missing capabilities or handlers reject before callbacks run.

```ts
import { parseJsonRpcMessage } from "tiny-mcp-client-rust";
const reply = parseJsonRpcMessage('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}');
if (reply.type === "response") console.log(reply.message);
```

`McpClient` discovers modern servers or initializes legacy servers, with automatic
fallback, callback-derived client capabilities, owned connection snapshots and
reconnection. It exposes tool, resource, prompt and completion calls over a
caller-provided transport. Progress callbacks follow active tool calls, and aborts
or timeouts send cancellation notifications. TypeScript contracts cover these APIs.

Modern notification streams validate acknowledgement filters, correlate tagged
notifications and expose cancellation and completion. Configured list-change
callbacks automatically open a stream. Resource subscriptions use legacy requests
or modern streams; concurrent callers share setup, and subscriptions can reopen
after completion. Filters and stream counts have explicit bounds.

`createInMemoryTransportPair` connects local stream-based peers without a process.
`StdioTransport` starts an MCP process with configurable arguments, directory and
environment, tracks exit/error metadata, and terminates it on disposal. Stderr
diagnostics retain at most 65,536 UTF-16 units in the Rust core.

`createTestPair` connects a local stream server, while `createSdkTestPair` connects
an SDK-compatible server over own message transports. Official SDK imports are
needed only by applications/tests that choose an official SDK server; this package
does not import it at runtime. Both helpers provide asynchronous cleanup.

HTTP transport support, OAuth and additional SDK edge checks are still in progress.
Keep applications on their current MCP client until conformance and
integration are complete. Existing consumers and release wiring remain unchanged.
