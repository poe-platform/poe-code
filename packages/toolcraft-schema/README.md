# toolcraft-schema

Zero-dependency schema builder for typed command inputs, runtime validation,
and JSON Schema generation.

## Features

- Zero runtime dependencies
- Typed schema descriptors
- `Static<typeof schema>` for legacy inference; `Input` and `Output` for parsed defaults
- Standard Schema v1 validation and Standard JSON Schema v1 conversion
- Runtime validation with `validate()`
- JSON Schema serialization via `toJsonSchema()`
- JSON Schema document serialization via `toJsonSchemaDocument()`
- Native JSON Schema compilation and property projection with reference support

## Usage

```ts
import { S, toJsonSchema, toJsonSchemaDocument, validate } from "toolcraft-schema";
import type { Static } from "toolcraft-schema";

const schema = S.Object({
  name: S.String({ description: "User name", minLength: 1 }),
  retries: S.Optional(S.Number({ default: 3, minimum: 0, jsonType: "integer" })),
  mode: S.Enum(["fast", "safe"] as const, { default: "safe" }),
  tags: S.Array(S.String(), { default: [], maxItems: 5 })
});

type Input = Static<typeof schema>;
// {
//   name: string;
//   retries?: number;
//   mode: "fast" | "safe";
//   tags: string[];
// }

const jsonSchema = toJsonSchema(schema);
const document = toJsonSchemaDocument(schema, {
  id: "https://example.test/schema.json",
  title: "Example schema"
});
const validation = validate(schema, {
  name: "Ada",
  mode: "safe",
  tags: []
});
```

## API

### Builders

- `S.String({ description?, default?, short?, cliAliases? })`
- `S.Number({ description?, default?, short?, cliAliases? })`
- `S.Boolean({ description?, default?, short?, cliAliases? })`
- `S.Enum(values, { description?, default?, short?, cliAliases? })`
- `S.Array(itemSchema, { description?, default?, short?, cliAliases? })`
- `S.Record(valueSchema)`
- `S.Union([objectSchemaA, objectSchemaB])`
- `S.OneOf({ discriminator: "kind", branches: { text: objectSchemaA, count: objectSchemaB } })`
- `S.Object({ [key]: schema })`
- `S.Optional(schema)`

### Type helpers

- `Static<typeof schema>` infers the runtime TypeScript shape for a schema descriptor.
- Object properties wrapped in `S.Optional(...)` become optional properties in `Static`.
- Schemas declared with `nullable: true` infer `null` and emit standard JSON Schema null unions.
- `Input<typeof schema>` describes accepted inputs. `Output<typeof schema>` makes optional properties with defaults required after parsing, including nested objects and arrays. `Static` keeps its existing optional-property behavior.

### JSON Schema generation

- `toJsonSchema(schema)` converts any schema descriptor to standard JSON Schema.
- `toJsonSchemaDocument(schema, options)` wraps `toJsonSchema(schema)` in a full JSON Schema document with `$schema`, optional `$id`, `title`, and `description`.
- Object properties not wrapped in `S.Optional(...)` are emitted in `required`.
- Defaults provided to schema builders are emitted as JSON Schema `default` and must satisfy the schema.
- String, number, and array constraints are emitted as JSON Schema validation keywords.
- Nested `S.Object(...)` schemas produce nested JSON Schema objects. Object schemas default to `additionalProperties: false`; pass `additionalProperties: true` to allow unknown keys.
- `S.Enum(...)` rejects empty or duplicate values at runtime for JavaScript callers.
- Invalid builder configuration fails fast, including invalid regex patterns, negative lengths/counts, inverted min/max pairs, non-finite numeric bounds, and integer schemas with non-integer defaults.

### Runtime validation

- `validate(schema, value)` returns `{ ok: true, value }` for valid input.
- Invalid input returns `{ ok: false, issues }` with path-aware diagnostics.
- Validation fills missing optional properties with their inner schema defaults. Required properties remain required. Use `{ defaults: "none" }` to disable defaults, or `{ defaults: "all" }` to also fill required properties. Each parsed default is an independent copy.

`compileJsonSchema(document, options)` validates complete native JSON Schema
documents. `projectJsonSchemaProperties(document, options)` supplies stable
property names, unconditional required metadata, resolved schema annotations,
and candidate validators for CLI generation. It follows references, compositions,
embedded resource IDs and conditional declarations using the same compiler.
Property candidate validators accept values matching at least one declaration;
validate the complete object to enforce branch-dependent and combined constraints.
Both functions accept a `registry` for external schema documents without network
fetching.

`isJsonValue(value, options)` checks JSON data without invoking getters or
serialization hooks. It rejects cycles, sparse arrays, non-finite numbers and
non-JSON prototypes. Defaults bound the tree to 10,000 nodes and depth 64.
Use `maxNodes` for larger bounded documents (`Infinity` removes the node budget), or `maxDepth` (0–256) to choose a
depth budget. Shared objects count once for each occurrence in the JSON tree;
options never change other calls' budgets.

## Use with Standard Schema consumers

Pass a builder result directly to libraries that accept Standard Schema and
Standard JSON Schema, including tiny MCP servers. No adapter is required.

```ts
import { S } from "toolcraft-schema";
import { createServer } from "tiny-stdio-mcp-server";

const input = S.Object({
  query: S.String(),
  limit: S.Optional(S.Number({ default: 10 }))
});

createServer({ name: "search", version: "1" })
  .tool("search", "Search", input, ({ query, limit }) => {
    // query: string; limit: number (the default has been applied)
    return `${query}: ${limit}`;
  });

const parsed = await input["~standard"].validate({ query: "hello" });
// { value: { query: "hello", limit: 10 } } or { issues: [...] }
const document = input["~standard"].jsonSchema.input({ target: "draft-2020-12" });
const outputDocument = input["~standard"].jsonSchema.output({ target: "draft-2020-12" });
```

Standard validation uses the default optional-property behavior of `validate`.
Input conversion keeps defaulted optional properties optional; output conversion
marks them required. Direct `toJsonSchema(schema, { io: "output" })` also exposes
this output shape. Converters support `draft-07` and `draft-2020-12`, and reject
unsupported targets. Native schemas attached with `withJsonSchema` remain the
authoritative contract; projection defaults do not alter their values.

The `~standard` methods are non-enumerable. JSON serialization and structured
cloning keep the existing data descriptors. A spread or structured clone does
not retain methods: call `withStandardSchema(copiedDescriptor)` to attach them
when passing the copy to a standard consumer. Existing `validate` and
`toJsonSchema` functions continue to accept these plain descriptors.

## Environment Variables

This package exposes no environment variables.

## Configuration

This package currently exposes no package-level configuration options.
