# Plan: `config-extends` — Shared Document Inheritance Primitive

## Problem

Multiple packages (experiment-loop, github-workflows, ralph, poe-code-config) load markdown-with-frontmatter, YAML, or JSON documents that represent configs, plans, or prompt templates. Target repos need to override specific fields (e.g. `agent`) without copying entire documents. Each package currently handles cascading/loading differently, and github-workflows has an `--eject` pattern that creates stale full copies.

## Design

### Unified Document Model

Markdown-with-frontmatter, YAML, and JSON all normalize to a flat `Record<string, unknown>`.

In markdown, the body becomes the `prompt` key in data. In YAML/JSON, `prompt` is a regular key. No special treatment — `prompt` goes through the same merge as every other field (except it uses "first non-empty" instead of "first non-undefined").

### Supported Formats

- **Markdown** (`.md`): YAML frontmatter + body. Body becomes `data.prompt`.
- **YAML** (`.yaml`, `.yml`): All fields are top-level keys.
- **JSON** (`.json`): Same as YAML but in JSON format.

Format detection: by file extension. Fallback for no extension: starts with `{` → JSON, starts with `---\n` → markdown, otherwise → YAML.

### Chain-Based Resolution

The consumer defines an explicit, ordered chain of layers. Each layer is one of:

- **data layer** — has `data`: pre-resolved key-value pairs (CLI flags, config values, defaults)
- **document layer** — has `filePath` + `content`: the file being resolved (parsed at resolve time)
- **base layer** — has `path`: a directory to search for extends bases

```typescript
await resolve([
  { source: "cli",      data: { agent: cliArgs.agent } },
  { source: "document", filePath, content },
  { source: "base",     path: path.join(cwd, ".poe-code/experiments/bases") },
  { source: "base",     path: path.join(homeDir, ".poe-code/experiments/bases") },
  { source: "defaults", data: { agent: "claude-code" } },
], { fs });
```

The chain IS the documentation — you look at the call site and see the full resolution order.

### Resolution Algorithm

1. Find the document layer → parse it (md/yaml/json) into `data` + optional `extends`
2. If `extends: true`, derive the base name from the document's own filename (sans extension)
3. Collect base layer paths → look up `<name>.{md,yaml,yml,json}` in each → first match wins
4. If the base itself has `extends: true`, resolve recursively (max depth 5, cycle detection via visited set)
5. Build merge input: data layers before document (overrides) → document → resolved base → data layers after document (fallbacks)
6. Deep merge: for each field, first non-undefined value wins. Nested objects are recursively merged. For `prompt`: first non-empty wins.
7. Return merged data + source map showing where each field came from.

### `extends` Field

`extends: true` in the document triggers inheritance. The base name is always the document's own filename — the document `review.md` looks for `review.{md,yaml,yml,json}` in the base directories.

No named extends (no `extends: "some-other-name"`). If you want a different base, name your file to match the base you want.

### `autoExtend` Option

When `autoExtend: true`, the document auto-inherits from base layers even without `extends: true` in the file. Used for `config.json` where project always extends global.

### Merge Semantics (deep by default)

- Scalars: first defined wins (chain order)
- Arrays: first defined wins (no partial merge)
- Objects: recursively merged (child keys override, base keys preserved)
- `prompt`: first non-empty wins
- `extends`: stripped from final output
- `null`: treated as defined (stops the chain for that field)

### Relationship with poe-code-config

`poe-code-config` has its own resolution (env → project config.json → global config.json → schema defaults). That stays unchanged. The resolved config values feed into the `resolve()` chain as a `data` layer:

```text
poe-code-config: env → project config.json → global config.json → schema default
                                                    ↓
                                            resolved config values
                                                    ↓
resolve() chain:  CLI → document → bases → config (from above) → defaults
```

For config.json itself, `resolve()` with `autoExtend: true` replaces `deepMergeDocuments()`.

## Package: `@poe-code/config-extends`

New shared package at `packages/config-extends/`.

### API

```typescript
import { resolve, parseDocument } from "@poe-code/config-extends";

const resolved = await resolve(chain, { fs });
// resolved.data    — merged fields (Record<string, unknown>), includes prompt
// resolved.sources — which source each field came from
// resolved.chain   — file paths traversed during extends resolution
```

### Types

```typescript
type DataLayer = { source: string; data: Record<string, unknown> };
type DocumentLayer = { source: string; filePath: string; content: string };
type BaseLayer = { source: string; path: string };
type ChainLayer = DataLayer | DocumentLayer | BaseLayer;

interface ResolveOptions {
  fs: FileSystem;
  autoExtend?: boolean;   // auto-inherit from bases even without extends: true
}

interface ResolvedDocument {
  data: Record<string, unknown>;    // merged fields, extends stripped, prompt included
  sources: Record<string, string>;  // field → source label
  chain: string[];                  // file paths resolved, for debugging
}

interface ParsedDocument {
  data: Record<string, unknown>;    // includes prompt if body/yaml prompt exists
  format: "markdown" | "yaml" | "json";
  extends: boolean;                 // true if extends: true was in the document
}

interface FileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
}
```

Layer discrimination is structural: check for `"data" in layer`, `"filePath" in layer`, or `"path" in layer`. The property names are mutually exclusive across the three types.

## Integration Targets

All 8 cascade/override patterns in the codebase that config-extends replaces or unifies.

### 1. experiment-loop docs

