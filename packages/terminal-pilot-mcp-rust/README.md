# terminal-pilot-mcp-rust

Let an MCP client operate interactive terminals through an independent Rust
terminal engine. The package bundles its native transport and terminal core in
one addon, with no npm runtime dependencies.

| Tools | Use |
| --- | --- |
| `create_session`, `get_session`, `list_sessions`, `close_session` | Manage named terminals |
| `fill`, `type`, `press_key`, `send_signal` | Send input and process signals |
| `wait_for`, `wait_for_exit` | Wait for matching output or completion |
| `read_screen`, `read_history`, `resize` | Inspect and resize terminals |

Every tool also accepts its existing `terminal_` alias. Names, closed input/output
schemas, server identity and structured results match `terminal-pilot-mcp`.

```typescript
import { createTerminalPilotMcpServer } from 'terminal-pilot-mcp-rust';

await createTerminalPilotMcpServer().listen();
```

The executable `terminal-pilot-mcp-rust` serves JSON-RPC over stdin/stdout.
`--help` prints usage to stderr. Closing input shuts down and reaps owned terminal
processes. `createTerminalPilotMCPGroup()` exposes compatible command descriptors
for an existing Toolcraft consumer; `main()` runs the standalone stdio server.

```typescript
const server = createTerminalPilotMcpServer();
const session = server.createMessageSession();
try {
  await session.handleMessage('initialize', {
    protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'example', version: '1' }
  });
  console.log(await session.handleMessage('tools/call', {
    name: 'create_session',
    arguments: { command: '/bin/sh', session: 'shell', cols: 80, rows: 24 }
  }));
} finally {
  session.close();
  await server.close();
}
```

Rust validates inputs before effects and rejects invalid structured results with
numeric RPC errors. Shutdown blocks further terminal calls; failed cleanup can be
retried. `connect()` accepts Node streams or an SDK transport. Filesystem, streams,
timers and ECMAScript regular expressions use the host runtime.

This private additive rewrite preserves existing production imports. macOS runs
are verified; Linux execution, Windows binaries, Python bindings and general
performance acceptance remain unfinished. Dimensions are limited to 1–1000.
Captured output is retained until session replacement or runtime shutdown and can
grow with output. Keeping a closed server object also retains its tool declarations.
