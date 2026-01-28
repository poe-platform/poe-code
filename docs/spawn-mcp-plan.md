# Spawn MCP Support Plan

## Goal

Enable spawned agents to use MCP (Model Context Protocol) servers for extended capabilities.

## MCP Config Structure

```typescript
interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

type McpConfig = Record<string, McpServerConfig>;
```

Example:
```json
{
  "filesystem": {
    "command": "mcp-server-filesystem",
    "args": ["/path/to/allowed/dir"],
    "env": {}
  },
  "github": {
    "command": "mcp-server-github",
    "args": [],
    "env": { "GITHUB_TOKEN": "..." }
  }
}
```

## Codex MCP Serialization

Codex accepts MCP config via `-c` flags in TOML format:

```typescript
function serializeMcpConfigForCodex(
  mcpConfig: McpConfig
): string[] {
  const args: string[] = [];
  for (const [name, cfg] of Object.entries(mcpConfig)) {
    const prefix = `mcp_servers.${name}`;
    args.push("-c", `${prefix}.command="${cfg.command}"`);
    const tomlArgs = "[" + cfg.args.map(a => `"${a}"`).join(", ") + "]";
    args.push("-c", `${prefix}.args=${tomlArgs}`);
    if (cfg.env && Object.keys(cfg.env).length > 0) {
      const tomlEnv = "{" + Object.entries(cfg.env).map(([k, v]) => `${k}="${v}"`).join(", ") + "}";
      args.push("-c", `${prefix}.env=${tomlEnv}`);
    }
  }
  return args;
}
```

Example output:
```bash
-c 'mcp_servers.filesystem.command="mcp-server-filesystem"'
-c 'mcp_servers.filesystem.args=["/path/to/dir"]'
-c 'mcp_servers.github.command="mcp-server-github"'
-c 'mcp_servers.github.args=[]'
-c 'mcp_servers.github.env={GITHUB_TOKEN="..."}'
```

## MCP Tool Call Events

When an MCP tool is called, Codex emits:

```json
// item.started
{"type":"item.started","item":{"id":"123","type":"mcp_tool_call","server":"github","tool":"get_issue","arguments":{"repo":"foo/bar","number":42}}}

// item.completed
{"type":"item.completed","item":{"id":"123","type":"mcp_tool_call","server":"github","tool":"get_issue","result":"Issue #42: Fix bug..."}}
```

Maps to ACP:
```typescript
// tool_call
{ sessionUpdate: "tool_call", toolCallId: "123", title: "github.get_issue", kind: "mcp", status: "pending", rawInput: { repo: "foo/bar", number: 42 } }

// tool_call_update
{ sessionUpdate: "tool_call_update", toolCallId: "123", status: "completed", rawOutput: "Issue #42: Fix bug..." }
```

## CLI Integration

### Option 1: Config file
```bash
poe-code spawn codex --mcp-config ./mcp.json "use github to check issue 42"
```

### Option 2: Inline JSON
```bash
poe-code spawn codex --mcp-config '{"github":{"command":"mcp-server-github","args":[]}}' "use github"
```

### Option 3: Project config
Store in `poe-code.json` or `.poe-code/mcp.json`:
```json
{
  "mcp": {
    "github": { "command": "mcp-server-github", "args": [] }
  }
}
```

## Implementation Steps

1. Add `McpConfig` type to `src/acp/types.ts`
2. Add `serializeMcpConfigForCodex()` to Codex adapter
3. Add `--mcp-config` flag to spawn command
4. Update Codex adapter to emit `kind: "mcp"` for MCP tool calls
5. (Future) Add project-level MCP config support

## Claude MCP Serialization

Claude accepts MCP config via `--mcp-config` flag as JSON:

```typescript
function serializeMcpConfigForClaude(mcpConfig: McpConfig): string[] {
  const mcpServers: Record<string, any> = {};
  for (const [name, cfg] of Object.entries(mcpConfig)) {
    mcpServers[name] = {
      type: "stdio",
      command: cfg.command,
      args: cfg.args,
      ...(cfg.env && { env: cfg.env })
    };
  }
  return ["--mcp-config", JSON.stringify({ mcpServers })];
}
```

Example output:
```bash
--mcp-config '{"mcpServers":{"github":{"type":"stdio","command":"mcp-server-github","args":[],"env":{"GITHUB_TOKEN":"..."}}}}'
```

## Provider Support Matrix

| Provider | MCP Support |
|----------|-------------|
| Codex | Via `-c mcp_servers.*` flags (TOML format) |
| Claude Code | Via `--mcp-config` flag (JSON format) |
| OpenCode | Native ACP MCP support (TBD) |

## Open Questions

1. How to securely pass MCP server env vars (tokens, secrets)?
2. Should we validate MCP server binaries exist before spawning?
3. Project-level vs user-level MCP config?
