# Poe Agent MCP Plugin Pattern

MCP servers in `@poe-code/poe-agent` are regular runtime plugins.

Use a plain `AgentPlugin` and call `api.addMcp()` in `setup()` with server config.
The runtime handles:

- Creating `StdioTransport`
- Connecting `McpClient`
- Discovering server tools
- Registering namespaced tool names as `<serverName>.<toolName>`
- Closing MCP clients when the run ends

## Example

```ts
import type { AgentPlugin } from "../runtime/plugin-types.js";

interface MyServerOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

const myServer = (options: MyServerOptions): AgentPlugin => ({
  name: "my-server-mcp",
  setup(api) {
    api.addMcp({
      name: "my-server",
      command: options.command,
      args: options.args,
      env: options.env
    });
  }
});

export default myServer;
```

## Config Shape

`McpServerConfig` extends `McpSpawnServer` from `@poe-code/agent-spawn` with:

- `name` (required)
- `visibility` (`"model" | "skill"`, optional)

This keeps MCP plugin config aligned with spawn-time MCP config.

## Testing

For MCP plugin tests, prefer in-memory transport pairs instead of subprocesses.
Use `createInMemoryTransportPair()` from `tiny-mcp-client`.

## Scope

Do not ship service-specific pre-built MCP server plugins in core.
Document this pattern and let callers define their own plugin modules.
