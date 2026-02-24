# MCP Server Spec: `poe-code mcp`

## Overview

Add MCP server and configuration commands for integrating Poe with MCP-compatible clients.

The MCP server reuses the same `LlmClient` abstraction and constants defined in [query-extended.md](./query-extended.md).

## Command Usage

### `poe-code mcp`

```bash
poe-code mcp
```

Outputs the MCP server configuration JSON for manual setup:

```json
{
  "poe-code": {
    "command": "npx",
    "args": ["--yes", "poe-code", "mcp", "run"]
  }
}
```

Field annotations:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `poe-code` | object | yes | - | Server ID used by MCP clients; object value is the server config. |
| `command` | string | yes | `npx` | Executable used to launch the MCP server. |
| `args` | string[] | yes | `["--yes", "poe-code", "mcp", "run"]` | CLI args passed to the command. |

### `poe-code mcp run`

```bash
poe-code mcp run
```

Runs an MCP server on stdin/stdout using JSON-RPC 2.0 protocol.

### `poe-code mcp configure`

```bash
poe-code mcp configure           # Prompts for provider selection
poe-code mcp configure <provider> # Configures specific provider
poe-code mcp configure --yes     # Auto-selects default provider (currently claude-code)
```

Configures an MCP client to use the poe-code MCP server.

### `poe-code mcp unconfigure`

```bash
poe-code mcp unconfigure <provider>
```

Removes poe-code MCP server configuration from a provider.
Should be idempotent: if the entry or config file is missing, exit successfully without changes.

### `poe-code mcp --help`

Displays help for MCP commands.

## MCP Tools

All tools use the shared `LlmClient` interface from `src/services/llm-client.ts`.

### 1. `get_bot_response`

Query any bot on Poe. Uses `client.text()`.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `bot_name` | string | yes | Name of the Poe bot to query |
| `message` | string | yes | Message to send to the bot |
| `params` | object | no | Additional parameters (same as `--param` in CLI) |

**Implementation:**

```typescript
async function getBotResponse(args: { bot_name: string; message: string; params?: Record<string, string> }) {
  const client = getGlobalClient();
  const response = await client.text({
    model: args.bot_name,
    prompt: args.message,
    params: args.params
  });
  return { content: response.content };
}
```

### 2. `generate_image`

Generate an image using a Poe image generation bot. Uses `client.media("image", ...)`.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | yes | - | Text prompt for image generation |
| `bot_name` | string | no | `DEFAULT_IMAGE_BOT` | Bot to use |
| `params` | object | no | - | Additional parameters (aspect_ratio, image_size, etc.) |

**Implementation:**

```typescript
async function generateImage(args: { prompt: string; bot_name?: string; params?: Record<string, string> }) {
  const client = getGlobalClient();
  const model = args.bot_name ?? DEFAULT_IMAGE_BOT;  // "nano-banana-pro"
  const response = await client.media("image", {
    model,
    prompt: args.prompt,
    params: args.params
  });
  if (!response.url) {
    throw new Error(`Model "${model}" did not return an image URL`);
  }
  return { url: response.url, mimeType: response.mimeType };
}
```

### 3. `generate_video`

Generate a video using a Poe video generation bot. Uses `client.media("video", ...)`.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | yes | - | Text prompt for video generation |
| `bot_name` | string | no | `DEFAULT_VIDEO_BOT` | Bot to use |
| `params` | object | no | - | Additional parameters (resolution, seed, etc.) |

**Implementation:**

```typescript
async function generateVideo(args: { prompt: string; bot_name?: string; params?: Record<string, string> }) {
  const client = getGlobalClient();
  const model = args.bot_name ?? DEFAULT_VIDEO_BOT;  // "veo-3.1"
  const response = await client.media("video", {
    model,
    prompt: args.prompt,
    params: args.params
  });
  if (!response.url) {
    throw new Error(`Model "${model}" did not return a video URL`);
  }
  return { url: response.url, mimeType: response.mimeType };
}
```

### 4. `generate_audio`

Generate audio using a Poe audio generation bot. Uses `client.media("audio", ...)`.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | yes | - | Text to convert to audio |
| `bot_name` | string | no | `DEFAULT_AUDIO_BOT` | Bot to use |
| `params` | object | no | - | Additional parameters |

