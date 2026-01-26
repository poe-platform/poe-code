# MCP Server Spec: `poe-code mcp`

## Overview

Add MCP server and configuration commands for integrating Poe with MCP-compatible clients.

## Command Usage

### `poe-code mcp`

```bash
poe-code mcp
```

Outputs the MCP server configuration JSON for manual setup.

### `poe-code mcp run`

```bash
poe-code mcp run
```

Runs an MCP server on stdin/stdout using JSON-RPC 2.0 protocol.

### `poe-code mcp configure`

```bash
poe-code mcp configure           # Prompts for provider selection
poe-code mcp configure <provider> # Configures specific provider
poe-code mcp configure --yes     # Auto-selects default provider
```

Configures an MCP client to use the poe-code MCP server.

### `poe-code mcp unconfigure`

```bash
poe-code mcp unconfigure <provider>
```

Removes poe-code MCP server configuration from a provider.

### `poe-code mcp --help`

Displays help for MCP commands.

## MCP Tools

### 1. `get_bot_response`

Query any bot on Poe.

**Parameters:**

- `bot_name` (string, required): Name of the Poe bot to query
- `message` (string, required): Message to send to the bot

### 2. `generate_image`

Generate an image using a Poe image generation bot.

**Parameters:**

- `prompt` (string, required): Text prompt for image generation
- `bot_name` (string, optional): Bot to use (default: `DEFAULT_IMAGE_BOT`)

### 3. `generate_video`

Generate a video using a Poe video generation bot.

**Parameters:**

- `prompt` (string, required): Text prompt for video generation
- `bot_name` (string, optional): Bot to use (default: `DEFAULT_VIDEO_BOT`)

### 4. `generate_audio`

Generate audio using a Poe audio generation bot.

**Parameters:**

- `prompt` (string, required): Text to convert to audio
- `bot_name` (string, optional): Bot to use (default: `DEFAULT_AUDIO_BOT`)

## Authentication

1. Check for stored credentials via `loadCredentials()`
2. If no credentials found, exit with error: `No credentials found. Run 'poe-code login' first.`
3. If credentials found, start the MCP server

The MCP server does not prompt for login interactively (stdin is used for MCP protocol).

## MCP Providers

MCP configuration is added to existing provider files via the `mcp` property.

### Supported Providers

| Provider    | Config File            | Format | Config Key    |
| ----------- | ---------------------- | ------ | ------------- |
| claude-code | `~/.claude.json`       | JSON   | `mcpServers`  |
| codex       | `~/.codex/config.toml` | TOML   | `mcp_servers` |

### Provider Configuration Pattern

Each MCP provider injects the following server configuration:

```json
{
  "poe-code": {
    "command": "npx",
    "args": ["poe-code@latest", "mcp", "run"]
  }
}
```

The MCP server reads credentials from `~/.poe-code/credentials.json` (stored via `poe-code login`).

## Files to Create/Modify

| File                               | Action                                                            |
| ---------------------------------- | ----------------------------------------------------------------- |
| `src/cli/constants.ts`             | Add `DEFAULT_IMAGE_BOT`, `DEFAULT_VIDEO_BOT`, `DEFAULT_AUDIO_BOT` |
| `src/cli/commands/mcp.ts`          | MCP server and configure/unconfigure subcommands                  |
| `src/cli/program.ts`               | Register `registerMcpCommand()`                                   |
| `src/providers/claude-code.ts`     | Add `mcp` property                                                |
| `src/providers/codex.ts`           | Add `mcp` property                                                |
| `src/providers/create-provider.ts` | Handle `mcp` property to generate mutations                       |
| `tests/mcp-command.test.ts`        | Unit tests                                                        |

## Implementation Details

### New Constants (`src/cli/constants.ts`)

```typescript
export const DEFAULT_IMAGE_BOT = "GPT-Image-1";
export const DEFAULT_VIDEO_BOT = "Veo-3";
export const DEFAULT_AUDIO_BOT = "ElevenLabs";
```

### Command Structure (`src/cli/commands/mcp.ts`)

```typescript
export function registerMcpCommand(
  program: Command,
  container: CliContainer
): void {
  const mcp = program
    .command("mcp")
    .description("MCP server commands")
    .action(async function () {
      // Output configuration JSON for manual setup
    });

  mcp
    .command("run")
    .description("Run MCP server on stdin/stdout")
    .action(async function () {
      // 1. Load credentials
      // 2. If no credentials, exit with error: "Run 'poe-code login' first"
      // 3. Create MCP server with tools
      // 4. Run stdio transport
    });

  mcp
    .command("configure [provider]")
    .description("Configure MCP client to use poe-code")
    .option("--yes", "Auto-select default provider")
    .action(async (provider, options) => {
      // 1. If no provider, prompt for selection (unless --yes)
      // 2. Resolve MCP provider
      // 3. Run configure mutations
    });

  mcp
    .command("unconfigure <provider>")
    .description("Remove poe-code from MCP client")
    .action(async (provider) => {
      // 1. Resolve MCP provider
      // 2. Run unconfigure mutations
    });
}
```

### MCP Provider Pattern

Add `mcp` object to existing provider configs. The system generates MCP mutations from this.

| Provider    | Agent Config              | MCP Config             | Same File? |
| ----------- | ------------------------- | ---------------------- | ---------- |
| claude-code | `~/.claude/settings.json` | `~/.claude.json`       | No         |
| codex       | `~/.codex/config.toml`    | `~/.codex/config.toml` | Yes        |

#### When MCP uses same file as agent (e.g., codex)

```typescript
// src/providers/codex.ts
export const codexService = createProvider<...>({
  // ... existing config ...
  mcp: {
    configKey: "mcp_servers"  // Just add the key, file is inferred from manifest
  }
});
```

#### When MCP uses different file (e.g., claude-code)

```typescript
// src/providers/claude-code.ts
export const claudeCodeService = createProvider<...>({
  // ... existing config ...
  mcp: {
    configFile: "~/.claude.json",
    configKey: "mcpServers"
  }
});
```

The system generates `jsonMergeMutation`/`jsonPruneMutation` (or toml variants) for MCP configure/unconfigure based on the `mcp` property.

### MCP Protocol

- Transport: stdin/stdout (JSON-RPC 2.0)
- No HTTP, no ports - pure stdio for `npx` usage
- Uses `@modelcontextprotocol/sdk` package (to be added as dependency)

### Tool Implementation Pattern

Each tool:

1. Receives parameters from MCP request
2. Calls Poe API via OpenAI client (reuse pattern from `query.ts`)
3. Returns text content (and resource links for media URLs)

### Response Format

Tools return MCP content blocks:

- `TextContent` for text responses
- `ResourceLink` for media URLs (images, videos, audio)

## Dependencies to Add

```bash
npm install @modelcontextprotocol/sdk zod
```

Note: `zod` is a required peer dependency of the MCP SDK.

## Testing Strategy

- Mock stdin/stdout for protocol tests
- Mock OpenAI client for API calls
- Use memfs for credential file access
- Test each tool handler independently
- Test configure/unconfigure mutations with memfs
