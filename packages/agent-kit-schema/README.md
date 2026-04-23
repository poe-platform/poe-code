# agent-kit-schema

Zero-dependency schema builder for typed command inputs and JSON Schema generation.

## Features

- Zero runtime dependencies
- Typed schema descriptors
- `Static<typeof schema>` type inference
- JSON Schema serialization via `toJsonSchema()`

## Usage

```ts
import { S, toJsonSchema } from "agent-kit-schema";
import type { Static } from "agent-kit-schema";

const schema = S.Object({
  name: S.String({ description: "User name" }),
  retries: S.Optional(S.Number({ default: 3 })),
  mode: S.Enum(["fast", "safe"] as const, { default: "safe" }),
  tags: S.Array(S.String(), { default: [] }),
});

type Input = Static<typeof schema>;
// {
//   name: string;
//   retries?: number;
//   mode: "fast" | "safe";
//   tags: string[];
// }

const jsonSchema = toJsonSchema(schema);
```

## API

### Builders

- `S.String({ description?, default? })`
- `S.Number({ description?, default? })`
- `S.Boolean({ description?, default? })`
- `S.Enum(values, { description?, default? })`
- `S.Array(itemSchema, { description?, default? })`
- `S.Object({ [key]: schema })`
- `S.Optional(schema)`

### Type helpers

- `Static<typeof schema>` infers the runtime TypeScript shape for a schema descriptor.
- Object properties wrapped in `S.Optional(...)` become optional properties in `Static`.

### JSON Schema generation

- `toJsonSchema(schema)` converts any schema descriptor to standard JSON Schema.
- Object properties not wrapped in `S.Optional(...)` are emitted in `required`.
- Defaults provided to schema builders are emitted as JSON Schema `default`.
- Nested `S.Object(...)` schemas produce nested JSON Schema objects.
- `S.Enum(...)` rejects empty or duplicate values at runtime for JavaScript callers.

## Environment variables

This package exposes no environment variables.

## Configuration

This package currently exposes no package-level configuration options.
