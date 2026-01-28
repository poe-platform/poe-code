# Generate Spec: Unified Generation Command

## Overview

Single command family for all generation types:

1. **`poe-code generate`** - Unified generation (text, image, video, audio)
2. **`--param`** - Generic key=value parameters for any subcommand
3. **Model overrides** - Use cheap/fast LLMs via environment variables
4. **LLM snapshots** - Record and playback responses for deterministic testing

## Command Structure

```bash
# Text generation (default - type is optional)
poe-code generate "What is 2+2?"
poe-code generate --model Claude-Haiku-4.5 "Hello"
poe-code generate --param thinking_budget=28672 "Explain quantum computing"

# Explicit text subcommand (same as above)
poe-code generate text "What is 2+2?"

# Image generation
poe-code generate image "A sunset over mountains"
poe-code generate image --param aspect_ratio=16:9 --param image_size=4K "A cat"

# Video generation
poe-code generate video "A rocket launching"
poe-code generate video --param resolution=1080p --param seed=12321 "Hyperspeed flythrough"

# Audio generation
poe-code generate audio "Hello world"

# With output path (media only)
poe-code generate image -o sunset.png "A sunset"
```

## Generate Command

Unified generation with type-specific behavior. Text is the default when no subcommand is specified.

```bash
poe-code generate [type] [options] <prompt>
```

### Types

| Type | Default Model | Output |
|------|---------------|--------|
| `text` (default) | `DEFAULT_TEXT_MODEL` | stdout (raw) |
| `image` | `DEFAULT_IMAGE_BOT` | `.png` file |
| `video` | `DEFAULT_VIDEO_BOT` | `.mp4` file |
| `audio` | `DEFAULT_AUDIO_BOT` | `.mp3` file |

### Common Options

| Option | Description |
|--------|-------------|
| `--model <model>` | Override default model |
| `--param <key=value>` | Additional parameters (repeatable) |
| `-o, --output <path>` | Output file path (media only, ignored for text) |

### Output Behavior

```bash
# Text goes to stdout (pipeable) - type optional
$ poe-code generate "What is 2+2?"
4

$ poe-code generate text "What is 2+2?"
4

# Media saves to file
$ poe-code generate image "A sunset"
Saved: ./image-1737984000.png

$ poe-code generate image --param aspect_ratio=16:9 "Ocean waves"
Saved: ./image-1737984001.png

$ poe-code generate image -o my-sunset.png "A sunset"
Saved: ./my-sunset.png
```

### Parameters (`--param`)

Generic key=value pairs passed to the API via `extra_body`. Values are always strings.

```bash
# Text generation with thinking budget and web search
poe-code generate --param thinking_budget=28672 --param web_search=true "Research quantum computing"

# Image generation params
poe-code generate image --param aspect_ratio=4:3 "A sunset"
poe-code generate image --param aspect_ratio=16:9 --param image_size=4K "A cat"

# Negative prompts (values with spaces)
poe-code generate image --param negative_prompt="blurry, low quality" "A portrait"
```

#### Parameter Parsing

```typescript
function parseParams(params: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const param of params) {
    const eqIndex = param.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(`Invalid param format: "${param}". Expected key=value`);
    }
    const key = param.slice(0, eqIndex);
    const value = param.slice(eqIndex + 1);
    result[key] = value;
  }
  return result;
}
```

#### Sent to API

```typescript
// Params go into extra_body (OpenAI SDK pattern)
body: JSON.stringify({
  model,
  messages,
  extra_body: params  // { aspect_ratio: "4:3", image_size: "4K" }
})
```

**Note:** Values are strings. The API is responsible for interpreting types (e.g., "30" as number, "true" as boolean). This keeps the CLI simple and avoids type coercion bugs.

### SDK API

```typescript
import { generate, generateImage, generateVideo, generateAudio } from "poe-code";

// Text generation
const text = await generate("What is 2+2?");
// => { content: "4" }

const opus = await generate("What is AI?", { model: "Claude-Opus-4.5" });
// => { content: "..." }

// Image generation
const image = await generateImage("A sunset");
// => { url: "https://...", mimeType: "image/png" }

// Video generation with params
const video = await generateVideo("Ocean waves", {
  params: { resolution: "4k", fps: "30" }
});
// => { url: "https://...", mimeType: "video/mp4" }

// Audio generation
const audio = await generateAudio("Hello world");
// => { url: "https://...", mimeType: "audio/mp3" }
```

### File Naming

Default filename pattern: `{type}-{timestamp}.{ext}`

