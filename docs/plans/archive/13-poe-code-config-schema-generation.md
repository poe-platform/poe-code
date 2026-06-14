# Poe Code Config: Scope-Based Schema Compilation Plan

## Problem

The current shape is backwards:

- `@poe-code/poe-code-config` has the useful primitive: `defineScope(...)`
- but actual scope ownership is still centralized in `src/services/config.ts`

That means packages cannot really own their own config. They can consume config helpers, but they do not define config where the logic lives.

This makes the config system feel ad hoc and harder to scale.

## Goal

Build on top of the existing `@poe-code/poe-code-config` API instead of inventing a second schema system.

The desired model is:

1. any package can import `@poe-code/poe-code-config`
2. any package can define and export its own scope fragment with `defineScope(...)`
3. a compiler walks the production import graph from app/package entrypoints
4. the compiler collects exported scopes reached through that graph
5. the compiler merges those scope fragments into the final root schema
6. runtime config reading/resolution still happens through `@poe-code/poe-code-config`
7. schema composition should reuse `toolcraft-schema`
8. `toolcraft-schema` should own generation of the final output schema document

## Non-goals

- do not introduce a separate `defineConfigModule()` abstraction
- do not require a handwritten central schema registry
- do not scan every import in the repo without an entrypoint model
- do not move schema logic into the CLI core
- do not redesign the whole config package in one go

## Desired Ownership Model

Each package should be able to define config close to the package logic.

Example:

```ts
import { defineScope } from "@poe-code/poe-code-config";

export const pipelineConfigScope = defineScope("pipeline", {
  plan_directory: {
    type: "string",
    default: "",
    env: "POE_PIPELINE_PLAN_DIRECTORY",
    doc: "Custom directory for Pipeline plan files"
  }
});
```

This should be valid from any package.

The important part is that the scope is:

- exported
- declarative
- statically analyzable

## Overlap Model

Exact one-package-per-scope ownership is too strict.

Some scopes, especially `core`, may need contributions from multiple packages.

That means the real model should be:

- multiple packages may contribute to the same scope
- each package contributes a fragment of that scope
- the compiler merges fragments by scope name
- duplicate field names inside the same scope are an error

Example:

```ts
// package A
export const coreAuthScope = defineScope("core", {
  apiKey: {
    type: "string",
    default: "",
    env: "POE_API_KEY",
    doc: "Poe API key"
  }
});
```

```ts
// package B
export const coreUiScope = defineScope("core", {
  theme: {
    type: "string",
    default: "dark",
    doc: "UI theme"
  }
});
```

Compiled result:

```json
{
  "core": {
    "apiKey": { "type": "string" },
    "theme": { "type": "string" }
  }
}
```

## What Should Change

### 1. `defineScope(...)` remains the source of truth

Do not replace it.

Instead, make the existing scope definition format the canonical way to describe config.

That means schema compilation should build on:

- `defineScope(name, schema)`
- existing `SchemaField`
- existing docs/default/env metadata

### 2. `src/services/config.ts` stops owning all scopes

`src/services/config.ts` should become wiring and legacy migration code, not the place where package config is authored.

It can still:

- read/write specific scopes
- expose convenience helpers
- handle legacy migration
- aggregate known scopes temporarily during migration

But package-owned scopes should move into the packages that actually own them.

### 3. Discovery should follow the import graph, not scan all files blindly

The compiler should not try to "find all imports" in the repo.

That would pull in:

- tests
- scripts
- dead code
- dev-only modules

Instead, the compiler should start from known production entrypoints and walk static imports/re-exports.

Recommended starting points:

- root app entrypoints
- package public entrypoints such as `packages/*/src/index.ts`

When a reachable module exports a `defineScope(...)` call, the compiler collects it.

This keeps discovery automatic, but still deterministic.

## `toolcraft-schema` Requirement

Do not add a bespoke schema-emission stack in `poe-code-config`.

Use `toolcraft-schema` as the schema engine for:

- normalized schema representation where possible
- JSON Schema generation
- final schema document generation
- future richer config types such as enums, arrays, objects, and optional fields

`poe-code-config` should remain responsible for config-specific concerns that `toolcraft-schema` does not model today, such as:

- scope names
- environment variable bindings
- config document merging
- runtime resolution order
- migration of stored config documents

In short:

- `toolcraft-schema` = schema primitives + output schema generation
- `poe-code-config` = config semantics / scope semantics / runtime resolution

## Required `toolcraft-schema` Refactor

`toolcraft-schema` should not stop at `toJsonSchema(schema)`.

It should also expose a higher-level API for generating the final output schema document.

Illustrative shape:

```ts
const rootSchema = S.Object({
  version: S.Number({ default: 1 }),
  core: S.Optional(S.Object({ ... })),
  pipeline: S.Optional(S.Object({ ... }))
});

const output = toJsonSchemaDocument(rootSchema, {
  id: "https://.../poe-code.schema.json",
  title: "poe-code config",
  description: "Schema for poe-code config files"
});
```

Expected responsibilities in `toolcraft-schema`:

