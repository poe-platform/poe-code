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
| `text` (default) | `Claude-Sonnet-4.5` | stdout (raw) |
| `image` | `nano-banana-pro` | `.png` file |
| `video` | `veo-3.1` | `.mp4` file |
| `audio` | `ElevenLabs-v3` | `.mp3` file |

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
// src/cli/commands/generate.ts
export function parseParams(params: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const param of params) {
    const eqIndex = param.indexOf("=");
    if (eqIndex === -1) {
      throw new ValidationError(
        `Invalid param format: "${param}". Expected key=value`
      );
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
  messages: [{ role: "user", content: prompt }],
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

### Constants

```typescript
// src/cli/constants.ts
export const DEFAULT_TEXT_MODEL = "Claude-Sonnet-4.5";
export const DEFAULT_IMAGE_BOT = "nano-banana-pro";
export const DEFAULT_AUDIO_BOT = "ElevenLabs-v3";
export const DEFAULT_VIDEO_BOT = "veo-3.1";
```

### Error Handling

#### Missing Media URL

When a user tries to generate media but the response doesn't contain a URL (e.g., used a text model for image generation):

```typescript
if (!response.url) {
  throw new ValidationError(
    buildMissingMediaMessage(type, model, response.content)
  );
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

## Model Overrides

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `POE_TEXT_MODEL` | Override default model for text generation | `Claude-Sonnet-4.5` |
| `POE_IMAGE_MODEL` | Override default model for image generation | `nano-banana-pro` |
| `POE_VIDEO_MODEL` | Override default model for video generation | `veo-3.1` |
| `POE_AUDIO_MODEL` | Override default model for audio generation | `ElevenLabs-v3` |

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

export function createPoeClient(options: PoeClientOptions): LlmClient {
  const httpClient = options.httpClient ?? createDefaultHttpClient();

  return {
    async text(request): Promise<LlmResponse> {
      const data = await requestCompletion(httpClient, options.baseUrl, options.apiKey, request);
      return { content: extractTextContent(data) };
    },

    async media(_type, request): Promise<LlmResponse> {
      const data = await requestCompletion(httpClient, options.baseUrl, options.apiKey, request);
      return extractMediaFromCompletion(data);
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
    throw new Error("LLM client not initialized. Call initializeClient() first.");
  }
  return globalClient;
}

export function hasGlobalClient(): boolean {
  return globalClient !== null;
}

export async function initializeClient(options: InitializeClientOptions): Promise<void> {
  const apiKey = await loadCredentials(options.fs, options.credentialsPath);
  if (!apiKey) {
    throw new AuthenticationError("No API key found");
  }
  const client = createPoeClient({
    apiKey,
    baseUrl: options.baseUrl,
    httpClient: options.httpClient
  });
  setGlobalClient(client);
}
```

### Usage in Production Code

```typescript
// src/cli/commands/generate.ts
import { getGlobalClient, initializeClient } from "../../services/client-instance.js";

async function resolveClient(container: CliContainer): Promise<LlmClient> {
  try {
    return getGlobalClient();
  } catch {
    await initializeClient({
      fs: container.fs,
      credentialsPath: container.env.credentialsPath,
      baseUrl: container.env.poeApiBaseUrl,
      httpClient: container.httpClient
    });
    return getGlobalClient();
  }
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
// tests/helpers/snapshot-client.ts

export function generateSnapshotKey(request: {
  model: string;
  messages: Array<{ role: string; content: string }>;
}): string {
  const normalized = JSON.stringify({
    model: request.model,
    messages: request.messages
  });
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  const safeModel = sanitizeModelName(request.model);
  return `${safeModel}-${hash}`;
}
```

### Snapshot Storage

Filenames are prefixed with the model name for easy filtering:

```
__snapshots__/
  claude-haiku-4-5-a1b2c3d4e5f6.json
  claude-haiku-4-5-i9j0k1l2m3n4.json
  nano-banana-pro-x7y8z9a0b1c2.json
  veo-3-1-d3e4f5g6h7i8.json
  .accessed-keys.json
```

Each snapshot file:

```json
{
  "key": "claude-haiku-4-5-a1b2c3d4e5f6",
  "request": {
    "model": "Claude-Haiku-4.5",
    "messages": [
      { "role": "user", "content": "What is 2+2?" }
    ],
    "type": "text"
  },
  "response": {
    "content": "2 + 2 = 4"
  },
  "metadata": {
    "recordedAt": "2026-01-28T12:00:00.000Z",
    "model": "Claude-Haiku-4.5",
    "type": "text"
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

### Snapshot Client Implementation

```typescript
// tests/helpers/snapshot-client.ts

export interface SnapshotClient extends LlmClient {
  /** Returns all snapshot keys accessed during this session */
  getAccessedKeys(): Set<string>;
  /** Persists accessed keys to disk, merging with existing keys */
  persistAccessedKeys(): Promise<void>;
}

export function createSnapshotClient(
  baseClient: LlmClient,
  options: SnapshotOptions
): SnapshotClient {
  const accessedKeys = new Set<string>();

  return {
    async text(request) {
      return handleSnapshotRequest(baseClient, "text", request, options, accessedKeys);
    },
    async media(type, request) {
      return handleSnapshotRequest(baseClient, type, request, options, accessedKeys);
    },
    getAccessedKeys() {
      return accessedKeys;
    },
    async persistAccessedKeys() {
      // Merge with existing .accessed-keys.json
    }
  };
}
```

## Developer Tools

### npm Scripts

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
    "snapshots:delete": "npm run snapshots -- delete",
    "snapshots:delete-stale": "npm run snapshots -- delete --stale"
  }
}
```

### Manual Testing

Uses cheap models (Claude-Haiku-4.5, etc.) from test environment:

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

# Audio generation (uses ElevenLabs-v3 by default)
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
npm run snapshots refresh claude-haiku-4-5-a1b2c3d4e5f6

# Delete all snapshots
npm run snapshots delete

# Delete snapshots for a specific model
npm run snapshots delete --model nano-banana-pro

# Delete specific snapshot by key
npm run snapshots delete claude-haiku-4-5-a1b2c3d4e5f6

# Delete stale (unused) snapshots
npm run snapshots delete --stale
```

## Files

### Production Code

| File | Description |
|------|-------------|
| `src/cli/commands/generate.ts` | Unified generate command (text, image, video, audio) |
| `src/cli/constants.ts` | `DEFAULT_TEXT_MODEL`, `DEFAULT_IMAGE_BOT`, `DEFAULT_AUDIO_BOT`, `DEFAULT_VIDEO_BOT` |
| `src/services/llm-client.ts` | `LlmClient` interface + `createPoeClient()` implementation |
| `src/services/client-instance.ts` | Global client instance (`setGlobalClient`, `getGlobalClient`) |
| `src/services/media-download.ts` | Download media URLs to files |
| `src/sdk/generate.ts` | SDK `generate()`, `generateImage()`, `generateVideo()`, `generateAudio()` functions |

### Test Infrastructure

| File | Description |
|------|-------------|
| `tests/helpers/snapshot-client.ts` | Snapshot-backed `LlmClient` implementation |
| `tests/helpers/snapshot-store.ts` | Snapshot listing, deletion, refresh utilities |
| `tests/helpers/snapshot-config.ts` | Environment variable parsing for snapshots |
| `__snapshots__/` | Snapshot storage directory |

### Dev Tools

| File | Description |
|------|-------------|
| `scripts/snapshots.ts` | Snapshot management CLI |
| `scripts/test-generate.ts` | Manual testing with cheap models |

## Testing Strategy

### Test Environment

Tests use environment variables to configure snapshot behavior:

```bash
# Run tests with playback (default for CI)
POE_SNAPSHOT_MODE=playback npm test

# Record new snapshots
POE_SNAPSHOT_MODE=record npm test
```

### Test Constants

```typescript
// tests/constants.ts
export const TEST_MODELS = {
  text: "Claude-Haiku-4.5",    // Cheap, fast
  image: "nano-banana-pro",
  video: "veo-3.1",
  audio: "ElevenLabs-v3"
} as const;

export const TEST_PROMPTS = {
  simple: "What is 2+2?",
  image: "A red square on white background",
  video: "Ocean waves",
  audio: "Hello world"
} as const;
```

### Unit Tests

1. **Model override precedence** - CLI flag > env var > SDK option > constant
2. **Snapshot key generation** - Same request = same key
3. **Snapshot record mode** - Calls base client, saves response
4. **Snapshot playback mode** - Returns cached or handles miss

### Integration Tests

Integration tests call the actual CLI and verify output. Snapshots make these deterministic.

```typescript
// tests/integration/generate-cli.test.ts
describe("poe-code generate CLI", () => {
  it("returns LLM response for simple prompt", async () => {
    const result = await runPoeCode(["generate", "What is 2+2?"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("4");
  });
});
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