```typescript
function generateFilename(type: "image" | "video" | "audio", mimeType: string): string {
  const timestamp = Date.now();
  const ext = mimeTypeToExt(mimeType);
  return `${type}-${timestamp}.${ext}`;
}
```

### Implementation

```typescript
// src/cli/commands/generate.ts
export function registerGenerateCommand(program: Command, container: CliContainer): void {
  const generate = program
    .command("generate")
    .description("Generate content via Poe API")
    .option("--model <model>", "Model identifier")
    .option("--param <key=value...>", "Additional parameters (repeatable)")
    .option("-o, --output <path>", "Output file path (media only)")
    .argument("[prompt]", "Generation prompt (for text without subcommand)")
    .action(async function (promptArg?: string) {
      // Default action: text generation
      if (!promptArg) {
        throw new Error("No prompt provided");
      }
      const opts = this.opts();
      const model = opts.model ?? process.env.POE_TEXT_MODEL ?? DEFAULT_TEXT_MODEL;
      const params = parseParams(opts.param ?? []);
      const response = await textApi({ model, prompt: promptArg, params });
      process.stdout.write(response.content);
      if (!response.content.endsWith("\n")) {
        process.stdout.write("\n");
      }
    });

  // Shared options for media subcommands
  const addMediaOptions = (cmd: Command) => cmd
    .option("--model <model>", "Model identifier")
    .option("--param <key=value...>", "Additional parameters (repeatable)")
    .option("-o, --output <path>", "Output file path")
    .argument("<prompt>", "Generation prompt");

  // generate text (explicit subcommand, same as default)
  generate
    .command("text")
    .description("Generate text (same as default)")
    .option("--model <model>", "Model identifier")
    .option("--param <key=value...>", "Additional parameters (repeatable)")
    .argument("<prompt>", "Generation prompt")
    .action(async function (prompt: string) {
      const opts = this.opts();
      const model = opts.model ?? process.env.POE_TEXT_MODEL ?? DEFAULT_TEXT_MODEL;
      const params = parseParams(opts.param ?? []);
      const response = await textApi({ model, prompt, params });
      process.stdout.write(response.content);
      if (!response.content.endsWith("\n")) {
        process.stdout.write("\n");
      }
    });

  // generate image
  addMediaOptions(generate.command("image").description("Generate an image"))
    .action(async function (prompt: string) {
      const opts = this.opts();
      const model = opts.model ?? DEFAULT_IMAGE_BOT;
      const params = parseParams(opts.param ?? []);
      const response = await mediaApi({ type: "image", model, prompt, params });
      const filename = opts.output ?? generateFilename("image", response.mimeType);
      await downloadToFile(response.url, filename);
      console.log(`Saved: ./${filename}`);
    });

  // generate video
  addMediaOptions(generate.command("video").description("Generate a video"))
    .action(async function (prompt: string) {
      const opts = this.opts();
      const model = opts.model ?? DEFAULT_VIDEO_BOT;
      const params = parseParams(opts.param ?? []);
      const response = await mediaApi({ type: "video", model, prompt, params });
      const filename = opts.output ?? generateFilename("video", response.mimeType);
      await downloadToFile(response.url, filename);
      console.log(`Saved: ./${filename}`);
    });

  // generate audio
  addMediaOptions(generate.command("audio").description("Generate audio"))
    .action(async function (prompt: string) {
      const opts = this.opts();
      const model = opts.model ?? DEFAULT_AUDIO_BOT;
      const params = parseParams(opts.param ?? []);
      const response = await mediaApi({ type: "audio", model, prompt, params });
      const filename = opts.output ?? generateFilename("audio", response.mimeType);
      await downloadToFile(response.url, filename);
      console.log(`Saved: ./${filename}`);
    });
}
```

### New Constants

```typescript
// src/cli/constants.ts
export const DEFAULT_TEXT_MODEL = "Claude-Sonnet-4.5";
export const DEFAULT_IMAGE_BOT = "nano-banana-pro";
export const DEFAULT_AUDIO_BOT = "ElevenLabs";
export const DEFAULT_VIDEO_BOT = "veo-3.1";
```

### Error Handling

#### Missing Media URL

When a user tries to generate media but the response doesn't contain a URL (e.g., used a text model for image generation):

```typescript
// src/cli/commands/generate.ts
const response = await client.generate(type, { model, prompt, params });

if (!response.url) {
  logger.errorResolved(
    `The model "${model}" did not return a ${type}.`,
    `This model may not support ${type} generation. Try using a different model with --model.`
  );
  process.exit(1);
}
```