**Current**: Frontmatter parsed, no inheritance. Must copy entire doc to change agent.
**After**: `extends: true` in frontmatter inherits from base.

```typescript
const resolved = await resolve([
  { source: "cli",      data: { agent: options.agent } },
  { source: "document", filePath: absoluteDocPath, content: rawContent },
  { source: "base",     path: path.join(cwd, ".poe-code/experiments/bases") },
  { source: "base",     path: path.join(homeDir, ".poe-code/experiments/bases") },
  { source: "defaults", data: { agent: "claude-code" } },
], { fs });
```

### 2. experiment-loop run.yaml

**Current**: `loadRunConfig()` in `packages/experiment-loop/src/config/loader.ts` — first-match: project `.poe-code/experiments/run.yaml` → global `~/.poe-code/experiments/run.yaml` → bundled `default-run.yaml`. If project provides run.yaml, bundled default is lost entirely (overwrite semantics).
**After**: Opt-in extend. No `autoExtend` — project run.yaml stands alone by default (preserves current overwrite behavior). Add `extends: true` in the file to merge with bundled default instead.

```typescript
const resolved = await resolve([
  { source: "document", filePath: projectRunYamlPath, content: projectRunYaml },
  { source: "base",     path: path.join(homeDir, ".poe-code/experiments") },
  { source: "base",     path: bundledConfigDir },
], { fs });
// no autoExtend — project run.yaml replaces default (current behavior)
// user adds extends: true to their run.yaml to opt into merging
```

### 3. github-workflows prompts

**Current**: `--eject` copies entire built-in prompt to `.github/workflows/poe-code-<name>.md`. Stale fork — upstream improvements never reach ejected copies.
**After**: `extends: true` in frontmatter inherits built-in prompt, overrides only what's needed.

```typescript
const resolved = await resolve([
  { source: "document", filePath: promptPath, content: promptContent },
  { source: "base",     path: path.join(cwd, ".poe-code/github-workflows") },
  { source: "base",     path: path.join(cwd, ".github/workflows") },
  { source: "base",     path: builtInPromptsDir },
  { source: "defaults", data: { agent: "codex" } },
], { fs });
```

### 4. github-workflows variables.yaml

**Current**: `loadVariables()` in `packages/github-workflows/src/variables.ts` — spread merge `{ ...builtInVariables, ...projectVariables }`. Empty string disables a variable. Custom `generateProjectVariablesFile()` creates commented-out defaults.
**After**: `autoExtend` — project `variables.yaml` auto-extends built-in `variables.yaml`. Same override semantics, unified mechanism.

```typescript
const resolved = await resolve([
  { source: "document", filePath: projectVariablesPath, content: projectVariablesContent },
  { source: "base",     path: builtInDir },
], { fs, autoExtend: true });
```

### 5. ralph docs

**Current**: Frontmatter parsed, no inheritance. Every doc is standalone.
**After**: `extends: true` in frontmatter inherits from base.

```typescript
const resolved = await resolve([
  { source: "cli",      data: { agent: cliArgs.agent, iterations: cliArgs.iterations } },
  { source: "document", filePath: docPath, content: rawContent },
  { source: "base",     path: path.join(cwd, ".poe-code/ralph/bases") },
  { source: "base",     path: path.join(homeDir, ".poe-code/ralph/bases") },
  { source: "defaults", data: { agent: "claude-code", iterations: 3 } },
], { fs });
```

### 6. poe-code-config (config.json)

**Current**: `readMergedDocument()` in `packages/poe-code-config/src/store.ts` — custom `deepMergeDocuments()` merges global + project JSON by scope.
**After**: `autoExtend` — project config.json auto-extends global. Deep merge handles nested scopes.

```typescript
const resolved = await resolve([
  { source: "project", filePath: projectConfigPath, content: projectContent },
  { source: "base",    path: globalConfigDir },
], { fs, autoExtend: true });
```

### 7. pipeline config.yaml

**Current**: `loadPipelineConfig()` in `packages/pipeline/src/config/loader.ts` — spread merge `{ ...globalConfig, ...projectConfig }`. Project completely overrides global keys.
**After**: `autoExtend` — project config.yaml auto-extends global. Deep merge preserves nested values.

```typescript
const resolved = await resolve([
  { source: "document", filePath: projectConfigPath, content: projectConfigContent },
  { source: "base",     path: path.join(homeDir, ".poe-code/pipeline") },
], { fs, autoExtend: true });
```

### 8. pipeline steps.yaml

**Current**: `loadResolvedSteps()` in `packages/pipeline/src/config/loader.ts` — per-step spread merge `{ ...globalConfig.steps, ...projectConfig.steps }` plus `??` coalescing for setup/teardown. Each step object replaces entirely (project step `implement: { prompt: "..." }` loses global step's `mode`, `agent`, `model`).
**After**: Opt-in extend. No `autoExtend` — project steps.yaml replaces global steps by default (preserves current shallow per-step overwrite). Add `extends: true` to opt into deep merge where project step fields override while preserving global step fields not mentioned.

```typescript
const resolved = await resolve([
  { source: "document", filePath: projectStepsPath, content: projectStepsContent },
  { source: "base",     path: path.join(homeDir, ".poe-code/pipeline") },
], { fs });
// no autoExtend — project step replaces global step entirely (current behavior)
// user adds extends: true to opt into deep merge within steps
```
