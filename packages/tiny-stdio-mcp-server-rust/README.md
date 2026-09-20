# tiny-stdio-mcp-server-rust

An independent Rust MCP engine with native Node bindings and JavaScript tool
callbacks. The package includes its native addon and has no external npm runtime
dependencies. It is private and under development.

The current API supports isolated message sessions, legacy initialization,
modern discovery, tool registration and listing, asynchronous tool calls, text
results, and cancellation. The reusable Rust core uses the standard library and
the sibling `mcp-protocol-rust` core.

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

This is an additive implementation checkpoint. Stdio and HTTP transports,
schema enforcement, resources, prompts, subscriptions, and full result
compatibility are still being implemented. Keep existing applications on their
current MCP packages until those features and conformance checks are complete.