**Example output:**

```
$ poe-code generate image --model Claude-Haiku-4.5 "A sunset"

✗ The model "Claude-Haiku-4.5" did not return an image.
  This model may not support image generation. Try using a different model with --model.
```

#### Other Edge Cases

| Scenario | Error Message |
|----------|---------------|
| Text model for media | `The model "X" did not return a {type}. Try a different model.` |
| Download failed | `Failed to download {type} from URL. The file may no longer be available.` |
| Invalid output path | `Cannot write to "{path}". Check the path exists and is writable.` |
| Empty prompt | `No prompt provided. Usage: poe-code generate {type} "your prompt"` |

#### Implementation

```typescript
// src/cli/commands/generate.ts
async function handleGenerateAction(
  type: "image" | "video" | "audio",
  prompt: string,
  opts: GenerateOptions,
  logger: Logger
): Promise<void> {
  const client = getGlobalClient();
  const model = opts.model ?? getDefaultModel(type);
  const params = parseParams(opts.param ?? []);

  const response = await client.generate(type, { model, prompt, params });

  // Edge case: model returned text instead of media
  if (!response.url) {
    logger.errorResolved(
      `The model "${model}" did not return ${addArticle(type)}.`,
      `This model may not support ${type} generation. Try using a different model with --model.`
    );
    process.exit(1);
  }

  // Download media
  const filename = opts.output ?? generateFilename(type, response.mimeType ?? getDefaultMimeType(type));

  try {
    await downloadToFile(response.url, filename);
  } catch (error) {
    logger.errorResolved(
      `Failed to download ${type} from URL.`,
      `The file may no longer be available or the URL may have expired.`
    );
    process.exit(1);
  }

  console.log(`Saved: ./${filename}`);
}

function addArticle(type: string): string {
  return type === "image" || type === "audio" ? `an ${type}` : `a ${type}`;
}

function getDefaultMimeType(type: "image" | "video" | "audio"): string {
  switch (type) {
    case "image": return "image/png";
    case "video": return "video/mp4";
    case "audio": return "audio/mp3";
  }
}
```

## Model Overrides

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `POE_TEXT_MODEL` | Override default model for text generation | `DEFAULT_TEXT_MODEL` |
| `POE_IMAGE_MODEL` | Override default model for image generation | `DEFAULT_IMAGE_BOT` |
| `POE_VIDEO_MODEL` | Override default model for video generation | `DEFAULT_VIDEO_BOT` |
| `POE_AUDIO_MODEL` | Override default model for audio generation | `DEFAULT_AUDIO_BOT` |

### Precedence (highest to lowest)

1. CLI flag: `--model <model>`
2. Environment variable: `POE_<TYPE>_MODEL`
3. SDK option: `options.model`
4. Constant: `DEFAULT_<TYPE>_MODEL`

### Usage

```bash
# Use cheap model for development
POE_TEXT_MODEL=Claude-Haiku-4.5 poe-code generate "Hello"

# CLI flag still takes priority
POE_TEXT_MODEL=Claude-Haiku-4.5 poe-code generate --model Claude-Opus-4.5 "Hello"
# ^ Uses Opus because --model flag overrides env var
```

### Implementation

```typescript
// src/cli/commands/generate.ts
const model =
  commandOptions.model ??              // CLI flag
  process.env.POE_TEXT_MODEL ??        // Env var override
  options.model ??                     // SDK option
  DEFAULT_TEXT_MODEL;                  // Constant fallback
```

## LLM Client Abstraction

Production code uses an abstracted client interface. Tests swap the implementation globally.

### Design Principle

**Production code never knows about mocking.** The abstraction exists for clean architecture, not for testing. Tests simply provide a different implementation.

### Client Interface

```typescript
// src/services/llm-client.ts

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

### Production Implementation

```typescript
// src/services/llm-client.ts

