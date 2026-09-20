# agent-mcp-config-rust

Configure MCP servers for Claude Code, Claude Desktop, Codex, Cursor, OpenCode
and Goose through a compatible TypeScript API backed by Rust.

| API | Use |
| --- | --- |
| `resolveAgentSupport` | Resolve aliases and distinguish unsupported agents from unknown names |
| `configure` | Add a server, preserve unrelated settings, and reject conflicting configurations |
| `unconfigure` | Remove a server by name or only when its configuration matches |

```ts
import {configure, unconfigure, type ApplyOptions, type McpServerEntry} from '@poe-code/agent-mcp-config-rust';
import fs from 'node:fs/promises';
import os from 'node:os';

const options: ApplyOptions = {
  fs, homeDir: os.homedir(), platform: process.platform as ApplyOptions['platform']
};
const server: McpServerEntry = {
  name: 'tools',
  config: {transport: 'stdio', command: 'node', args: ['tools.js']}
};

await configure('claude', server, options);
await unconfigure('claude', 'tools', options);
```

Use `dryRun: true` to preview through mutation observers. HTTP servers accept an
`http` or `https` URL and optional headers. Agent-specific JSONC, TOML and YAML
paths, shapes and disabled-server behavior are selected automatically.

This is a private, additive implementation: existing integrations still use
their original packages. It ships one native addon and no npm runtime
dependencies. The Rust core uses the standard library and own path crates;
napi-rs powers the Node binding. Node built-ins handle filesystem operations,
URL parsing and JavaScript object behavior. Foreign server values retain their
references, getter order and thrown errors.

The core is suitable for a future Python adapter; Python bindings are not
included. Shape policy is compiled from the Rust machine into a finite graph
that the host interprets, preserving JavaScript behavior without per-field
native calls. Validation and conflict policies use reusable native wrappers;
their operation state is discarded after each call. Performance and memory use
depend on the workload and do not promise an advantage over TypeScript.
The embedded configuration codecs retain the documented compatibility limits
of `config-mutations-rust`, including incomplete YAML diagnostic conformance.