**Implementation:**

```typescript
async function generateAudio(args: { prompt: string; bot_name?: string; params?: Record<string, string> }) {
  const client = getGlobalClient();
  const model = args.bot_name ?? DEFAULT_AUDIO_BOT;  // "ElevenLabs-v3"
  const response = await client.media("audio", {
    model,
    prompt: args.prompt,
    params: args.params
  });
  if (!response.url) {
    throw new Error(`Model "${model}" did not return an audio URL`);
  }
  return { url: response.url, mimeType: response.mimeType };
}
```

## Shared Infrastructure

The MCP server reuses these components from the generate command:

### Constants (`src/cli/constants.ts`)

```typescript
export const DEFAULT_TEXT_MODEL = "Claude-Sonnet-4.5";
export const DEFAULT_IMAGE_BOT = "nano-banana-pro";
export const DEFAULT_AUDIO_BOT = "ElevenLabs-v3";
export const DEFAULT_VIDEO_BOT = "veo-3.1";
```

### LLM Client Interface (`src/services/llm-client.ts`)

```typescript
export interface LlmRequest {
  model: string;
  prompt: string;
  params?: Record<string, string>;
}

export interface LlmResponse {
  content?: string;           // For text
  url?: string;               // For media
  mimeType?: string;
}

export interface LlmClient {
  text(request: LlmRequest): Promise<LlmResponse>;
  media(type: "image" | "video" | "audio", request: LlmRequest): Promise<LlmResponse>;
}
```

### Client Instance (`src/services/client-instance.ts`)

```typescript
export function getGlobalClient(): LlmClient;
export function setGlobalClient(client: LlmClient): void;
export async function initializeClient(options: InitializeClientOptions): Promise<void>;
```

## Authentication

1. Check for stored credentials via `loadCredentials()`
2. If no credentials found, write `No credentials found. Run 'poe-code login' first.` to stderr and exit with code 1 (do not start the MCP server).
3. Initialize the global client via `initializeClient()`
4. Start the MCP server

The MCP server does not prompt for login interactively (stdin is used for MCP protocol).

```typescript
// src/cli/commands/mcp.ts
async function runMcpServer(container: CliContainer): Promise<void> {
  // 1. Load credentials
  const apiKey = await loadCredentials(container.fs, container.env.credentialsPath);
  if (!apiKey) {
    process.stderr.write("No credentials found. Run 'poe-code login' first.\\n");
    process.exit(1);
  }

  // 2. Initialize global client (same as generate command)
  await initializeClient({
    fs: container.fs,
    credentialsPath: container.env.credentialsPath,
    baseUrl: container.env.poeApiBaseUrl,
    httpClient: container.httpClient
  });

  // 3. Create and run MCP server
  const server = createMcpServer();
  await server.run();
}
```

## MCP Response Format

Tools return MCP content blocks that map to `LlmResponse`:

| LlmResponse field | MCP Content Type |
|-------------------|------------------|
| `content` | `TextContent` |
| `url` | `ResourceLink` |

```typescript
function toMcpContent(response: LlmResponse): McpContent[] {
  const content: McpContent[] = [];

  if (response.content) {
    content.push({ type: "text", text: response.content });
  }

  if (response.url) {
    content.push({
      type: "resource",
      resource: {
        uri: response.url,
        mimeType: response.mimeType
      }
    });
  }

  return content;
}
```

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
    "args": ["--yes", "poe-code", "mcp", "run"]
  }
}
```

Field annotations:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `poe-code` | object | yes | - | Server ID used by MCP clients; object value is the server config. |
| `command` | string | yes | `npx` | Executable used to launch the MCP server. |
| `args` | string[] | yes | `["--yes", "poe-code", "mcp", "run"]` | CLI args passed to the command. |

The MCP server reads credentials from `~/.poe-code/credentials.json` (stored via `poe-code login`).

## Implementation Details

### Command Structure (`src/cli/commands/mcp.ts`)

```typescript
import { getGlobalClient, initializeClient } from "../../services/client-instance.js";
import {
  DEFAULT_IMAGE_BOT,
  DEFAULT_VIDEO_BOT,
  DEFAULT_AUDIO_BOT
} from "../constants.js";

