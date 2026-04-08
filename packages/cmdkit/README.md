# @poe-code/cmdkit

Typed command and group definitions built on top of `@poe-code/cmdkit-schema`.

Also available as `poe-code/cmdkit` for consumers of the published `poe-code` package.

## Usage

```ts
import { defineCommand, defineGroup } from "poe-code/cmdkit";
import { S } from "@poe-code/cmdkit-schema";

const deploy = defineCommand({
  name: "deploy",
  params: S.Object({
    service: S.String(),
  }),
  secrets: {
    apiKey: {
      env: "API_KEY",
    },
  },
  handler: async ({ params, secrets }) => ({
    service: params.service,
    authenticated: Boolean(secrets.apiKey),
  }),
});

export const root = defineGroup({
  name: "root",
  children: [deploy],
});
```

## API

- `defineCommand(config)` creates a typed command definition with inferred `params` and `secrets`.
- `defineGroup(config)` creates a command group and inherits `secrets`, `requires`, and `scope` through descendants.
- `UserError` marks expected user-facing failures.

## Environment variables

- This package does not read environment variables directly.
- Commands can declare required or optional secret environment variable names via `secrets`.

## Configuration

### `defineCommand(config)`

- `name: string`: command name.
- `description?: string`: help text for the command.
- `aliases?: string[]`: alternate command names.
- `positional?: string[]`: positional parameter names mapped from CLI argv order.
- `params: S.Object(...)`: command parameter schema.
- `secrets?: Record<string, { env: string; description?: string; optional?: boolean }>`: environment-backed secrets available in the handler context.
- `scope?: Array<"cli" | "mcp" | "sdk">`: runner visibility. Defaults to `["cli", "sdk"]`.
- `confirm?: boolean`: whether the command requires confirmation before execution. Defaults to `false`.
- `requires?: { auth?: boolean; apiVersion?: string; check?: (ctx) => Promise<{ ok: boolean; message?: string }> }`: command preconditions.
- `handler: (ctx) => Promise<unknown>`: async command implementation.
- `render?: { rich?: (result, primitives) => void; markdown?: (result) => string; json?: (result) => unknown }`: optional output renderers.

### `defineGroup(config)`

- `name: string`: group name.
- `description?: string`: help text for the group.
- `aliases?: string[]`: alternate group names.
- `scope?: Array<"cli" | "mcp" | "sdk">`: inherited by descendants that do not override it.
- `secrets?: Record<string, { env: string; description?: string; optional?: boolean }>`: inherited secret declarations.
- `requires?: { auth?: boolean; apiVersion?: string; check?: (ctx) => Promise<{ ok: boolean; message?: string }> }`: inherited preconditions.
- `children: Array<Command | Group>`: nested commands and groups.
- `default?: Command`: default child command used by runners when no child token matches.

### Handler context

- `params`: inferred from the command `params` schema.
- `secrets`: inferred from the command `secrets` declaration.
- `fetch`: `typeof globalThis.fetch`.
- `fs`: `{ readFile, writeFile, exists }`.
- `env`: `{ get(key: string): string | undefined }`.
- `progress(message: string): void`.
- Custom runner services are merged into the same context object.
