# Tiny MCP stdio native QA

Run the two original native-process controls with the source `StdioTransport`,
`McpClient`, and `readLines` from `packages/tiny-mcp-client/src/internal.ts` after
the maintained dependency build. Use the normal Node stack and original
five-second deadlines. No LLM or external server is involved. The fast transport
suite preserves the complete crash assertion through its existing injected spawn
port and mock-child helper.

1. Start Node with `packages/tiny-stdio-mcp-test-server/dist/cli.js serve
   word-of-the-day`. Through a real `StdioTransport`, write a JSON-RPC initialize
   request with ID one, protocol `2025-03-26`, empty capabilities, and client info
   `tiny-mcp-client-smoke-test` / `0.0.0-test`. Read the first stdout line, racing
   the original five-second timeout and premature transport closure. Require
   `jsonrpc=2.0`, ID one, the same protocol version, server info
   `tiny-stdio-mcp-test-server` / `0.1.0`, and `capabilities.tools.listChanged=true`.
   In all outcomes dispose the transport, await closure, require an Error reason,
   and require a defined signal or exit code.
2. Start Node with an inline readline server over process stdin. On initialize,
   return protocol `2025-03-26`, capabilities `{ tools: {} }`, and server info
   `crashing-server` / `0.0.0-test` with the request's ID. Ignore
   `notifications/initialized`. On `tools/list`, write
   `crash: tools/list before response\n` to stderr and exit exactly one without
   sending a response. Connect an actual `McpClient` with protocol `2025-03-26`
   and client info `tiny-mcp-client` / `0.1.0`, then request tools. Require that
   the pending tools promise rejects with `Stdio transport process exited`.
   Await transport closure; require an Error reason with that exact message,
   code one, undefined signal, captured stderr containing the crash text, and
   client state `closed`.

A timeout is a failed check. Clean up only the owned process/transport and await
closure; never signal unrelated processes or increase deadlines.

Both original native cases and every assertion passed unchanged on 27 September
2026 in 260 ms total. The full maintained unit route separately exposed a
five-second native crash-test timeout; the unit repair controls process startup
without changing production transport behavior.
