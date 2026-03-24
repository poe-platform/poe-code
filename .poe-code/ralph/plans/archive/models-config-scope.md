---
status: completed
iteration: 3
---
# Models Config Scope

## Goal

Move model defaults from hardcoded constants into the `poe-code-config` package as a `models` scope, enabling per-agent and global default overrides persisted in `~/.poe-code/config.json`. Lives in the config package so pipeline, ralph, spawn, and any future consumer can share it.

## Config Shape

```json
{
  "models": {
    "default": "anthropic/claude-sonnet-4.6",
    "claude-code": "anthropic/claude-opus-4.6",
    "codex": "openai/gpt-5.4"
  }
}
```

- `default` — global fallback model for any agent
- `<agent-id>` — per-agent override (e.g. `claude-code`, `codex`, `kimi`, `opencode`)

## Resolution Order (highest wins)

```
CLI --model arg  >  config models.<agent-id>  >  config models.default  >  constants (DEFAULT_*_MODEL)
```

## Current State

- Model defaults live in `src/cli/constants.ts` as `DEFAULT_CLAUDE_CODE_MODEL`, `DEFAULT_CODEX_MODEL`, etc.
- Each provider declares `configurePrompts.model.defaultValue` pointing to these constants
- `resolveModel()` in `src/cli/options.ts` takes `defaultValue` from the provider and resolves via CLI arg → prompt → default
- Spawn command passes `--model` directly from CLI arg, no config lookup
- The config package (`poe-code-config`) supports scopes with flat key-value schemas (`SchemaField` supports `string | number | boolean`)

## Approach: Add models module to `poe-code-config`

The `models` scope has dynamic keys (agent IDs aren't known at schema definition time). Use `readDocument`/`writeScope` directly — same pattern as `configured_services` in `src/services/config.ts`. No `defineScope` / schema changes needed.

The module lives in the config package so all consumers (spawn, pipeline, ralph) import from the same place.

## Implementation Steps

### Step 1: TDD — `packages/poe-code-config/src/models.test.ts`

Tests with memfs:

- `loadAgentModel` returns `null` when no config exists
- `loadAgentModel` returns the agent-specific model when set
- `loadDefaultModel` returns `null` when no config
- `loadDefaultModel` returns the default when set
- `resolveModel` returns agent model when both agent and default are set
- `resolveModel` returns global default when agent model not set
- `resolveModel` returns `null` when neither set (caller provides constant fallback)
- `saveAgentModel` writes only the agent key without clobbering other keys
- `saveDefaultModel` writes the default key without clobbering agent keys

### Step 2: Implement `packages/poe-code-config/src/models.ts`

```typescript
import type { FileSystem } from "@poe-code/config-mutations";
import { readDocument, writeScope } from "./store.js";

const SCOPE = "models";
const DEFAULT_KEY = "default";

export interface ModelsConfigOptions {
  fs: FileSystem;
  filePath: string;
}

export async function loadAgentModel(
  options: ModelsConfigOptions,
  agentId: string
): Promise<string | null>

export async function loadDefaultModel(
  options: ModelsConfigOptions
): Promise<string | null>

/** Returns agent model > global default, or null if neither set */
export async function resolveModel(
  options: ModelsConfigOptions,
  agentId: string
): Promise<string | null>

export async function saveAgentModel(
  options: ModelsConfigOptions,
  agentId: string,
  model: string
): Promise<void>

export async function saveDefaultModel(
  options: ModelsConfigOptions,
  model: string
): Promise<void>
```

All functions read/write the `"models"` scope via `readDocument`/`writeScope`.
`resolveModel` is pure cascade: agent key → default key → `null`. The caller (spawn, pipeline, etc.) applies its own constant fallback.

### Step 3: Export from package index

Add to `packages/poe-code-config/src/index.ts`:

```typescript
export {
  loadAgentModel,
  loadDefaultModel,
  resolveModel as resolveConfigModel,
  saveAgentModel,
  saveDefaultModel,
  type ModelsConfigOptions
} from "./models.js";
```

Export as `resolveConfigModel` to avoid collision with other `resolveModel` functions in consumer code.

### Step 4: Integrate into spawn command

In `src/cli/commands/spawn.ts`, when no `--model` CLI arg is provided:

```typescript
import { resolveConfigModel } from "@poe-code/poe-code-config";

const model = commandOptions.model
  ?? await resolveConfigModel({ fs, filePath }, canonicalService)
  ?? providerDefault;
```

### Step 5: Integrate into configure-payload

In `src/cli/commands/configure-payload.ts`, use config model as pre-selected default:

```typescript
import { loadAgentModel } from "@poe-code/poe-code-config";

const configModel = await loadAgentModel({ fs, filePath }, agentId);
const effectiveDefault = configModel ?? modelPrompt.defaultValue;
```

### Step 6: Wire into SDK spawn

In `src/sdk/spawn.ts` / `src/sdk/spawn-core.ts`, apply same resolution so SDK consumers get config-based defaults.

## Files to Change

| File | Change |
|------|--------|
| `packages/poe-code-config/src/models.ts` | **New** — read/write/resolve models scope |
| `packages/poe-code-config/src/models.test.ts` | **New** — TDD tests |
| `packages/poe-code-config/src/index.ts` | Export new functions |
| `src/cli/commands/spawn.ts` | Config model lookup when `--model` not provided |
| `src/cli/commands/configure-payload.ts` | Use config model as default for prompt |
| `src/sdk/spawn.ts` | Config model resolution |

## What NOT to Change

- `src/cli/constants.ts` — constants remain as ultimate fallbacks
- `poe-code-config` types/schema/resolve — no structural changes needed
- Provider files — keep declaring `configurePrompts.model` with constant defaults; config layer sits above