- wrap `toJsonSchema()` output in a top-level JSON Schema document shape
- support document metadata like `$id`, `title`, and `description`
- remain the single place that knows how schema output is emitted

That keeps `poe-code-config` from growing its own parallel schema-output layer.

## Feasibility

Yes, this is feasible.

A `ts-morph`-based compiler can:

- start from known entrypoints
- resolve imports and re-exports
- walk the reachable module graph
- find exported variables initialized via `defineScope(...)`
- extract the scope name and schema object
- merge fragments by scope name
- convert the merged result into `toolcraft-schema`
- ask `toolcraft-schema` to generate the final output schema document

This is a good use of `ts-morph` because we are extracting a narrow, static pattern.

## Constraint: Scope Definitions Must Stay Static

To compile schema safely, scope definitions must be declarative.

Good:

```ts
export const experimentConfigScope = defineScope("experiment", {
  plan_directory: {
    type: "string",
    default: "",
    env: "POE_EXPERIMENT_PLAN_DIRECTORY",
    doc: "Custom directory for Experiment doc files"
  }
});
```

Bad:

```ts
export const dynamicScope = defineScope(getName(), makeSchema());
```

Supported in v1:

- string/number/boolean literals
- object literals
- nested object literals inside field metadata
- exported `const` scope definitions
- direct calls to `defineScope(...)`

Rejected in v1:

- computed scope names
- dynamic schema builders
- env-driven schema shape
- conditional schema structure
- arbitrary function calls that construct schema

If unsupported patterns are detected, the compiler should fail clearly.

## Proposed Compiler Contract

The compiler should look for shapes equivalent to:

```ts
import { defineScope } from "@poe-code/poe-code-config";

export const someScope = defineScope("scope_name", {
  fieldName: {
    type: "string",
    default: "",
    doc: "...",
    env: "SOME_ENV"
  }
});
```

It does not matter what the exported variable is called.

What matters is:

- exported symbol
- `defineScope(...)` call
- import resolves to `@poe-code/poe-code-config`
- module is reachable from the configured entrypoints

## Composition Model

Each collected scope fragment contributes to one top-level namespace in the final config schema.

Example:

- `coreAuthScope` -> contributes to `core`
- `coreUiScope` -> contributes to `core`
- `pipelineConfigScope` -> contributes to `pipeline`
- `ralphConfigScope` -> contributes to `ralph`

Composed root shape:

```json
{
  "$schema": "https://.../poe-code.schema.json",
  "version": 1,
  "core": { ...merged fields... },
  "pipeline": { ... },
  "ralph": { ... }
}
```

## Placement Recommendation

Even with import-graph discovery, scope definitions should live in a dedicated file in the owning package.

Recommended convention:

```text
packages/pipeline/src/poe-code-config.ts
packages/ralph/src/poe-code-config.ts
packages/agent-spawn/src/poe-code-config.ts
```

Then re-export from the package entrypoint when the scope should participate in schema compilation through the public graph.

Example:

```ts
export { pipelineConfigScope } from "./poe-code-config.js";
```

This gives:

- easy discoverability for humans
- automatic discoverability through imports
- less config logic mixed into runtime files

## Current Limitation in `poe-code-config`

The current `SchemaField` only supports:

- `string`
- `number`
- `boolean`

That is enough for the first compiler pass, but it is smaller than `toolcraft-schema`.

`toolcraft-schema` already supports richer constructs like:

- `enum`
- `array`
- `object`
- `optional`

So the direction should be to converge toward `toolcraft-schema`, not to expand a second unrelated field system forever.

## Recommended Refactor Paths

### Option A: adapter first, minimal disruption

Keep the current `defineScope(...)` authoring API.

Add an adapter in `poe-code-config` that converts the current flat scope schema into `toolcraft-schema` object schemas.

Example internal flow:

- collect exported scope fragments
- merge them by scope name
- convert each merged scope to `S.Object({...})`
- build a root `S.Object({...})`
- ask `toolcraft-schema` to generate the final output schema document

Pros:

- minimal churn
- no immediate breaking change
- fast to adopt

Cons:

- keeps two schema models around for a while
- richer config still blocked by the old field model unless extended

### Option B: redefine scope schema around `toolcraft-schema`

Refactor `defineScope(...)` so the schema payload is based on `toolcraft-schema` directly.

Illustrative direction:

```ts
export const pipelineConfigScope = defineScope("pipeline", {
  schema: S.Object({
    plan_directory: S.String({
      description: "Custom directory for Pipeline plan files",
      default: ""
    })
  }),
  env: {
    plan_directory: "POE_PIPELINE_PLAN_DIRECTORY"
  }
});
```

Pros:

- one real schema model
- immediate access to richer types
- output schema generation becomes straightforward

Cons:

- bigger refactor
- env metadata needs a companion structure because `toolcraft-schema` does not model `env`
- `resolveScope(...)` likely needs a deeper rewrite

### Option C: hybrid transition

Keep current scopes working, but add a second accepted path where `defineScope(...)` can accept a `toolcraft-schema` object schema plus config metadata.

Then migrate scopes incrementally.

Pros:

- incremental
- lowers migration risk
- allows early adoption for richer scopes

Cons:

