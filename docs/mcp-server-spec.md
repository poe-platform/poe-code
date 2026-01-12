# MCP Server Spec: `poe-code mcp`

## Overview

Add an MCP server command that runs on stdin/stdout for use with `npx poe-code@latest mcp`.

## Command Usage

```bash
npx poe-code mcp
```

Runs an MCP server on stdin/stdout using JSON-RPC 2.0 protocol.

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
2. If no credentials found, prompt user to login (reuse `promptLibrary.loginApiKey()` pattern from `login.ts`)
3. Store credentials after successful prompt
4. Then start the MCP server

This ensures the server doesn't start without valid credentials.

## Files to Create/Modify

| File                       | Action                                                        |
| -------------------------- | ------------------------------------------------------------- |
| `src/cli/constants.ts`     | Add `DEFAULT_IMAGE_BOT`, `DEFAULT_VIDEO_BOT`, `DEFAULT_AUDIO_BOT` |
| `src/cli/commands/mcp.ts`  | New command implementation                                    |
| `src/cli/program.ts`       | Register `registerMcpCommand()`                               |
| `tests/mcp-command.test.ts`| Unit tests                                                    |

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
  program
    .command("mcp")
    .description("Run MCP server on stdin/stdout")
    .action(async function () {
      // 1. Load credentials
      // 2. Create MCP server with tools
      // 3. Run stdio transport
    });
}
```

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
