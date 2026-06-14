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
  name: S.String({ description: "User name" }),
  retries: S.Optional(S.Number({ default: 3 })),
  mode: S.Enum(["fast", "safe"] as const, { default: "safe" }),
  tags: S.Array(S.String(), { default: [] })
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

- `S.String({ description?, default?, short?, cliAliases? })`
- `S.Number({ description?, default?, short?, cliAliases? })`
- `S.Boolean({ description?, default?, short?, cliAliases? })`
- `S.Enum(values, { description?, default?, short?, cliAliases? })`
- `S.Array(itemSchema, { description?, default?, short?, cliAliases? })`
- `S.Object({ [key]: schema })`
- `S.Optional(schema)`

### Type helpers

- `Static<typeof schema>` infers the runtime TypeScript shape for a schema descriptor.
- Object properties wrapped in `S.Optional(...)` become optional properties in `Static`.

### JSON Schema generation

- `toJsonSchema(schema)` converts any schema descriptor to standard JSON Schema.
- `toJsonSchemaDocument(schema, options)` wraps `toJsonSchema(schema)` in a full JSON Schema document with `$schema`, optional `$id`, `title`, and `description`.
- Object properties not wrapped in `S.Optional(...)` are emitted in `required`.
- Defaults provided to schema builders are emitted as JSON Schema `default`.
- Nested `S.Object(...)` schemas produce nested JSON Schema objects.
- `S.Enum(...)` rejects empty or duplicate values at runtime for JavaScript callers.

## Environment variables

This package exposes no environment variables.

## Configuration

This package currently exposes no package-level configuration options.