export function registerMcpCommand(
  program: Command,
  container: CliContainer
): void {
  const mcp = program
    .command("mcp")
    .description("MCP server commands")
    .action(async function () {
      // Output configuration JSON for manual setup
      const config = {
        "poe-code": {
          command: "npx",
          args: ["--yes", "poe-code", "mcp", "run"]
        }
      };
      console.log(JSON.stringify(config, null, 2));
    });

  mcp
    .command("run")
    .description("Run MCP server on stdin/stdout")
    .action(async function () {
      await runMcpServer(container);
    });

  mcp
    .command("configure [provider]")
    .description("Configure MCP client to use poe-code")
    .option("--yes", "Auto-select default provider (currently claude-code)")
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

### MCP Server Setup

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "poe-code",
    version: "1.0.0"
  });

  // Register tools using shared LlmClient
  server.tool(
    "get_bot_response",
    "Query any bot on Poe",
    {
      bot_name: z.string().describe("Name of the Poe bot to query"),
      message: z.string().describe("Message to send to the bot"),
      params: z.record(z.string()).optional().describe("Additional parameters")
    },
    async (args) => {
      const client = getGlobalClient();
      const response = await client.text({
        model: args.bot_name,
        prompt: args.message,
        params: args.params
      });
      return { content: [{ type: "text", text: response.content ?? "" }] };
    }
  );

  server.tool(
    "generate_image",
    "Generate an image using a Poe image generation bot",
    {
      prompt: z.string().describe("Text prompt for image generation"),
      bot_name: z.string().optional().describe(`Bot to use (default: ${DEFAULT_IMAGE_BOT})`),
      params: z.record(z.string()).optional().describe("Additional parameters")
    },
    async (args) => {
      const client = getGlobalClient();
      const model = args.bot_name ?? DEFAULT_IMAGE_BOT;
      const response = await client.media("image", {
        model,
        prompt: args.prompt,
        params: args.params
      });
      return toMcpContent(response);
    }
  );

  // Similar for generate_video and generate_audio...

  return server;
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

## Files to Create/Modify

| File                               | Action                                                |
| ---------------------------------- | ----------------------------------------------------- |
| `src/cli/commands/mcp.ts`          | MCP server and configure/unconfigure subcommands      |
| `src/cli/program.ts`               | Register `registerMcpCommand()`                       |
| `src/providers/claude-code.ts`     | Add `mcp` property                                    |
| `src/providers/codex.ts`           | Add `mcp` property                                    |
| `src/providers/create-provider.ts` | Handle `mcp` property to generate mutations           |
| `tests/mcp-command.test.ts`        | Unit tests                                            |

## Dependencies to Add

```bash
npm install @modelcontextprotocol/sdk zod
```

Note: `zod` is a required peer dependency of the MCP SDK.

## Testing Strategy

Tests use the same patterns as the generate command:

- **Mock LLM client**: Use `setGlobalClient()` from `src/services/client-instance.ts`
- **Mock file system**: Use memfs for credential file access
- **Mock stdin/stdout**: For MCP protocol tests
- **Snapshot testing**: Reuse snapshot infrastructure from `tests/helpers/snapshot-client.ts`

```typescript
// tests/mcp-command.test.ts
import { setGlobalClient } from "../src/services/client-instance.js";
import { createMockLlmClient } from "./helpers/mock-llm-client.js";

describe("MCP tools", () => {
  beforeEach(() => {
    // Use mock client (same pattern as generate tests)
    setGlobalClient(createMockLlmClient({
      text: { content: "Hello from bot" },
      media: { url: "https://example.com/image.png", mimeType: "image/png" }
    }));
  });

  it("get_bot_response uses client.text()", async () => {
    const result = await getBotResponse({
      bot_name: "Claude-Haiku-4.5",
      message: "Hello"
    });
    expect(result.content).toBe("Hello from bot");
  });

  it("generate_image uses client.media()", async () => {
    const result = await generateImage({
      prompt: "A sunset"
    });
    expect(result.url).toBe("https://example.com/image.png");
  });
});
```
