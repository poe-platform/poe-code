# Spawn MCP Support

## Problem

When spawning agents via `poe-code spawn`, there is no way to pass MCP server configurations at spawn time. Users who have MCP servers (e.g. filesystem, database, custom tools) need them available during agent execution but currently must pre-configure them in each agent's global config file.

The Python scripts that preceded poe-code solved this with per-agent serialization functions (`serialize_mcp_config_codex`, `serialize_mcp_config_claude`) that translated a common MCP config into agent-specific CLI args. This plan brings the same capability into the spawn system.

## Goals

1. Accept MCP server config at spawn time (CLI flag + SDK option)
2. Translate the config into each agent's native CLI format automatically
3. Keep provider configs declarative — no per-agent imperative code
4. Declare MCP support on the spawn config so it can be queried
5. Show a clear, actionable error when an agent doesn't support MCP at spawn time

## Non-Goals

- Persisting MCP config to disk (that's `poe-code mcp configure`)
- MCP server discovery or validation
- HTTP/SSE transport support at spawn time (stdio only for v1)

## Agent CLI MCP Flags

Each agent accepts MCP servers via different CLI mechanisms:

| Agent | CLI mechanism | Example |
|-------|-------------|---------|
| claude-code | `--mcp-config '<json>'` | `--mcp-config '{"mcpServers":{"fs":{"command":"npx","args":["-y","@anthropic/mcp-fs"]}}}'` |
| codex | `-c mcp_servers.<name>.<key>=<toml_value>` (repeated) | `-c mcp_servers.fs.command="npx" -c mcp_servers.fs.args=["@anthropic/mcp-fs"]` |
| opencode | Not yet supported via CLI args | N/A — needs upstream support or workaround via config file |
| kimi | `--mcp-config '<json>'` (same shape as claude-code) | `--mcp-config '{"mcpServers":{"fs":{"command":"npx","args":["-y","@anthropic/mcp-fs"]}}}'` |

## Design

### 1. Common MCP Config Type

Reuse the existing `McpServerEntry` type from `@poe-code/agent-mcp-config`:

```typescript
// Already exists in packages/agent-mcp-config/src/types.ts
interface McpStdioServer {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpServerEntry {
  name: string;
  config: McpServerConfig;
  enabled?: boolean;
}
```

The spawn-time input is a record of server name to stdio config:

```typescript
type McpSpawnConfig = Record<string, {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}>;
```

### 2. Declare MCP Support on `CliSpawnConfig`

Extend the spawn config type with a declared MCP serializer. This follows the existing pattern where capabilities are explicit on the config (like `interactive`, `stdinMode`, `resumeCommand`). **Presence of `mcpArgs` declares support** — it can be queried before attempting a spawn:

```typescript
// In packages/agent-spawn/src/types.ts
interface CliSpawnConfig {
  // ... existing fields ...

  /** Transforms MCP server config into CLI args for this agent. Presence declares support. */
  mcpArgs?: (servers: McpSpawnConfig) => string[];
}
```

Expose a query function so callers can check support before spawning:

```typescript
// In packages/agent-spawn (exported)
export function supportsMcpAtSpawn(agentId: string): boolean {
  const config = getSpawnConfig(agentId);
  return !!config && config.kind === "cli" && typeof config.mcpArgs === "function";
}
```

Each agent config **declares** MCP support by providing `mcpArgs`:

**claude-code** (`--mcp-config` JSON):
```typescript
mcpArgs: (servers) => {
  const mcpServers: Record<string, StandardShapeOutput> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    mcpServers[name] = { command: cfg.command, ...(cfg.args?.length && { args: cfg.args }), ...(cfg.env && { env: cfg.env }) };
  }
  return ["--mcp-config", JSON.stringify({ mcpServers })];
}
```

**codex** (`-c` TOML flags):
```typescript
mcpArgs: (servers) => {
  const args: string[] = [];
  for (const [name, cfg] of Object.entries(servers)) {
    const prefix = `mcp_servers.${name}`;
    args.push("-c", `${prefix}.command="${cfg.command}"`);
    if (cfg.args?.length) {
      const tomlArgs = "[" + cfg.args.map(a => `"${a}"`).join(", ") + "]";
      args.push("-c", `${prefix}.args=${tomlArgs}`);
    }
    if (cfg.env) {
      const tomlEnv = "{" + Object.entries(cfg.env).map(([k, v]) => `${k}="${v}"`).join(", ") + "}";
      args.push("-c", `${prefix}.env=${tomlEnv}`);
    }
  }
  return args;
}
```

**kimi** (`--mcp-config` JSON, same as claude-code):
```typescript
mcpArgs: (servers) => {
  const mcpServers: Record<string, StandardShapeOutput> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    mcpServers[name] = { command: cfg.command, ...(cfg.args?.length && { args: cfg.args }), ...(cfg.env && { env: cfg.env }) };
  }
  return ["--mcp-config", JSON.stringify({ mcpServers })];
}
```

**opencode**: `mcpArgs` omitted — agent does not declare MCP support.

### 3. Wire MCP Args into `buildCliArgs` with Error Handling

In `packages/agent-spawn/src/spawn.ts`, inject MCP args between `defaultArgs` and mode args. When MCP servers are requested but the agent doesn't declare support, throw a `ValidationError` with an actionable message listing which agents do support it:

```typescript
function buildCliArgs(config, options, stdinMode) {
  const args = [...promptArgs];

  if (options.model && config.modelFlag) { /* existing */ }

  args.push(...config.defaultArgs);

  // Inject MCP args before mode args
  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    if (!config.mcpArgs) {
      const supported = allSpawnConfigs
        .filter((c) => c.kind === "cli" && typeof c.mcpArgs === "function")
        .map((c) => c.agentId);
      throw new Error(
        `Agent "${config.agentId}" does not support MCP servers at spawn time.\n` +
        `Agents with spawn-time MCP support: ${supported.join(", ")}`
      );
    }
    args.push(...config.mcpArgs(options.mcpServers));
  }

  args.push(...config.modes[options.mode ?? "yolo"]);
  args.push(...(options.args ?? []));

  return args;
}
```

At the CLI layer (`src/cli/commands/spawn.ts`), this error is caught and rendered using the design system. The spawn command already surfaces errors through the standard error handler, so the message above flows through naturally. But we also add an **early check** before spawning to provide a better UX:

```typescript
// In spawn command action, after parsing --mcp-config
if (mcpServers && Object.keys(mcpServers).length > 0) {
  if (!supportsMcpAtSpawn(canonicalService)) {
    const supported = listMcpSupportedAgents(); // from agent-spawn
    throw new ValidationError(
      `${adapter.label} does not support MCP servers at spawn time.\n` +
      `Agents with spawn-time MCP support: ${supported.join(", ")}`
    );
  }
}
```

This gives the user:
```
✗ OpenCode does not support MCP servers at spawn time.
  Agents with spawn-time MCP support: claude-code, codex, kimi
```

### 4. Add `--mcp-config` to CLI

In `src/cli/commands/spawn.ts`, add a new option:

```
.option("--mcp-config <json>", "MCP server config JSON: {name: {command, args?, env?}}")
```

Parse it into `McpSpawnConfig` and thread it through to `SpawnOptions`.

### 5. Add `mcpServers` to SDK `SpawnOptions`

In both `packages/agent-spawn/src/types.ts` and `src/sdk/types.ts`:

```typescript
interface SpawnOptions {
  // ... existing fields ...
  mcpServers?: McpSpawnConfig;
}
```

SDK usage:

```typescript
import { spawn } from "poe-code";

const { events, result } = spawn("codex", "Fix the bug", {
  mcpServers: {
    filesystem: {
      command: "npx",
      args: ["-y", "@anthropic/mcp-fs", "/tmp"]
    }
  }
});
```

## Implementation Order

1. Define `McpSpawnConfig` type in `agent-spawn/src/types.ts`
2. Add `mcpArgs` to `CliSpawnConfig`
3. Add `supportsMcpAtSpawn()` and `listMcpSupportedAgents()` query functions
4. Update `buildCliArgs` to inject MCP args with error message
5. Add `mcpArgs` to claude-code, codex, kimi configs
6. Add `mcpServers` to `BuildSpawnArgsOptions` and `SpawnOptions`
7. Thread `mcpServers` through SDK spawn (`src/sdk/spawn.ts`)
8. Add `--mcp-config` CLI option to spawn command with early validation
9. Tests for each agent's `mcpArgs` serialization
10. Test for unsupported agent error message
11. E2E test with `tiny-stdio-mcp-test-server`
12. Update `docs/agent-capabilities.md` — add "Spawn MCP" column

## Open Questions

- Should `opencode` support MCP at spawn time via temp config file write? Or wait for upstream CLI flag support?
- Should `--mcp-config` also accept a file path (e.g. `--mcp-config ./mcp.json`) in addition to inline JSON?
