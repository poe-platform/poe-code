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

Complete client lifecycle, subscriptions and standalone transports are still being
implemented. Keep applications on their current MCP client until conformance and
integration are complete. Existing consumers and release wiring remain unchanged.