export function createPoeClient(apiKey: string, baseUrl: string): LlmClient {
  return {
    async text(request) {
      const body: Record<string, unknown> = {
        model: request.model,
        messages: [{ role: "user", content: request.prompt }]
      };
      if (request.params && Object.keys(request.params).length > 0) {
        body.extra_body = request.params;
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      return { content: data.choices[0].message.content };
    },

    async media(type, request) {
      // Same pattern - params go to extra_body
      // Returns { url, mimeType }
    }
  };
}
```

### Global Client Instance

```typescript
// src/services/client-instance.ts

let globalClient: LlmClient | null = null;

export function setGlobalClient(client: LlmClient): void {
  globalClient = client;
}

export function getGlobalClient(): LlmClient {
  if (!globalClient) {
    throw new Error("LLM client not initialized. Call setGlobalClient() first.");
  }
  return globalClient;
}

// Called once at CLI startup
export async function initializeClient(): Promise<void> {
  const apiKey = await loadCredentials();
  const baseUrl = process.env.POE_API_BASE_URL ?? "https://api.poe.com/v1";
  setGlobalClient(createPoeClient(apiKey, baseUrl));
}
```

### Usage in Production Code

```typescript
// src/cli/commands/generate.ts
import { getGlobalClient } from "../services/client-instance.js";

export function registerGenerateCommand(program: Command): void {
  program
    .command("generate")
    .action(async function (prompt: string) {
      const client = getGlobalClient();  // No knowledge of mocking
      const response = await client.text({ model, prompt });
      process.stdout.write(response.content);
    });
}
```

### Test Setup - Global Mock

```typescript
// tests/setup.ts (runs before all tests)
import { setGlobalClient } from "../src/services/client-instance.js";
import { createSnapshotClient } from "./helpers/snapshot-client.js";

// Replace global client with snapshot-backed mock
const snapshotClient = createSnapshotClient({
  snapshotDir: "__snapshots__",
  mode: process.env.POE_SNAPSHOT_MODE as "record" | "playback" ?? "playback",
  onMiss: process.env.POE_SNAPSHOT_MISS as "error" | "passthrough" ?? "error"
});

setGlobalClient(snapshotClient);
```

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"]  // Runs before all tests
  }
});
```

### Snapshot Client Implementation

```typescript
// tests/helpers/snapshot-client.ts
import type { LlmClient, LlmRequest, LlmResponse } from "../../src/services/llm-client.js";

export function createSnapshotClient(options: SnapshotOptions): LlmClient {
  return {
    async text(request) {
      const key = generateSnapshotKey(request);

      if (options.mode === "playback") {
        const cached = await loadSnapshot(key, options.snapshotDir);
        if (cached) return cached.response;
        return handleMiss(options, request);
      }

      // Record mode: call real API, save response
      const realClient = createPoeClient(process.env.POE_API_KEY!, process.env.POE_API_BASE_URL!);
      const response = await realClient.text(request);
      await saveSnapshot(key, { request, response }, options.snapshotDir);
      return response;
    },

    async media(type, request) {
      // Same pattern for media generation
    }
  };
}
```

### Why This Architecture?

1. **Production code is clean** - No `if (process.env.TEST)` checks
2. **Single point of injection** - `setGlobalClient()` is called once
3. **Tests are automatic** - Any code calling `getGlobalClient()` gets the mock
4. **SDK works too** - SDK functions use same `getGlobalClient()`

## LLM Snapshots

Snapshots record LLM API calls and responses for deterministic test playback.

### Design Principles

- Snapshots are **test-only** - never used in production
- Snapshots are **committed to git** - reproducible CI builds
- Snapshots use **hash-based keys** - zero configuration
- Snapshots use **strict matching** - exact request = exact response

### Environment Variables

| Variable             | Values                      | Description                              |
| -------------------- | --------------------------- | ---------------------------------------- |
| `POE_SNAPSHOT_MODE`  | `record` \| `playback`      | Enable snapshot mode                     |
| `POE_SNAPSHOT_DIR`   | path (default: `__snapshots__`) | Directory for snapshot files         |
| `POE_SNAPSHOT_MISS`  | `error` \| `warn` \| `passthrough` | Behavior on cache miss (default: `error`) |

### Snapshot Key Generation

Keys are SHA-256 hashes of the normalized request, prefixed with the model name for easy identification:

```typescript
interface SnapshotKey {
  model: string;
  messages: Array<{ role: string; content: string }>;
}

function generateSnapshotKey(request: SnapshotKey): string {
  const normalized = JSON.stringify({
    model: request.model,
    messages: request.messages
  });
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  const safeModel = request.model.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `${safeModel}-${hash}`;
}
```

### Snapshot Storage

Filenames are prefixed with the model name for easy filtering:

```
__snapshots__/
  claude-haiku-4.5-a1b2c3d4e5f6.json
  claude-haiku-4.5-i9j0k1l2m3n4.json
  nano-banana-pro-x7y8z9a0b1c2.json
  veo-3.1-d3e4f5g6h7i8.json
```

Each snapshot file:

```json
{
  "key": "claude-haiku-4.5-a1b2c3d4e5f6",
  "request": {
    "model": "Claude-Haiku-4.5",
    "messages": [
      { "role": "user", "content": "What is 2+2?" }
    ]
  },
  "response": {
    "choices": [
      {
        "message": {
          "content": "2 + 2 = 4"
        }
      }
    ]
  },
  "metadata": {
    "recordedAt": "2026-01-28T12:00:00.000Z",
    "model": "Claude-Haiku-4.5"
  }
}
```

### Modes

#### Record Mode

```bash
POE_SNAPSHOT_MODE=record npm test
```

1. Intercept LLM API calls
2. Make real API call
3. Save response to `__snapshots__/{model}-{hash}.json`
4. Return response to caller

#### Playback Mode

```bash
POE_SNAPSHOT_MODE=playback npm test
```

1. Intercept LLM API calls
2. Compute request hash
3. Look up `__snapshots__/{key}.json`
4. If found: return cached response
5. If missing: behavior based on `POE_SNAPSHOT_MISS`:
   - `error`: throw `SnapshotMissingError`
   - `warn`: log warning, make real API call
   - `passthrough`: silently make real API call

### LLM Client Factory

Create an abstraction layer that wraps the LLM client:

```typescript
// src/services/llm-client.ts
export function createLlmClient(options: LlmClientOptions): LlmClient {
  const baseClient = createPoeClient(options.apiKey, options.baseUrl);

  // Check for snapshot mode
  const snapshotMode = process.env.POE_SNAPSHOT_MODE;
  if (!snapshotMode) {
    return baseClient;
  }

  return createSnapshotClient(baseClient, {
    mode: snapshotMode as "record" | "playback",
    snapshotDir: process.env.POE_SNAPSHOT_DIR ?? "__snapshots__",
    onMiss: process.env.POE_SNAPSHOT_MISS as "error" | "warn" | "passthrough" ?? "error"
  });
}
```

### Snapshot Client Wrapper

```typescript
// src/services/snapshot-client.ts
export function createSnapshotClient(
  baseClient: LlmClient,
  options: SnapshotOptions
): LlmClient {
  return {
    async text(request: LlmRequest): Promise<LlmResponse> {
      const key = generateSnapshotKey(request);
      const snapshotPath = join(options.snapshotDir, `${key}.json`);

      if (options.mode === "playback") {
        const snapshot = await loadSnapshot(snapshotPath);
        if (snapshot) {
          return snapshot.response;
        }
        return handleMiss(baseClient, request, options);
      }

      // Record mode
      const response = await baseClient.text(request);
      await saveSnapshot(snapshotPath, { key, request, response });
      return response;
    },

    async media(type, request) {
      // Same pattern for media
    }
  };
}
```

## Developer Tools

### npm Scripts

```json
{
  "scripts": {
    "test-generate": "tsx scripts/test-generate.ts",
    "snapshots": "tsx scripts/snapshots.ts",
    "snapshots:list": "npm run snapshots -- list",
    "snapshots:refresh": "npm run snapshots -- refresh",
    "snapshots:delete": "npm run snapshots -- delete"
  }
}
```

The `test-generate` script loads `tests/test-env.ts` for fast, cheap models.

### Manual Testing

Uses cheap models (Claude-Haiku-4.5, etc.) from `tests/test-env.ts`:

```bash
# Text generation (uses Claude-Haiku-4.5 by default)
npm run test-generate -- "What is 2+2?"
npm run test-generate -- --param thinking_budget=28672 "Explain AI"

# Explicit text subcommand
npm run test-generate -- text "What is 2+2?"

# Image generation (uses nano-banana-pro by default)
npm run test-generate -- image "A sunset over mountains"
npm run test-generate -- image --param aspect_ratio=16:9 --param image_size=4K "A cat"
npm run test-generate -- image -o test.png "A blue circle"

# Video generation (uses veo-3.1 by default)
npm run test-generate -- video "A rocket launching"
npm run test-generate -- video --param resolution=1080p --param seed=12321 "Ocean waves"

# Audio generation (uses ElevenLabs by default)
npm run test-generate -- audio "Hello world"

# Override model for a specific call
npm run test-generate -- --model Claude-Opus-4.5 "Complex question"
```

### Snapshot Management Script

```bash
# List all snapshots
npm run snapshots list

# List snapshots for a specific model
npm run snapshots list --model Claude-Haiku-4.5
npm run snapshots list --model nano-banana-pro

# Refresh all snapshots (re-record from API)
npm run snapshots refresh

# Refresh snapshots for a specific model
npm run snapshots refresh --model Claude-Haiku-4.5

# Refresh specific snapshot by key
npm run snapshots refresh claude-haiku-4.5-a1b2c3d4e5f6

# Delete all snapshots
npm run snapshots delete

# Delete snapshots for a specific model
npm run snapshots delete --model nano-banana-pro

# Delete specific snapshot by key
npm run snapshots delete claude-haiku-4.5-a1b2c3d4e5f6

```

### Script Implementation

```typescript
// scripts/snapshots.ts
import { Command } from "commander";

const program = new Command();

program
  .name("snapshots")
  .description("Manage LLM test snapshots");

program
  .command("list")
  .description("List all snapshots")
  .option("--model <model>", "Filter by model name")
  .action(async (options?: { model?: string }) => {
    // Read __snapshots__/*.json (filter by model prefix if --model provided)
    // Display table: key, model, prompt preview, recorded date
  });

program
  .command("refresh [key]")
  .description("Re-record snapshots from API")
  .option("--model <model>", "Filter by model name")
  .action(async (key?: string, options?: { model?: string }) => {
    // If key: refresh single snapshot
    // If --model: refresh all snapshots for that model (filename prefix match)
    // If neither: refresh all snapshots
  });

program
  .command("delete [key]")
  .description("Delete snapshots")
  .option("--model <model>", "Filter by model name")
  .action(async (key?: string, options?: { model?: string }) => {
    // If key: delete single snapshot
    // If --model: delete all snapshots for that model (filename prefix match)
    // If neither: prompt for confirmation, delete all
  });

program.parse();
```

## Files to Create/Modify

### Production Code

| File | Action |
|------|--------|
| `src/cli/commands/generate.ts` | Unified generate command (text, image, video, audio) |
| `src/cli/constants.ts` | Add `DEFAULT_TEXT_MODEL`, `DEFAULT_IMAGE_BOT`, `DEFAULT_AUDIO_BOT`, `DEFAULT_VIDEO_BOT` |
| `src/services/llm-client.ts` | `LlmClient` interface + `createPoeClient()` implementation |
| `src/services/client-instance.ts` | Global client instance (`setGlobalClient`, `getGlobalClient`) |
| `src/services/media-download.ts` | Download media URLs to files |
| `src/sdk/generate.ts` | SDK `generate()`, `generateImage()`, `generateVideo()`, `generateAudio()` functions |

### Test Infrastructure

| File | Action |
|------|--------|
| `tests/setup.ts` | Global test setup - swaps client with snapshot client |
| `tests/test-env.ts` | Test environment variables (cheap models) |
| `tests/constants.ts` | Test constants (models, prompts) |
| `tests/helpers/snapshot-client.ts` | Snapshot-backed `LlmClient` implementation |
| `tests/helpers/cli-runner.ts` | CLI test runner helper |
| `__snapshots__/.gitkeep` | Snapshot directory |

### Dev Tools

| File | Action |
|------|--------|
| `scripts/snapshots.ts` | Snapshot management CLI |
| `package.json` | Add snapshot npm scripts |
| `vitest.config.ts` | Configure `setupFiles: ["./tests/setup.ts"]` |

### Tests

| File | Action |
|------|--------|
| `tests/integration/generate-cli.test.ts` | CLI integration tests for generate (text, image, video, audio) |
| `tests/llm-client.test.ts` | Unit tests for client abstraction |

## Testing Strategy

### Test Environment Configuration

Tests use a **committed, deterministic environment** with hardcoded values. No reliance on external state.

#### Environment File

```typescript
// tests/test-env.ts (committed to repo)
// DO NOT use real API keys - snapshots provide responses

export const TEST_ENV = {
  // Force cheap/fast models for any live API calls during recording
  POE_TEXT_MODEL: "Claude-Haiku-4.5",
  POE_IMAGE_MODEL: "nano-banana-pro",
  POE_VIDEO_MODEL: "veo-3.1",
  POE_AUDIO_MODEL: "ElevenLabs",

  // Snapshot configuration
  POE_SNAPSHOT_MODE: "playback",
  POE_SNAPSHOT_DIR: "__snapshots__",
  POE_SNAPSHOT_MISS: "error"
} as const;

// Apply to process.env
export function loadTestEnv(): void {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] = value;
  }
}
```

#### Loading in Tests

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { loadTestEnv } from "./tests/test-env.js";

// Load test environment
loadTestEnv();

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"]
  }
});
```

#### Test Constants

```typescript
// tests/constants.ts (committed)
export const TEST_MODELS = {
  text: "Claude-Haiku-4.5",    // Cheap, fast
  image: "nano-banana-pro",
  video: "veo-3.1",
  audio: "ElevenLabs"
} as const;

