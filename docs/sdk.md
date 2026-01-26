# SDK

## Overview

The SDK exposes programmatic access to `poe-code` functionality, allowing users to spawn provider CLIs from their own code.

```typescript
import { spawn, getPoeApiKey } from "poe-code"

// Get stored API key
const apiKey = await getPoeApiKey()

// Run a prompt through a provider
const result = await spawn("claude-code", {
  prompt: "Fix the bug in auth.ts",
  cwd: "/path/to/project",
  model: "claude-sonnet-4"
})

console.log(result.stdout)
```

## Public API

### `spawn(service, options): Promise<SpawnResult>`

Runs a single prompt through a configured service CLI.

**Parameters:**
- `service: string` - Service identifier (`claude-code`, `codex`, `opencode`)
- `options: SpawnOptions` - Configuration for the spawn

**SpawnOptions:**
```typescript
interface SpawnOptions {
  prompt: string       // The prompt to send
  cwd?: string         // Working directory for the service CLI
  model?: string       // Model identifier override
  args?: string[]      // Additional arguments forwarded to the CLI
}
```

**SpawnResult:**
```typescript
interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number
}
```

**Throws:** `Error` - If no API key found (same as `getPoeApiKey`)

### `getPoeApiKey(): Promise<string>`

Reads the Poe API key with the following priority:

1. `POE_API_KEY` environment variable (if set)
2. Credentials file (`~/.poe-code/credentials.json`)

**Returns:** `string` - The API key

**Throws:** `Error` - If no credentials found: `"No API key found. Set POE_API_KEY or run 'poe-code login'."`

```typescript
import { getPoeApiKey } from "poe-code"

const apiKey = await getPoeApiKey()
```

## Implementation Plan

### Step 1: Extract spawn core logic

Create `src/sdk/spawn.ts` with the core spawn function that:

- Takes `SpawnOptions` and service name
- Calls `getPoeApiKey()` to get credentials (throws if not found)
- Bootstraps a minimal `CliContainer` internally
- Resolves the service adapter from registry
- Invokes the provider's spawn method
- Returns `SpawnResult`

This function should be independent of Commander.js and CLI flags.

```typescript
// src/sdk/spawn.ts
export async function spawn(
  service: string,
  options: SpawnOptions
): Promise<SpawnResult>
```

### Step 2: Create SDK container factory

Create `src/sdk/container.ts` with a lightweight container initialization:

- Uses real file system (node:fs)
- Uses real command runner
- No prompts needed (non-interactive)
- Minimal logger (silent by default, configurable)

```typescript
// src/sdk/container.ts
export function createSdkContainer(options?: SdkContainerOptions): CliContainer
```

### Step 3: Refactor CLI spawn command

Update `src/cli/commands/spawn.ts` to use the SDK function internally:

- CLI command becomes a thin wrapper
- Handles stdin, flags, logging
- Catches credential errors from SDK and shows user-friendly message or prompts for login
- Delegates core work to `sdk/spawn`

### Step 4: Add getPoeApiKey function

Create `src/sdk/credentials.ts` with a simple wrapper:

```typescript
// src/sdk/credentials.ts
export async function getPoeApiKey(): Promise<string>
```

Implementation:

- Check `process.env.POE_API_KEY` first, return if set
- Uses real file system (node:fs/promises)
- Resolves credentials path from `~/.poe-code/credentials.json`
- Delegates to existing `loadCredentials()` from `src/services/credentials.ts`
- Throws error if not found: `"No API key found. Set POE_API_KEY or run 'poe-code login'."`

### Step 5: Export from index

Update `src/index.ts` to export SDK functions:

```typescript
// src/index.ts
export { spawn } from "./sdk/spawn.js"
export { getPoeApiKey } from "./sdk/credentials.js"
export type { SpawnOptions, SpawnResult } from "./sdk/types.js"

// Existing CLI exports
export { main, isCliInvocation }
```

### Step 6: Add SDK types

Create `src/sdk/types.ts` with public type definitions:

```typescript
// src/sdk/types.ts
export interface SpawnOptions {
  prompt: string
  cwd?: string
  model?: string
  args?: string[]
}

export interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number
}
```

## File Structure

```text
src/
├── index.ts                    # exports { spawn, getPoeApiKey, main, isCliInvocation }
├── sdk/
│   ├── spawn.ts               # spawn() function
│   ├── credentials.ts         # getPoeApiKey() function
│   ├── container.ts           # SDK container factory
│   └── types.ts               # Public types (SpawnOptions, SpawnResult)
├── cli/
│   └── commands/
│       └── spawn.ts           # CLI wrapper (uses sdk/spawn internally)
└── providers/
    └── spawn-options.ts       # Internal SpawnCommandOptions (unchanged)
```

## Testing

- Unit tests for `sdk/spawn.ts` using memfs and mocked command runner
- Integration tests that verify SDK and CLI produce same results
- Type tests to ensure public types are correctly exported

## Notes

- `SpawnOptions` (SDK public) vs `SpawnCommandOptions` (internal) - SDK type is simpler, no `useStdin`
- SDK handles container lifecycle internally - users don't need to manage it
- Errors are thrown as exceptions, not logged to console
- Credential errors: SDK throws, CLI catches and prompts user or shows friendly message
