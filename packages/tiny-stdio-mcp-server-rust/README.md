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
stdio connections. It also registers/lists/gets prompts, reads exact and templated
resources, and invokes custom methods. The reusable Rust core uses the standard library and
the sibling `mcp-protocol-rust` and `toolcraft-schema-rust` cores.

Tool input schemas compile at registration and are snapshotted. Calls validate
arguments in Rust before invoking the handler, with structured JSON-RPC schema
issues for invalid input. Set `validateToolArguments: false` to skip rejecting
schema mismatches. Arguments must still be JSON objects. Failed schema compilation
leaves an existing registration intact.

Use `defineSchema({ name: { type: "string" }, limit: { type: "integer", optional: true } })`
to build object schemas with inferred TypeScript argument types. Arbitrary JSON
Schema keywords are preserved; `optional` controls the required-property list.
The shorthand `server.tool(name, description, inputSchema, handler, outputSchema)`
also accepts an output schema. Both registration methods reject duplicate names;
remove a tool before registering a replacement.

Output schemas also compile at registration. Successful calls normalize their
structured content and validate it in Rust; mismatches return JSON-RPC errors with
schema issues. Explicit tool error results skip output validation. Each active
invocation retains its original contract until its callback settles, including
when a tool is replaced or removed. Legacy scalar/array schemas retain the existing
text fallback and omit structured content; modern calls validate those schemas.

Use `parseUriTemplate(source)` for independent RFC 6570 expansion and matching.
All four expansion levels support scalar, list and associative values, Unicode
prefixes and percent encoding. Matching retains the existing readable-resource
capture behavior. Compilation depth, matching work and expanded length are bounded.

Prompt arguments must be strings and include every required argument. Prompt
resource-link content follows each session's negotiated protocol version. Exact
resources take precedence over templates; otherwise the first matching template
handles a URI. Invalid prompt/resource results return JSON-RPC errors. Modern
resource reads preserve and validate cache metadata, with private zero-TTL defaults.

Create a session with `server.createMessageSession(listener)` to receive its
notifications. Call `notifyToolsChanged()`, `notifyPromptsChanged()` or
`notifyResourcesChanged()` after changing a registry. Legacy sessions receive
notifications after `notifications/initialized`; reinitialization pauses delivery
until that handshake completes again. Subscribe to readable resources with
`resources/subscribe`, then send updates through `notifyResourceUpdated(uri)`.
Subscriptions are isolated per session and cleared on close. Global observers use
`onNotification(listener)`, which returns an unsubscribe function. Custom methods
can send request-scoped notifications with `context.notify(method, params)`.
Cancellation and closed sessions suppress new delivery; started delivery retains
its failure. Stdio notifications share the bounded output queue with responses.

Modern `subscriptions/listen` requests require a request ID and a `notifications`
filter. The server acknowledges the supported subset before delivering events,
tags them with `io.modelcontextprotocol/subscriptionId`, and holds the request open
until cancellation or close. Filters select tool/prompt/resource list changes and
specific resource URIs. URI filters are snapshotted, deduplicated, and limited to
1024 absolute URIs of at most 8192 UTF-16 units each. Failed acknowledgments remove
the subscription; canceled pending acknowledgments retain request capacity until
delivery settles. Stdin EOF ends long-lived subscription requests and drains output.

Set `maxActiveRequests` to bound running requests across sessions (default: 128).
Concurrent requests with the same ID in one session are rejected. A
`notifications/cancelled` message aborts that request; callbacks that continue
running retain capacity until they settle.

Content validates canonical base64, strict absolute resource URIs, and annotation
field types. Modern explicit results accept JSON primitives and arrays in
`structuredContent`; legacy results require an object. Ordinary callback failures
return tool error content. Throw `ToolError(code, message, data)` to return an
explicit JSON-RPC error, preserving its code and optional data.
Numeric text and JSON fallbacks use JavaScript's shortest number spelling,
including exponent boundaries, subnormals, midpoint ties and negative zero.

Create media with `Image.fromBytes(bytes, "png")`,
`Audio.fromBase64(base64, "audio/wav")`, or `File.fromText("Hello")`.
Return helpers directly or inside nested tool-result arrays, or call
`toContentBlock()` for a plain MCP content object. Rust detects common media
signatures, validates MIME aliases, encodes/decodes base64 and constructs content.
File byte helpers decode text MIME types with UTF-8 replacement/BOM handling;
binary MIME types produce blob resources. File byte inputs remain live until
conversion, while image/audio helpers snapshot their input when created.
Use `fileTypeFromBuffer(bytes)` to inspect a media signature without creating content.
Use `await Image.fromUrl(url)`, `Audio.fromUrl(url)` or `File.fromUrl(url)` for remote
content. Loading uses Node's built-in fetch and a Rust byte accumulator, with a
5 MiB default budget; pass `{ maxBytes }` to change it. Oversized streams are
canceled, readers are released, and error labels omit credentials, queries and
fragments. Recognized media signatures take precedence over response headers.
Remote text files use the response charset through the platform decoder; unsupported
charsets produce binary resources.

Modern requests validate client capabilities and retry responses against embedded
normative MCP schemas using the independent Rust schema engine. Malformed retry
fields are rejected before handlers run. `validateProtocolValue(definition, value)`
also checks input requests/responses and server result shapes directly, including
metadata keys, URI/base64 fields and file roots. Non-JSON values, serialization
hooks and accessors return `false` without calling hooks/getters. Validators cache
only the schema definitions reachable from each entry point. The normative schema
data carries its upstream notice in `MCP-LICENSE.txt`; no SDK implementation is shipped.

Tool, prompt and resource handlers can return modern `input_required` results with
opaque `requestState` and requests for roots, sampling or elicitation. Rust checks
the requests against the capabilities supplied when that invocation was admitted;
missing support returns the complete required capability set. Retry parameters
reach the handler through `context.requestState` and `context.inputResponses`.
Input requirements skip complete output schemas and resource cache defaults.
Cycles and non-JSON requirements return RPC errors without running getters or hooks.

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

Use `await server.connectSDK(transport)` with a transport exposing `start`, `send`,
`close`, `onmessage` and `onclose`. The adapter accepts the official SDK's transports
without importing its implementation or types. Rust admits decoded requests
directly, preserving UTF-16 IDs and values without a JSON serialization round trip.
Transport responses are ignored, initialization remains isolated per connection,
and closing or failing startup disposes the session. Notification send failures
propagate to their caller. A canceled callback retains global request capacity
until its underlying operation settles.

This is an additive implementation checkpoint. HTTP transports, complete content API parity,
and full result compatibility are still being implemented. Keep existing applications on their
current MCP packages until those features and conformance checks are complete.
