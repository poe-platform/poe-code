# toolcraft-schema

tools for agents and humans

Zero-dependency schema builder for typed command inputs and JSON Schema generation.

## Features

- Zero runtime dependencies
- Typed schema descriptors
- `Static<typeof schema>` type inference
- JSON Schema serialization via `toJsonSchema()`
- JSON Schema document serialization via `toJsonSchemaDocument()`

## Usage

```ts
import { S, toJsonSchema, toJsonSchemaDocument } from "toolcraft-schema";
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
```

## API

### Builders

Common options on scalar and collection builders include `description`, `default`, `nullable`,
`short`, `cliAliases`, `scope`, `requiredScopes`, and `global`.

- `S.String({ description?, default?, nullable?, minLength?, maxLength?, pattern?, format?, secret?, short?, cliAliases? })`
- `S.Number({ description?, default?, nullable?, minimum?, maximum?, jsonType?, secret?, short?, cliAliases? })`
- `S.Boolean({ description?, default?, nullable?, short?, cliAliases? })`
- `S.Enum(values, { description?, default?, nullable?, jsonType?, labels?, loadOptions?, short?, cliAliases? })`
- `S.Array(itemSchema, { description?, default?, nullable?, minItems?, maxItems?, short?, cliAliases? })`
- `S.Object({ [key]: schema }, { description?, default?, nullable?, additionalProperties? })`
- `S.Optional(schema)`

### Type helpers

- `Static<typeof schema>` infers the runtime TypeScript shape for a schema descriptor.
- Object properties wrapped in `S.Optional(...)` become optional properties in `Static`.
- Schemas declared with `nullable: true` infer `null` in `Static` and emit `nullable: true` in JSON Schema.

### JSON Schema generation

- `toJsonSchema(schema)` converts any schema descriptor to standard JSON Schema.
- `toJsonSchemaDocument(schema, options)` wraps `toJsonSchema(schema)` in a full JSON Schema document with `$schema`, optional `$id`, `title`, and `description`.
- Object properties not wrapped in `S.Optional(...)` are emitted in `required`.
- Defaults provided to schema builders are emitted as JSON Schema `default` and must satisfy the schema.
- String, number, and array constraints are emitted as JSON Schema validation keywords.
- Nested `S.Object(...)` schemas produce nested JSON Schema objects. Object schemas default to `additionalProperties: false`; pass `additionalProperties: true` to allow unknown keys.
- `S.Enum(...)` rejects empty or duplicate values at runtime for JavaScript callers.
- Invalid builder configuration fails fast, including invalid regex patterns, negative lengths/counts, inverted min/max pairs, non-finite numeric bounds, and integer schemas with non-integer defaults.

## Environment variables

This package exposes no environment variables.

## Configuration

This package currently exposes no package-level configuration options.
