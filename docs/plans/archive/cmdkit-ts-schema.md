# cmdkit-ts-schema

## Problem

`@poe-code/cmdkit-schema` currently uses a custom schema DSL as the source of truth:

```ts
const params = S.Object({
  name: S.String(),
  force: S.Optional(S.Boolean())
});
```

That gives us:

- TypeScript inference via `Static<typeof schema>`
- runtime schema objects that `cmdkit` can inspect
- JSON Schema generation via `toJsonSchema()`

But it also means the schema shape is not native TypeScript. For editor hints, published `$schema` files, GitHub Pages-hosted JSON Schema, agent-facing document types, and markdown/yaml-frontmatter workflows, native TypeScript + JSDoc is a better authoring model.

We want to explore a new package, `@poe-code/cmdkit-ts-schema`, that starts from native TypeScript types and generates schema artifacts, while grounding the design in current real-world `cmdkit` and MCP use cases.

## Goals

1. Create a new package `@poe-code/cmdkit-ts-schema` for TypeScript/JSDoc-first schema generation.
2. Start from existing real use cases, especially `cmdkit` and MCP.
3. Compare the new package against the current `cmdkit-schema` DSL before deciding on any migration.
4. Generate advisory JSON Schema from TypeScript types.
5. Keep generated schemas loose enough to act as hints rather than rigid contracts.
6. Make the output publishable, e.g. to GitHub Pages, so docs/config/frontmatter can reference stable schema URLs.
7. Learn whether `cmdkit` can eventually consume TS-derived artifacts for runtime behavior.

## Non-goals

- Do not replace `@poe-code/cmdkit-schema` immediately.
- Do not attempt to support all of TypeScript in v1.
- Do not make strict validation the primary goal.
- Do not redesign all `cmdkit` APIs in the same change.
- Do not force all runtime CLI behavior into JSON Schema.

## Why a new package first

A new package is the safest way to compare approaches.

Benefits:

- no disruption to the existing `cmdkit-schema` DSL
- real side-by-side comparison on current repo use cases
- easier to delete or merge later based on results
- freedom to experiment with a narrower API

## Existing use cases investigated first

The first evaluation target should be existing `cmdkit` use cases, not hypothetical future schemas.

### Use case 1: cmdkit command parameter schemas

Today `cmdkit` command definitions use `@poe-code/cmdkit-schema` directly.

Representative examples:

- `packages/github-workflows/src/commands.ts`
- `packages/terminal-pilot/src/commands/*.ts`
- `packages/cmdkit/src/*.test.ts`

Current schema builders used in commands:

- `S.String`
- `S.Number`
- `S.Boolean`
- `S.Enum`
- `S.Array`
- `S.Object`
- `S.Optional`

Current field-level metadata/features used in commands and tests:

- `description`
- `default`
- `short`
- enum `labels`
- enum `loadOptions`

These are real current features, not theoretical ones.

### Use case 2: cmdkit CLI runner

`packages/cmdkit/src/cli.ts` inspects schema objects at runtime to drive CLI behavior.

Current runtime responsibilities include:

- recursive field collection from nested object schemas
- optional vs required detection
- default handling
- enum prompting
- enum label display
- async/sync `loadOptions()` support
- short flag support
- array parsing
- nested option path handling
- positional argument mapping
- help text generation using descriptions/defaults
- missing-param prompting with `select()`, `promptText()`, and `confirm()`

Critical observation: the schema is not only used for typing. `cmdkit` depends on runtime schema objects for CLI behavior today.

### Use case 3: cmdkit MCP runner

`packages/cmdkit/src/mcp.ts` uses schema objects at runtime for MCP tool exposure.

Current responsibilities include:

- generating tool `inputSchema` via `toJsonSchema()`
- casing transformations on generated schema properties
- parameter summary generation from schema structure
- runtime parameter validation and default materialization using schema shape

### Use case 4: cmdkit SDK runner

`packages/cmdkit/src/sdk.ts` also uses schema objects at runtime.

Current responsibilities include:

- materializing defaults
- validating enums and primitive types
- validating nested object inputs
- generating camelized SDK methods from command definitions

## Important nuance about current responsibilities

`@poe-code/cmdkit-schema` itself is fairly small. It mainly provides:

