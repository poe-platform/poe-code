# Spawn-Time MCP Server Injection

Pass MCP servers directly at spawn time via `--mcp-servers`, removing the need to pre-configure agent config files.
The CLI accepts inline JSON or `@path/to/file.json` (deprecated alias: `--mcp-config`).

## Supported Agents

| Agent       | Serialization                         |
| ----------- | ------------------------------------- |
| Claude Code | `--mcp-servers` JSON                  |
| Codex       | `-c` TOML overrides                   |
| Cursor      | temporary `.cursor/mcp.json`          |
| OpenCode    | environment-backed MCP config         |
| Kimi        | `--mcp-servers` JSON                  |
| Goose       | repeated `--with-extension` arguments |
| Gemini CLI  | ACP MCP server names                  |

Unsupported agents receive a clear error listing which agents do support it.

## CLI

```bash
poe-code spawn --mcp-servers '{
  "my-server": {
    "command": "my-mcp-server",
    "args": ["--port", "3000"],
    "env": { "API_KEY": "sk-..." }
  }
}' claude-code "Use the tools from my-server"
```

Each entry requires `command` (string). `args` (string array), `env` (string record), and `timeout` (positive number, seconds) are optional.

```bash
# Load the same payload from disk
poe-code spawn --mcp-servers @./mcp.json claude-code "Use the tools from my-server"
```

## SDK

```typescript
import { spawn } from "poe-code";

const { events, result } = spawn("claude-code", "Use the tools", {
  mcpServers: {
    "my-server": {
      command: "my-mcp-server",
      args: ["--port", "3000"],
      env: { API_KEY: "sk-..." },
      timeout: 30
    }
  }
});
```

## Validation

The CLI validates the JSON structure before spawning:

- Top-level value must be an object
- Each entry must be an object with a non-empty `command` string
- `args` must be an array of strings (if present)
- `env` must be an object of string values (if present)
- `timeout` must be a positive number (seconds) (if present)

Invalid input produces a specific error pointing to the malformed entry.

## Adding MCP Support to a New Agent

Add a single `mcpArgs` function to the agent's spawn config:

```typescript
export const myAgentSpawnConfig: CliSpawnConfig = {
  // ...existing config
  mcpArgs: serializeJsonMcpArgs // or a custom serializer
};
```

For CLI spawn configs, the agent automatically appears in `listMcpSupportedAgents()` and passes the `supportsMcpAtSpawn()` check. Provider-owned custom spawn handlers can also advertise support with `supportsMcpSpawn: true`.