- dual API during transition
- slightly more complexity while migrating

## Recommended Refactor Direction

Use **Option A first**, then evaluate **Option C**, with **Option B** as the eventual convergence target if it proves worthwhile.

That means:

1. keep `defineScope(...)` working as-is
2. make schema compilation output go through `toolcraft-schema`
3. add an internal adapter from current scope fields to `toolcraft-schema`
4. let `toolcraft-schema` own final output schema generation
5. only after that, decide whether authoring should move to native `toolcraft-schema`

This keeps the initial change small while still standardizing on the existing schema package.

## Potential Runtime Refactors

If the project eventually converges on `toolcraft-schema`, likely refactors include:

1. **`types.ts` simplification**
   - replace or shrink custom `SchemaField` types
   - delegate more structure typing to `toolcraft-schema`

2. **`resolveScope(...)` rewrite**
   - today it is flat-field-specific
   - richer object/array/optional support would require recursive resolution

3. **env metadata handling**
   - likely move from inline field metadata to a companion env map or config wrapper

4. **scope inspection helpers**
   - `config show` / env override inspection may need to walk `toolcraft-schema` object graphs instead of flat records

5. **migration helpers**
   - if stored config grows beyond flat shapes, migration utilities and merge semantics will need to become more explicit

## Minimal Architecture

Build this inside `packages/poe-code-config`.

Suggested internal pieces:

```text
src/
  schema.ts                # existing defineScope helpers
  types.ts                 # existing scope field types
  compile/
    entrypoints.ts         # known schema compilation entrypoints
    graph.ts               # import / re-export traversal
    extract-scopes.ts      # ts-morph export extraction
    validate.ts            # collisions / unsupported patterns
    merge.ts               # merge scope fragments by scope name
    to-toolcraft-schema.ts    # adapt merged scopes to toolcraft-schema
  index.ts
```

And in `packages/toolcraft-schema`:

```text
src/
  index.ts
  json-schema-document.ts  # new final output schema document helper
```

This should stay small.

## Migration Plan

### Phase 1: make scope ownership package-local

Move scope definitions out of `src/services/config.ts` into the packages that own them.

Examples:

- core scope fragments move near core concerns
- pipeline scope moves to pipeline package
- ralph scope moves to ralph package
- experiment scope moves to experiment package

During migration, `services/config.ts` can import and re-export them if needed.

### Phase 2: add import-graph-based scope compiler to `poe-code-config`

Add a compiler that:

- starts from configured production entrypoints
- walks reachable modules
- finds exported `defineScope(...)`
- builds an in-memory list of scope fragments
- validates duplicate field names inside the same scope

### Phase 3: add final-output helper to `toolcraft-schema`

Add a public API in `toolcraft-schema` for generating the final schema document from a root schema.

### Phase 4: adapt merged scopes to `toolcraft-schema`

Add an internal adapter that turns merged scope definitions into `toolcraft-schema` object schemas.

### Phase 5: emit root schema through `toolcraft-schema`

Generate:

- one root JSON Schema file
- optionally one machine-readable metadata file for config help/introspection

### Phase 6: wire build usage

Add a build/dev command that regenerates schema artifacts from reachable exported scopes.

### Phase 7: remove central scope list once safe

Today there is a `knownConfigScopes` list in `src/services/config.ts`.

That can remain temporarily, but long term it should not be the source of truth for schema generation.

## Validation Rules

The compiler should fail when:

- two fragments in the same scope define the same field name
- a scope is exported but not statically analyzable
- a field type is unsupported
- a field default does not match field type
- an imported `defineScope` does not resolve to `@poe-code/poe-code-config`
- a scope fragment is not reachable from the configured entrypoints when reachability is required

## Runtime Relationship

Schema compilation should not replace the current runtime config store.

Keep this split:

- `defineScope(...)` = authoring/source of truth
- compiler = schema artifact generation
- `createConfigStore(...)`, `resolveScope(...)`, `readMergedDocument(...)` = runtime config behavior
- `toolcraft-schema` = schema representation + output schema generation

That means we are extending the current system, not throwing it away.

## Why This Is Better

This approach fixes the actual pain without adding unnecessary architecture.

Benefits:

- packages own their own config
- overlapping scopes are supported safely
- existing `poe-code-config` primitives stay relevant
- reuses `toolcraft-schema` instead of inventing another schema stack
- keeps final schema-output logic in one package
- no giant manual registry
- schema generation is deterministic
- adding a package scope becomes mostly automatic once it is exported into the production graph

## Recommended Decision

Use the existing `defineScope(...)` API as the config contract.

Then:

1. move scopes out of `src/services/config.ts`
2. let packages export their own scope fragments
3. add an import-graph-based `ts-morph` compiler in `@poe-code/poe-code-config`
4. merge fragments by scope name
5. adapt merged scopes to `toolcraft-schema`
6. let `toolcraft-schema` generate the final output schema document

In short:

**build on the current thing, move ownership to packages, allow overlapping scope fragments, and compile schema from exported `defineScope(...)` calls reached through the production import graph, with `toolcraft-schema` as the schema engine and final schema-output generator.**