- the DSL object model
- TypeScript inference helpers
- JSON Schema generation
- small enum construction checks

The heavier runtime behavior lives in `cmdkit` (`cli.ts`, `mcp.ts`, `sdk.ts`), which traverses the schema objects.

That nuance matters: even if `cmdkit-schema` is not a full validation engine, its runtime shape is still deeply coupled to `cmdkit` semantics.

## Public API coupling discovered during investigation

`cmdkit` is currently type-coupled to the DSL package, not just implementation-coupled.

Examples in `packages/cmdkit/src/index.ts`:

- command generics are bounded by `ObjectSchema<any>`
- handler `params` types are derived from `Static<TParamsSchema>`
- `defineCommand()` and `defineGroup()` are built around schema descriptors, not native TS parameter interfaces

This means a TS-first migration is not only a codegen problem. It is also a public API design problem.

If `cmdkit-ts-schema` works well, one of these must happen later:

1. add a compatibility bridge so `defineCommand()` can still consume generated runtime artifacts
2. add a parallel TS-first `defineCommand()` surface
3. keep the DSL for command execution and use TS-first schemas only for published/document schemas

## Main architectural question

Should `cmdkit-ts-schema` only generate JSON Schema from TypeScript, or should it also generate runtime artifacts that `cmdkit` can inspect?

This is the main fork.

## Option A: JSON Schema only

`cmdkit-ts-schema` only generates JSON Schema from TypeScript types.

Pros:

- simple mental model
- ideal for published schemas and `$schema` hints
- ideal for GitHub Pages-hosted editor/agent hints
- no custom runtime DSL

Cons:

- does not replace existing `cmdkit-schema` use in CLI/MCP/SDK
- does not encode dynamic runtime-only features like `loadOptions()`
- does not help `cmdkit` runners unless they are redesigned around different metadata

Conclusion: useful for document/config/frontmatter schemas, but not enough to replace current `cmdkit-schema` for command definitions.

## Option B: TypeScript -> generated runtime manifest + JSON Schema

`cmdkit-ts-schema` generates:

- JSON Schema artifacts
- a runtime manifest that `cmdkit` can inspect

Pros:

- could eventually replace the current DSL
- keeps TypeScript as source of truth
- gives `cmdkit` runtime something concrete to consume

Cons:

- larger design surface
- must solve how runtime-only metadata is represented
- generation pipeline becomes part of development flow

Conclusion: this is the only serious path if the long-term goal is to replace `cmdkit-schema` for command definitions.

## Option C: hybrid model

Use TypeScript as the source of truth for structure, but do not force every runtime concern into the core schema generator.

Outputs:

1. advisory JSON Schema
2. optional runtime input manifest for CLI acquisition
3. optional generated TypeScript unions/constants for stable value sets

This gives a cleaner separation:

- **structure** lives in TypeScript types
- **descriptive metadata** lives in JSDoc
- **dynamic input behavior** lives in runtime metadata
- **command-only concerns** stay in `cmdkit` / `defineCommand`

Conclusion: this is the most practical path for evaluation.

## Recommended direction

The best current plan is **Option C**.

The core mistake to avoid is treating all metadata as the same kind of thing.

They are not the same.

### Category 1: structural schema

Best source of truth: native TypeScript.

Examples:

- property names
- required vs optional
- primitive types
- arrays
- nested objects
- string literal unions

### Category 2: static descriptive metadata

Best source of truth: JSDoc on TypeScript declarations.

Good fits:

- `description`
- `default`
- examples
- summary/title-like text

### Category 3: input acquisition metadata

This is schema-adjacent, but not pure structural schema.

Examples:

- enum display `labels`
- `loadOptions()` for interactive selection
- maybe prompt style / grouping / ordering later

This should be allowed in an optional runtime metadata layer.

### Category 4: command-specific CLI wiring

This should stay out of the core schema package where possible.

Example:

- `short`

`short` is a CLI flag concern, not a universal schema concern. It is more natural on the command/input layer than on a bare type-to-schema package.

## Hard requirement discovered from current cmdkit use cases

A pure TypeScript interface is not enough for all current `cmdkit` use cases.

Current command definitions need runtime metadata that is not naturally expressible as a plain type:

