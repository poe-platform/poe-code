# @poe-code/agent-mcp-config

MCP configuration writer for supported local coding agents.

This package maps a normalized MCP server entry to each agent's native config
file, config key, file format, and shape. It is used by configure and
unconfigure flows so caller code can stay declarative.

## Usage

```ts
import { configure, unconfigure, supportedAgents } from "@poe-code/agent-mcp-config";

await configure(
  "codex",
  {
    name: "workspace",
    config: { transport: "stdio", command: "node", args: ["./mcp.js"] }
  },
  { fs, homeDir: "/Users/me", platform: "darwin" }
);

console.log(supportedAgents);
```

## Public API

- `configure(agentId, server, options)`: adds or replaces a matching MCP server entry.
- `unconfigure(agentId, server, options)`: removes an MCP server entry.
- `supportedAgents`: agent ids with config-file MCP support.
- `isSupported(agentId)`: returns whether an agent has MCP config support.
- `resolveAgentSupport(input)`: resolves aliases and returns support metadata.
- `UnsupportedAgentError`: thrown for unsupported known agents.

## Config Options

`ApplyOptions` controls how mutations are applied:

| Option      | Type                             | Description                                               |
| ----------- | -------------------------------- | --------------------------------------------------------- |
| `fs`        | `FileSystem`                     | Filesystem adapter from `@poe-code/config-mutations`.     |
| `homeDir`   | `string`                         | Home directory used to resolve `~` in agent config paths. |
| `platform`  | `"darwin" \| "linux" \| "win32"` | Selects platform-specific config paths.                   |
| `dryRun`    | `boolean`                        | Computes mutations without writing files.                 |
| `observers` | `MutationObservers`              | Receives mutation lifecycle events.                       |

The package's built-in agent config table declares `configFile`, `configKey`,
`format`, `shape`, and optional `mcpOutputFormat` per supported agent.

## Environment Variables

This package does not read or expose environment variables. Server-specific
environment variables may be written into target agent config files when they
are present in an `McpStdioServer` entry.