export const TEST_PROMPTS = {
  simple: "What is 2+2?",
  image: "A red square on white background",
  video: "Ocean waves",
  audio: "Hello world"
} as const;
```

#### Why Committed Environment?

1. **Reproducibility** - Same tests pass locally and in CI
2. **No secrets** - Snapshots replace API calls, no keys needed
3. **Cheap models** - If recording, use fast/cheap models
4. **Deterministic** - Hardcoded prompts = stable snapshot keys

### Unit Tests

1. **Model override precedence** (`tests/generate-command.test.ts`)
   - CLI flag overrides env var
   - Env var overrides SDK option
   - SDK option overrides constant

2. **Snapshot key generation** (`tests/snapshot-client.test.ts`)
   - Same request = same key
   - Different model = different key
   - Different messages = different key

3. **Snapshot record mode** (`tests/snapshot-client.test.ts`)
   - Calls base client
   - Saves response to file
   - Returns response

4. **Snapshot playback mode** (`tests/snapshot-client.test.ts`)
   - Returns cached response when found
   - Throws error on miss (when configured)
   - Falls through on miss (when configured)

5. **Snapshot management** (`tests/snapshot-scripts.test.ts`)
   - List shows all snapshots
   - Refresh updates snapshot files
   - Delete removes snapshot files

### Integration Tests (CLI E2E)

Integration tests call the actual CLI binary and verify output. Snapshots make these deterministic.

#### Test Runner Helper

```typescript
// tests/helpers/cli-runner.ts
import { execa } from "execa";
import { join } from "path";

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runPoeCode(
  args: string[],
  options: {
    env?: Record<string, string>;
    input?: string;
    timeout?: number;
  } = {}
): Promise<CliResult> {
  const binPath = join(__dirname, "../../dist/cli.js");

  const result = await execa("node", [binPath, ...args], {
    env: {
      ...process.env,
      POE_SNAPSHOT_MODE: "playback",
      POE_SNAPSHOT_MISS: "error",
      ...options.env
    },
    input: options.input,
    timeout: options.timeout ?? 10000,
    reject: false
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  };
}
```

#### CLI Integration Test Examples

```typescript
// tests/integration/generate-cli.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { runPoeCode } from "../helpers/cli-runner.js";

describe("poe-code generate CLI", () => {
  beforeAll(() => {
    // Ensure snapshots exist before running
    // In CI: POE_SNAPSHOT_MODE=playback (uses committed snapshots)
    // Locally: POE_SNAPSHOT_MODE=record to create/update snapshots
  });

  describe("text generation (default)", () => {
    it("returns LLM response for simple prompt", async () => {
      const result = await runPoeCode(["generate", "What is 2+2?"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("4");
    });

    it("works with explicit text subcommand", async () => {
      const result = await runPoeCode(["generate", "text", "What is 2+2?"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("4");
    });

    it("respects --model flag", async () => {
      const result = await runPoeCode([
        "generate",
        "--model", "Claude-Haiku-4.5",
        "Say hello"
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
    });

    it("fails gracefully without prompt", async () => {
      const result = await runPoeCode(["generate"], {
        env: { POE_SNAPSHOT_MODE: "" } // Disable snapshots for error case
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("No prompt provided");
    });

    it("respects POE_TEXT_MODEL env var", async () => {
      const result = await runPoeCode(["generate", "Hello"], {
        env: { POE_TEXT_MODEL: "Claude-Haiku-4.5" }
      });

      expect(result.exitCode).toBe(0);
      // The snapshot was recorded with Haiku model
    });
  });
});
```

#### Recording New Snapshots

```bash
# Record snapshots for a specific test file
POE_SNAPSHOT_MODE=record npm test -- tests/integration/generate-cli.test.ts

# Record all integration test snapshots
POE_SNAPSHOT_MODE=record npm run test:integration

# Verify snapshots are committed
git status __snapshots__/
```

#### Snapshot Assertions

For tests that need to verify exact responses (not just "contains"):

```typescript
// tests/integration/generate-deterministic.test.ts
import { describe, it, expect } from "vitest";
import { runPoeCode } from "../helpers/cli-runner.js";
import { readFileSync } from "fs";
import { join } from "path";

describe("deterministic generate responses", () => {
  it("returns exact cached response", async () => {
    const result = await runPoeCode([
      "generate",
      "--model", "Claude-Haiku-4.5",
      "What is 1+1? Reply with just the number."
    ]);

    // Snapshot guarantees exact same response every time
    expect(result.stdout.trim()).toBe("2");
  });
});
```

#### Media Integration Tests

```typescript
// tests/integration/generate-cli.test.ts (continued)
import { existsSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";

describe("poe-code generate image", () => {
  const testDir = process.cwd();

  afterEach(() => {
    // Clean up generated files
    const files = readdirSync(testDir);
    files
      .filter(f => f.startsWith("image-") && f.endsWith(".png"))
      .forEach(f => unlinkSync(join(testDir, f)));
  });

  it("generates image and saves to cwd", async () => {
    const result = await runPoeCode([
      "generate", "image", "A red square on white background"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Saved: \.\/image-\d+\.png/);

    // Verify file exists
    const match = result.stdout.match(/image-\d+\.png/);
    expect(match).not.toBeNull();
    expect(existsSync(join(testDir, match![0]))).toBe(true);
  });

  it("saves to custom path with -o flag", async () => {
    const outputPath = "test-output.png";

    const result = await runPoeCode([
      "generate", "image", "-o", outputPath, "A blue circle"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Saved: ./${outputPath}`);
    expect(existsSync(join(testDir, outputPath))).toBe(true);

    // Cleanup
    unlinkSync(join(testDir, outputPath));
  });

  it("respects --param flags", async () => {
    const result = await runPoeCode([
      "generate", "image",
      "--param", "aspect_ratio=16:9",
      "--param", "image_size=4K",
      "A sunset"
    ]);

    expect(result.exitCode).toBe(0);
    // Snapshot recorded with these params
  });
});

describe("poe-code generate video", () => {
  it("generates video with params", async () => {
    const result = await runPoeCode([
      "generate", "video",
      "--param", "resolution=1080p",
      "--param", "seed=12321",
      "Ocean waves"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Saved: \.\/video-\d+\.mp4/);
  });
});

describe("poe-code generate audio", () => {
  it("generates audio file", async () => {
    const result = await runPoeCode([
      "generate", "audio", "Hello world, this is a test."
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Saved: \.\/audio-\d+\.mp3/);
  });
});

describe("poe-code generate error cases", () => {
  it("shows friendly error when text model used for image", async () => {
    // Snapshot returns text response (no URL) for this model+prompt combo
    const result = await runPoeCode([
      "generate", "image",
      "--model", "Claude-Haiku-4.5",  // Text model, not image model
      "A sunset"
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('did not return an image');
    expect(result.stderr).toContain('Try using a different model');
  });

  it("shows friendly error when text model used for video", async () => {
    const result = await runPoeCode([
      "generate", "video",
      "--model", "Claude-Haiku-4.5",
      "Ocean waves"
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('did not return a video');
  });

  it("shows friendly error when text model used for audio", async () => {
    const result = await runPoeCode([
      "generate", "audio",
      "--model", "Claude-Haiku-4.5",
      "Hello world"
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('did not return an audio');
  });

  it("shows friendly error when prompt is missing", async () => {
    const result = await runPoeCode(["generate", "image"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('prompt');
  });
});
```

### Test Helpers

```typescript
// tests/helpers/snapshot.ts
export function withSnapshotMode(
  mode: "record" | "playback",
  fn: () => Promise<void>
): Promise<void> {
  const original = process.env.POE_SNAPSHOT_MODE;
  process.env.POE_SNAPSHOT_MODE = mode;
  try {
    return await fn();
  } finally {
    if (original) {
      process.env.POE_SNAPSHOT_MODE = original;
    } else {
      delete process.env.POE_SNAPSHOT_MODE;
    }
  }
}
```

## npm Scripts (Complete)

```json
{
  "scripts": {
    "test": "vitest run",
    "test:integration": "vitest run tests/integration/",
    "test:record": "POE_SNAPSHOT_MODE=record npm run test:integration",
    "test-generate": "tsx scripts/test-generate.ts",
    "snapshots": "tsx scripts/snapshots.ts",
    "snapshots:list": "npm run snapshots -- list",
    "snapshots:refresh": "npm run snapshots -- refresh",
    "snapshots:delete": "npm run snapshots -- delete"
  }
}
```

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/test.yml
jobs:
  test:
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
        env:
          POE_SNAPSHOT_MODE: playback
          POE_SNAPSHOT_MISS: error
```
