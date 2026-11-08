# terminal-png-mcp-rust

Give an MCP client a terminal screenshot tool with independent Rust rendering
and no npm runtime dependencies.

| Tool | Result |
| --- | --- |
| `render_terminal_png` | PNG image from ANSI text, with optional padding and window chrome |

```typescript
import { createTerminalPngMcpServer } from 'terminal-png-mcp-rust';

await createTerminalPngMcpServer().listen();
```

```sh
terminal-png-mcp-rust
terminal-png-mcp-rust --help
```

The tool accepts required `ansiText`, optional non-negative integer `padding`,
and optional boolean `window`. It returns standard MCP image content with
`image/png` bytes. Rendering runs on the libuv worker pool so the Node event loop
can continue handling transport and cancellation. The server also exposes the
existing typed registration, message-session and transport API.

One bundled napi-rs addon contains the own MCP engine and portable terminal
rendering core. Rust owns tool definitions/input validation, ANSI/Unicode layout,
embedded JetBrains Mono outlines, rasterization and PNG encoding; Node supplies
stdio and callback transport. Python bindings are not yet provided. Font and
Unicode licenses are included.

This private additive package preserves existing imports. It renders the terminal
SVG dialect; general SVG and complex text shaping remain incomplete in the
underlying `terminal-png-rust` core. Native pixels can differ from the original
renderer. Full cross-platform distribution and aggregate acceptance are unfinished.