- `short` flags
- `default` values
- enum display `labels`
- enum `loadOptions()` functions

So a TS-first system needs a split model.

## Proposed metadata placement

### Put in TypeScript types

- shape
- required/optional
- nested objects
- arrays
- string literal unions

### Put in JSDoc

- `description`
- `default`
- examples
- advisory/editor-facing notes

### Put in optional runtime input metadata

- `labels`
- `loadOptions()`
- selection behavior
- future interactive metadata

### Put in command layer, not schema core

- `short`
- positional wiring
- command aliases
- scope-specific behavior

This keeps `cmdkit-ts-schema` focused and avoids stuffing define-command concerns into a generic schema library.

## Example hybrid shape

```ts
export interface InstallParams {
  /** Agent to install the workflow for. */
  agent?: string;

  /** Workflow id to install. */
  workflow?: string;
}

export const installParamInput = {
  agent: {
    loadOptions: async () => [
      { label: "Claude Code", value: "claude-code" },
      { label: "Codex", value: "codex" }
    ]
  },
  workflow: {
    loadOptions: async () => listWorkflowOptions()
  }
} as const;
```

Then `defineCommand()`-level CLI metadata can stay separate:

```ts
const install = defineCommand({
  name: "install",
  params: paramsFromType<InstallParams>({
    input: installParamInput,
    short: {
      agent: "a"
    }
  }),
  async handler(ctx) {
    // ctx.params is InstallParams
  }
});
```

The exact API can change, but the separation is the key point.

## Generated enum/union types as another avenue

Another useful path is compile-time generation of literal unions for values that are known before runtime.

Example generated file:

```ts
export const agents = ["claude-code", "codex"] as const;
export type AgentId = typeof agents[number];
```

This is a strong fit for values that are stable or generated during build, such as:

- built-in agent ids
- built-in workflow ids
- built-in automation names
- built-in template names
- other repo-defined constants

This is not a fit for values that are only known at runtime, such as:

- discovered plan files in the current repo
- filesystem-dependent selections
- remote API-driven selections
- environment-dependent selections

That leads to a useful hybrid:

- use generated literal unions for static-ish value sets
- use runtime `loadOptions()` for dynamic selections

Example:

```ts
export interface RunParams {
  agent?: AgentId;
  plan?: string;
}
```

In that model:

- `agent` gets strong compile-time typing
- `plan` stays a runtime string with interactive selection metadata

This can reduce duplication without pretending all selections can be known statically.

## Supported TypeScript subset for v1

The first version should intentionally support only the subset already visible in current `cmdkit` use cases.

### Support in v1

- interfaces
- type literals
- optional properties
- string / number / boolean
- arrays
- nested object types
- string literal unions
- simple records when clearly representable

### Defer

- conditional types
- complex mapped types
- advanced generics
- arbitrary recursive wizardry
- every possible TypeScript edge case

## JSDoc strategy

JSDoc should carry static metadata where possible.

Good candidates:

- description
- examples
- default values
- title / summary text

Example:

```ts
export interface WaitForParams {
  /** Pattern to wait for. */
  pattern: string;

  /** Session name. */
  session?: string;

  /** Maximum wait time in milliseconds. */
  timeout?: number;
}
```

Executable metadata like `loadOptions()` should use runtime metadata, not JSDoc.

## Proposed package scope

`@poe-code/cmdkit-ts-schema` should start narrow.

### Owns

- TypeScript/JSDoc-based schema extraction
- advisory JSON Schema generation from exported TS types
- optional generation of a loose runtime input manifest
- codegen helpers for writing schema files to disk
- schema publication helpers or conventions for stable hosted URLs

### Does not own initially

- full runtime validation engine
- command execution
- CLI prompt logic
- MCP server logic
- all command-layer flag metadata

## Proposed API direction

### Library API

```ts
generateJsonSchemaFromType({
  tsconfigPath,
  filePath,
  typeName
})

writeJsonSchemaFile({
  tsconfigPath,
  filePath,
  typeName,
  outFile
})
```

### Optional runtime manifest API

```ts
generateRuntimeInputManifest({
  tsconfigPath,
  filePath,
  typeName,
  inputMetadataExportName
})
```

