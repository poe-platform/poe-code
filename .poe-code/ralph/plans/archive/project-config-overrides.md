---
status: completed
iteration: 3
---
# Project Config Overrides

## Goal

Allow `.poe-code/config.json` in the project directory to override the global `~/.poe-code/config.json`. The project config is deep-merged on top of the global config, so any key set at project level wins.

This applies to all config consumers: spawn, pipeline, ralph, configure.

## Config Locations

```
~/.poe-code/config.json          # global (user-level)
<cwd>/.poe-code/config.json      # project (repo-level)
```

## Merge Semantics

Deep merge, project wins. For each scope:

```json
// global
{ "models": { "default": "anthropic/claude-sonnet-4.6", "codex": "openai/gpt-5.3-codex" } }

// project
{ "models": { "default": "anthropic/claude-opus-4.6" } }

// resolved
{ "models": { "default": "anthropic/claude-opus-4.6", "codex": "openai/gpt-5.3-codex" } }
```

Project config only needs to contain overrides, not a full copy.

## Resolution Order (full picture, with models scope)

```
CLI --model  >  project config  >  global config  >  env vars  >  schema defaults  >  constants
```

## Current State

- `ConfigStoreOptions` takes a single `filePath`
- `createConfigStore` reads one document and resolves scopes against it
- `resolveConfigPath(homeDir)` returns only the global path
- `CliEnvironment` exposes a single `configPath` (global)
- `cwd` is available on `CliEnvironment` but unused for config

## Implementation

### Step 1: Add `deepMergeDocuments` to `poe-code-config`

New file: `packages/poe-code-config/src/merge.ts`

```typescript
import type { ConfigDocument } from "./types.js";

/** Deep merge two config documents. `override` wins on leaf values. */
export function deepMergeDocuments(
  base: ConfigDocument,
  override: ConfigDocument
): ConfigDocument
```

Rules:
- Both objects are `Record<string, Record<string, unknown>>` (scope → keys → values)
- For each scope present in either document, merge the scope objects
- Within a scope, override values replace base values (shallow at the leaf level — scope values are flat key-value pairs, not deeply nested)
- `undefined`/missing keys in override don't clobber base

### Step 2: TDD for `deepMergeDocuments`

`packages/poe-code-config/src/merge.test.ts`:

- base only → returns base
- override only → returns override
- disjoint scopes → union of both
- overlapping scope, disjoint keys → merged
- overlapping scope, same key → override wins
- empty override → returns base unchanged
- empty base → returns override

### Step 3: Add `projectFilePath` to `ConfigStoreOptions`

```typescript
export interface ConfigStoreOptions {
  fs: FileSystem;
  filePath: string;              // global config path
  projectFilePath?: string;      // project config path (optional)
  env?: Record<string, string | undefined>;
}
```

### Step 4: Update `createConfigStore` to merge documents

In `config.ts`, change `resolveScopedValues` to read both documents and merge:

```typescript
async function resolveScopedValues<S extends ScopeSchema>(
  options: ConfigStoreOptions,
  definition: ScopeDefinition<S>,
  env: Record<string, string | undefined>
): Promise<InferConfig<S>> {
  const globalDoc = await readDocument(options.fs, options.filePath);
  const projectDoc = options.projectFilePath
    ? await readDocument(options.fs, options.projectFilePath)
    : {};
  const merged = deepMergeDocuments(globalDoc, projectDoc);
  return resolveScope(definition.schema, merged[definition.scope], env);
}
```

**Writes always go to global config** — `set()` behavior unchanged. Project config is read-only from the package's perspective (users edit it manually or via other tooling).

### Step 5: TDD for `createConfigStore` with `projectFilePath`

Add tests to `config.test.ts`:

- project config overrides global for `get()`
- project config merged with global for `getAll()`
- `set()` writes to global, not project
- missing project file → behaves like today
- project scope absent → global scope used

### Step 6: Export `resolveProjectConfigPath` from store

```typescript
export function resolveProjectConfigPath(cwd: string): string {
  return path.join(cwd, ".poe-code", "config.json");
}
```

### Step 7: Wire into `CliEnvironment`

In `src/cli/environment.ts`:

```typescript
export interface CliEnvironment {
  readonly configPath: string;           // global (existing)
  readonly projectConfigPath: string;    // project (new)
  // ...
}
```

Set `projectConfigPath = resolveProjectConfigPath(init.cwd)`.

All callers that create a `ConfigStore` pass both:
```typescript
createConfigStore({
  fs,
  filePath: container.env.configPath,
  projectFilePath: container.env.projectConfigPath
});
```

### Step 8: Update raw `readDocument` callers

`src/services/config.ts` and the new `models.ts` read documents directly. They need the same merge behavior. Add a helper:

```typescript
// in poe-code-config
export async function readMergedDocument(
  fs: FileSystem,
  globalPath: string,
  projectPath?: string
): Promise<ConfigDocument>
```

So raw-scope callers (configured_services, models) can also benefit from project overrides.

### Step 9: Document in package README

Create `packages/poe-code-config/README.md` documenting:

- Config resolution order
- Project config location and merge semantics
- How to use `projectFilePath` option
- That writes go to global config only

## Files to Change

| File | Change |
|------|--------|
| `packages/poe-code-config/src/merge.ts` | **New** — `deepMergeDocuments` |
| `packages/poe-code-config/src/merge.test.ts` | **New** — merge tests |
| `packages/poe-code-config/src/types.ts` | Add `projectFilePath?` to `ConfigStoreOptions` |
| `packages/poe-code-config/src/config.ts` | Merge global + project documents on read |
| `packages/poe-code-config/src/config.test.ts` | Add project override tests |
| `packages/poe-code-config/src/store.ts` | Add `resolveProjectConfigPath`, `readMergedDocument` |
| `packages/poe-code-config/src/index.ts` | Export new functions |
| `packages/poe-code-config/README.md` | **New** — document config resolution |
| `src/cli/environment.ts` | Add `projectConfigPath` |
| All command files creating `ConfigStore` | Pass `projectFilePath` |

## What NOT to Change

- Project config is read-only — no `set()` writes to project config
- Global config behavior unchanged when no project config exists
- No new CLI flags — project config is auto-discovered from cwd

## Ordering with Models Scope Plan

This plan and the models-config-scope plan are independent. Either can go first. If models lands first, this plan just needs to ensure `readMergedDocument` is used in `models.ts` too.
