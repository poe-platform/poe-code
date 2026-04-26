# toolcraft

tools for agents and humans

Typed command and group definitions built on top of `toolcraft-schema`.

## Usage

```ts
import { defineCommand, defineGroup } from "toolcraft";
import { S } from "toolcraft-schema";

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
- `createMCPServer(root, options)` exposes `mcp`-scoped commands as MCP tools.
- `runMCP(root, options)` starts the stdio MCP server for the given command tree.

## MCP proxy

`defineGroup` can proxy tools from an upstream MCP server into the toolcraft tree by setting `mcp` to the standard `@poe-code/agent-mcp-config` `McpServerConfig` shape.

```ts
import { defineGroup } from "toolcraft";

export const github = defineGroup({
  name: "github",
  mcp: {
    transport: "stdio",
    command: "github-mcp-server",
  },
  tools: ["create_issue", "list_issues"],
  rename: {
    create_issue: "issues.create",
  },
  children: [],
});
```

- `tools?: string[]` filters the discovered upstream tools by exact upstream tool name.
- `rename?: Record<string, string>` remaps upstream tool names into dotted toolcraft paths. Keys are upstream tool names, values are target toolcraft paths like `"issues.create"`. Missing intermediate groups are created automatically.
- Discovery metadata is cached at `<projectRoot>/.toolcraft/mcp/<group-name>.json`.
- `projectRoot` is resolved from the current working directory by walking up to the nearest ancestor containing `package.json`.
- `TOOLCRAFT_MCP_REFRESH` controls cache invalidation:
  - unset: use the cache when present
  - `1` or `true`: refresh every MCP proxy cache
  - comma-separated names like `github,linear`: refresh only those proxy groups
- Discovery progress is written to `stderr`, not `stdout`. On normal runs it appears only when the cache is missing on first run; forced refreshes also emit it.
- If an upstream input schema contains recursive local `$ref` values, toolcraft falls back to a single JSON argument and the CLI exposes one flag in the form `--<name> '<json>'`.

## Environment variables

- `TOOLCRAFT_MCP_REFRESH`: controls MCP proxy cache refresh behavior. Leave it unset to use cached discovery, set it to `1` or `true` to refresh every proxy, or pass comma-separated group names to refresh specific proxies.
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
- `mcp?: McpServerConfig`: optional upstream MCP server config used to discover and proxy tools into this group.
- `scope?: Array<"cli" | "mcp" | "sdk">`: inherited by descendants that do not override it.
- `secrets?: Record<string, { env: string; description?: string; optional?: boolean }>`: inherited secret declarations.
- `tools?: string[]`: optional allowlist of upstream MCP tool names to expose from this proxy group.
- `rename?: Record<string, string>`: optional map from upstream tool names to dotted toolcraft command paths.
- `requires?: { auth?: boolean; apiVersion?: string; check?: (ctx) => Promise<{ ok: boolean; message?: string }> }`: inherited preconditions.
- `children: Array<Command | Group>`: nested commands and groups.
- `default?: Command`: default child command used by runners when no child token matches.

### `createMCPServer(root, options)` / `runMCP(root, options)`

- `name: string`: MCP server name.
- `version: string`: MCP server version.
- `services?: TServices`: extra services merged into the handler context.
- `tools?: string[]`: optional allowlist of MCP tool names or group prefixes. Tool names use `__`-joined snake_case path segments like `root__bot__create`; passing `root__bot` includes every descendant tool in that subtree.
- `casing?: "snake" | "camel"`: changes MCP input-schema property names and accepted argument keys only. It does **not** change MCP tool names, which always stay `__`-joined snake_case.

### Handler context

- `params`: inferred from the command `params` schema.
- `secrets`: inferred from the command `secrets` declaration.
- `fetch`: `typeof globalThis.fetch`.
- `fs`: `{ readFile, writeFile, exists }`.
- `env`: `{ get(key: string): string | undefined }`.
- `progress(message: string): void`.
- Custom runner services are merged into the same context object.