### CLI API

```bash
cmdkit-ts-schema generate \
  --tsconfig tsconfig.json \
  --file packages/terminal-pilot/src/commands/schema.ts \
  --type CreateSessionParams \
  --out docs/schemas/create-session.schema.json
```

## Recommended evaluation targets

Start by evaluating `cmdkit-ts-schema` against two concrete targets.

### Target A: cmdkit command parameter shapes

Try converting representative command inputs from:

- `packages/terminal-pilot/src/commands/create-session.ts`
- `packages/terminal-pilot/src/commands/wait-for.ts`
- `packages/github-workflows/src/commands.ts`

These cover:

- strings
- numbers
- booleans
- arrays
- enums
- defaults
- optional fields
- nested objects
- positional parameters
- short flags
- `loadOptions()`

### Target B: MCP tool schemas

Try generating MCP-friendly `inputSchema` from TS types for commands used by:

- `packages/cmdkit/src/mcp.ts`
- `packages/terminal-pilot-mcp/src/index.ts`

These cover:

- JSON Schema generation
- casing transforms
- nested object schemas
- required/optional handling
- parameter summaries

## Suggested phased plan

### Phase 1: extractor spike

Build a minimal extractor that can read the v1 TypeScript subset and emit advisory JSON Schema.

Success criteria:

- works on at least 2 real `cmdkit` command param types
- emits useful `required` / `properties` / primitive / array info
- keeps output intentionally loose

### Phase 2: JSDoc metadata spike

Add support for:

- descriptions
- defaults
- examples or similar hints

Success criteria:

- schema output is useful in editors and as agent hints
- no second schema DSL is required for simple cases

### Phase 3: runtime input metadata spike

Add optional sidecar metadata for dynamic input behavior.

Start with:

- `labels`
- `loadOptions()`

Do **not** start with every command concern.

Success criteria:

- dynamic selections can be modeled cleanly
- the API does not feel like recreating the old DSL under a new name

### Phase 4: cmdkit integration experiment

Prototype one bridge from TS types to current `cmdkit` runtime needs.

Possibilities:

- generate a compatibility manifest that `cmdkit` can consume
- add an adapter that converts TS-derived artifacts into current runtime schema objects
- prove that only published schemas should use the TS-first path for now

Success criteria:

- one representative command can be authored TS-first without losing current behavior

### Phase 5: decide package fate

After the spike, choose one of:

1. keep `cmdkit-ts-schema` only for published/document/config schemas
2. use it as a companion package plus runtime bridge
3. plan a gradual replacement path for `cmdkit-schema`

## Comparison criteria

`cmdkit-ts-schema` should be judged on:

1. **authoring ergonomics** — is TS+JSDoc nicer than the DSL?
2. **runtime fit** — can it satisfy current cmdkit runtime needs without awkward hacks?
3. **schema quality** — are generated JSON Schemas useful for MCP and published docs?
4. **metadata split** — does the structure/JSDoc/runtime separation feel clean?
5. **maintenance cost** — is there less duplication and less drift?

## Risks

### Underestimating runtime metadata needs

The biggest risk is assuming current `cmdkit-schema` is only about schema export. It is not. `cmdkit` CLI, MCP, and SDK all rely on inspectable schema objects.

### Forcing command concerns into schema core

The opposite risk is shoving everything into the new schema package. `short` is the clearest example of something that should probably live at the command/input layer.

### JSDoc is not enough for executable metadata

`loadOptions()` is the clearest example. A TS-first design still needs a runtime metadata story.

### Full TypeScript support is a trap

Trying to support all of TypeScript in v1 will slow the project down. The package should target the repo's actual type subset first.

## Recommendation summary

Build `@poe-code/cmdkit-ts-schema` as a **TypeScript-first schema hint generator**, not as a full immediate replacement for all of `cmdkit-schema`.

Start with:

- TypeScript structure
- JSDoc metadata
- advisory JSON Schema output
- optional runtime metadata for dynamic selections

Keep these boundaries clear:

- structure in TypeScript
- static hints in JSDoc
- dynamic selections in runtime metadata
- CLI-specific flags like `short` in the command layer

That gives the cleanest path to evaluate the idea without recreating the current DSL in disguise.
