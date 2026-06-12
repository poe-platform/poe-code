# toolcraft

Create tools for both agents and humans.

Define a command once. Get a typed CLI, an MCP server, and a typed SDK from the same source. Built on `toolcraft-schema`.

## Why

You have a folder of one-off scripts and a couple of MCP servers. Each one re-derives its own argument parsing, env handling, and help text. Running them from a chatbot needs another adapter. Calling them from another script means subprocessing.

`toolcraft` is the consolidation step. You write each operation as one `defineCommand`, group them, and pick which surfaces to expose:

- `runCLI` — argv parsing, `--help`, kebab/snake flags, exit codes.
- `createMCPServer` / `runMCP` — JSON-RPC over stdio with auto-generated tool schemas.
- `createSDK` — typed in-process function calls.

Same handler runs everywhere. Schema, secrets, preconditions, and human-in-loop gating are declared once.

Building from an OpenAPI spec? Use [`toolcraft-openapi`](../toolcraft-openapi/) to generate toolcraft commands from the API contract.

## What the owner decides

Before writing toolcraft code, make a small tool map. For each script or MCP tool, write down:

- **Name** — the generic command path, like `issues.list` or `messages.send`.
- **Inputs** — params, defaults, and which ones should be positional CLI args.
- **Output** — the structured value the handler returns.
- **Secrets** — env vars or credentials the command needs.
- **Side effects** — files, APIs, databases, money, or user-visible changes.
- **Surfaces** — where it should appear: CLI, MCP, SDK, or all three.
- **Safety** — whether it needs approval, auth, or another precondition.

Keep the first migration boring:

1. Wrap existing scripts as thin `defineCommand` handlers.
2. Proxy existing MCP servers with `defineGroup({ mcp })` when you do not want to rewrite them yet.
3. Group commands by domain and put shared secrets or approvals on the group.
4. Add MCP scope only to tools that are safe and useful for agents.
5. Document exposed env vars and config options in the package README.

Once the tool map exists, the rest is mechanical: add commands to `root`, expose the same tree through CLI, MCP, and SDK, and remove old entrypoints when they are no longer needed.

## Install

```sh
npm install toolcraft toolcraft-schema
```

Requires Node 20+.

## Hello world

```ts
// src/commands/greet.ts
import { defineCommand, S } from "toolcraft";

export const greet = defineCommand({
  name: "greet",
  description: "Say hello",
  params: S.Object({
    name: S.String({ description: "Who to greet" }),
    loud: S.Optional(S.Boolean({ default: false }))
  }),
  handler: async ({ params }) => {
    const message = `Hello, ${params.name}`;
    return { message: params.loud ? message.toUpperCase() : message };
  }
});
```

```ts
// src/root.ts
import { defineGroup } from "toolcraft";
import { greet } from "./commands/greet.js";

export const root = defineGroup({
  name: "mytool",
  children: [greet]
});
```

```ts
// src/bin.ts
#!/usr/bin/env node
import { runCLI } from "toolcraft/cli";
import { root } from "./root.js";

await runCLI(root, {
  version: "0.1.0",
  controls: { yes: true, output: true, debug: true, verbose: true }
});
```

```sh
mytool greet --name world
mytool greet --name world --loud
mytool greet --help
```

Generated global CLI controls are opt-in. Pass `controls` to expose `--yes`, `--output`, `--debug`, or `--verbose`; otherwise toolcraft only adds options required by the root, such as `--version` or `--preset` when enabled. Root groups may also use an unnamed default command (`name: ""`) alongside named siblings; help shows its positional arguments without exposing the internal default-command name.

## Project layout

A typical toolcraft project:

```
package.json
src/
  bin.ts                 # one entrypoint, dispatches by argv (see below)
  root.ts                # defineGroup({ children: [...] })
  commands/
    greet.ts             # one defineCommand per file
    deploy.ts
    ...
  groups/
    issues/
      index.ts           # defineGroup, exports a sub-tree
      list.ts
      create.ts
```

`package.json`:

```json
{
  "name": "mytool",
  "type": "module",
  "bin": { "mytool": "./dist/bin.js" },
  "scripts": { "build": "tsc" },
  "dependencies": {
    "toolcraft": "^0.0.1",
    "toolcraft-schema": "^0.0.1"
  }
}
```

`tsconfig.json` needs `"module": "NodeNext"` (or `"ESNext"`) and `"moduleResolution": "NodeNext"`.

## One binary, three runtimes

Most consumers ship one bin and dispatch on the first argv:

```ts
// src/bin.ts
#!/usr/bin/env node
import { runCLI } from "toolcraft/cli";
import { runMCP } from "toolcraft/mcp";
import { root } from "./root.js";

const mode = process.argv[2];

if (mode === "mcp") {
  await runMCP(root, { name: "mytool", version: "0.1.0" });
} else {
  await runCLI(root, {
    version: "0.1.0",
    controls: { yes: true, output: true, debug: true, verbose: true }
  });
}
```

```sh
mytool greet --name world      # CLI
mytool mcp                     # MCP stdio server (Claude Desktop, etc.)
```

The SDK is a separate import for in-process callers — your library code, tests, other packages:

```ts
import { createSDK } from "toolcraft/sdk";
import { root } from "mytool/root";

const sdk = createSDK(root);
const { message } = await sdk.greet({ name: "world", loud: true });
```

The same `root` flows into all three. No duplication.

## Mental model

**Command**: one operation. Has a name, a `params` schema, optional `secrets`, a `handler`. The handler receives `{ params, secrets, fetch, fs, env, progress, ...services }` and returns a value.

**Group**: a folder. Has a name and `children`. Inheritable fields (`secrets`, `requires`, `scope`, `humanInLoop`) cascade to descendants. A group can also proxy an upstream MCP server (see below).

**Scope**: which runtimes a node is exposed on. Per-command default is `["cli", "sdk"]`. Set `scope: ["cli", "mcp", "sdk"]` to also surface as an MCP tool. Inherited from parent group when not set on the child.

**Tree**: the `root` group is a `defineGroup` whose children are commands and sub-groups. Any depth. CLI flags, MCP tool names, and SDK methods are derived from the path.

**CLI help**: group help lists visible child commands with their parameter tokens inline. Required options appear as `--name <type>`, optional options and defaults appear in brackets like `[--limit <number>]`, and positional parameters render as positional tokens like `<name>` or `[name]` depending on whether they are required. Command-specific `--help` still shows the detailed parameter table.

**Parameter schemas**: Toolcraft validates the same `toolcraft-schema` contract across CLI, MCP,
and SDK calls. Complex schema kinds such as `S.Json()`, `S.Record(...)`, discriminated
`S.OneOf(...)`, and object `S.Union(...)` are preserved when a schema is filtered for a specific
runtime scope. Objects declared with `{ additionalProperties: true }` keep unknown keys instead of
rejecting them.

## Secrets

Declare env-backed secrets on a command or group. Toolcraft reads `process.env` at command-run time and passes the values to the handler:

```ts
const deploy = defineCommand({
  name: "deploy",
  params: S.Object({ service: S.String() }),
  secrets: {
    apiKey: { env: "DEPLOY_API_KEY", description: "Required for /deploy endpoint" },
    debugToken: { env: "DEPLOY_DEBUG", optional: true }
  },
  handler: async ({ params, secrets }) => {
    // secrets.apiKey: string
    // secrets.debugToken: string | undefined
  }
});
```

Required secrets that aren't set produce a `UserError` with the env var name and description before the handler runs. Declaring `secrets` on a group cascades them down — a group-level `apiKey` is visible inside every descendant handler with full type inference.

## Preconditions (`requires`)

```ts
defineCommand({
  // ...
  requires: {
    auth: true, // fails if POE_API_KEY (or runner-specified env) is missing
    apiVersion: ">=1.2.0", // fails if runner reports older apiVersion
    check: async (ctx) => ({
      // arbitrary async gate
      ok: ctx.fs.exists("READY") === true,
      message: "READY marker missing, refusing to run"
    })
  }
});
```

Runners pass `{ apiVersion }` to `runCLI` / `runMCP` / `createSDK` to populate the `apiVersion` check. Group-level `requires.check` runs before the child's; both must pass.

## Services (dependency injection)

Inject shared services (DB clients, loggers, fetch wrappers) once at the runtime boundary, get them in every handler:

```ts
type Services = { db: DbClient; logger: Logger };

const root = defineGroup<Services>({ ... });

await runCLI(root, {
  services: { db, logger },
});
```

Inside a handler:

```ts
defineCommand<Services>({
  // ...
  handler: async ({ params, db, logger }) => {
    logger.info("running");
    return db.query(params.id);
  }
});
```

Services are merged into the handler context alongside the built-ins (`fetch`, `fs`, `env`, `progress`).

## Output rendering

Handlers return raw values. Add per-format renderers when you want custom CLI output:

```ts
defineCommand({
  // ...
  handler: async () => ({ rows: [{ id: 1 }, { id: 2 }] }),
  render: {
    rich: (result, { renderTable }) =>
      console.log(renderTable({ rows: result.rows, columns: ["id"] })),
    markdown: (result) => `Found ${result.rows.length} rows`,
    json: (result) => result
  }
});
```

CLI picks `rich` by default, `--json` switches to `json`, and `--output md` switches to Markdown. SDK and MCP always return the raw handler value.

When a command does not define a renderer, Toolcraft auto-renders common shapes:

- `undefined` / `null` → `Done.` for rich and Markdown output, or `{ "ok": true }` for JSON.
- `string` → printed as-is.
- `string[]` → printed one item per line in rich output.
- object records → rich detail cards with scalar fields, nested-object sections, compact URLs, boolean values as `Yes` / `No`, and arrays under a `Lists` section.
- arrays of objects → rich tables with columns inferred from object keys.
- MCP call-tool envelopes → unwrapped from `structuredContent.result`, `structuredContent`, or text content before rendering; `isError: true` writes the rendered payload to stderr and marks the CLI run as failed.

## MCP proxy: adopt an existing MCP server

If you already run an upstream MCP (e.g. `github-mcp-server`) and you want a subset under your tree:

```ts
defineGroup({
  name: "github",
  mcp: {
    transport: "stdio",
    command: "github-mcp-server"
  },
  tools: ["create_issue", "list_issues"],
  rename: {
    create_issue: "issues.create"
  },
  children: []
});
```

- `tools` filters by upstream tool name.
- `rename` remaps to dotted toolcraft paths; missing intermediate groups are created.
- Proxy discovery is eager for `runCLI` and `runMCP`: they resolve every `defineGroup({ mcp })` proxy in the root tree before routing, command execution, or CLI help rendering. SDK proxies resolve when the deferred SDK is awaited or first used.
- On a first run without cached schemas, even `my-cli --help` or `my-cli some-group --help` may connect to every configured upstream MCP server.
- Discovery is cached at `<projectRoot>/.toolcraft/mcp/<group>.json` (project root = nearest ancestor with `package.json`), so successful discovery avoids repeated upstream connects unless refreshed.
- `TOOLCRAFT_MCP_REFRESH=1` refreshes all proxies; `TOOLCRAFT_MCP_REFRESH=github,linear` refreshes specific ones.
- Selective or lazy discovery for only the requested command path is not currently supported. CLIs that wrap many MCP servers should expect first-run help to touch all of them.
- Discovery output goes to stderr only.

## Human-in-loop approvals

Gate destructive commands on a human approval. Configure on the command (or inherit from a group):

```ts
defineGroup({
  name: "deploy",
  humanInLoop: {
    mode: "async",
    message: ({ commandPath, params }) => `Run ${commandPath} for ${params.target}?`
  },
  children: [
    defineCommand({
      name: "prod",
      params: S.Object({ target: S.String() }),
      handler: async ({ params }) => ({ target: params.target })
    }),
    defineCommand({
      name: "preview",
      params: S.Object({ target: S.String() }),
      humanInLoop: null, // opt out
      handler: async ({ params }) => ({ target: params.target })
    })
  ]
});
```

Modes:

- `sync` — handler waits for approval before running.
- `async` — toolcraft enqueues the command, returns a pending marker, and runs it in a fresh process when an operator approves via the reserved `approvals` group.

Wire the same `humanInLoop` options into every entrypoint:

```ts
const humanInLoop = {
  provider: slackApprovalProvider({ channel: "#deploys", client }),
  taskList: { dir: ".toolcraft/approvals.yaml", format: "yaml-file" as const }
};

await runCLI(root, { humanInLoop, approvals: true });
createMCPServer(root, { name: "mytool", version: "0.1.0", humanInLoop, approvals: true });
const sdk = createSDK(root, { humanInLoop, approvals: true });
```

If `provider` is omitted, toolcraft picks a default lazily on first use: `osascriptProvider` on macOS; otherwise a stub that throws `UserError("no human-in-loop provider configured for this platform")`.

A built-in `approvals` group is available when enabled with `approvals: true`:

- `approvals list` — list pending tasks (CLI, MCP, SDK).
- `approvals show --approval-id <id>` — show one task.
- `approvals run --approval-id <id>` — execute one queued task. CLI-only; used by the detached runner.

Approval-management commands are opt-in for `runCLI`, `createMCPServer`/`runMCP`, and `createSDK`. Leave `approvals` unset or set it to `false` to omit the built-in commands while keeping `humanInLoop` execution behavior available for commands that request approval.

The name `approvals` is reserved when the built-in group is enabled. Defining your own `approvals` group fails at startup.

The async runner re-execs your binary (`process.execPath` + `process.argv[1]` by default; override via `humanInLoop.binPath`). Re-exec calls the same toolcraft entrypoint with the same `humanInLoop` options — do not branch on `argv` before calling `runCLI`/`runMCP`/`createSDK`.

Async results must be JSON-serializable; non-serializable returns mark the approval as failed instead of being persisted.

A minimal Slack-style provider:

```ts
import type {
  ApprovalRequest,
  ApprovalResult,
  HumanInLoopProvider
} from "@poe-code/agent-human-in-loop";

export function slackApprovalProvider(opts: {
  channel: string;
  client: {
    postApprovalMessage(channel: string, message: string): Promise<string>;
    waitForButtonClick(ts: string): Promise<{ action: "approve" | "decline"; userId: string }>;
    openModal(userId: string, prompt: string): Promise<string | undefined>;
  };
}): HumanInLoopProvider {
  return {
    id: "slack-approval",
    async requestApproval(request: ApprovalRequest): Promise<ApprovalResult> {
      const ts = await opts.client.postApprovalMessage(opts.channel, request.message);
      const click = await opts.client.waitForButtonClick(ts);

      if (click.action === "approve") {
        return { outcome: "approved" };
      }

      if (request.declineInputPrompt) {
        const reason = await opts.client.openModal(click.userId, request.declineInputPrompt);
        return reason ? { outcome: "declined", reason } : { outcome: "declined" };
      }

      return { outcome: "declined" };
    }
  };
}
```

## Errors

Throw `UserError` for expected, user-facing failures. The CLI prints the message without a stack trace and sets exit code 1; MCP and SDK surface the message as the error body. Usage mistakes include a pointer to the relevant command help. Any other thrown error is treated as unexpected and shows a trimmed stack with `--debug`; use `--debug=raw` to include framework and runtime frames.

HTTP-style errors with request/response context print the request, status, and a response-body snippet by default. `--verbose` or `--debug` prints headers and the full request/response bodies, with authorization headers redacted.

Enable structured error reports with `errorReports: true`, `errorReports: { dir }`, or `TOOLCRAFT_ERROR_REPORTS=1`. Reports are written under `.toolcraft/errors` by default, include argv, parsed params, resolved secret presence, structured error fields, stack/cause chains, and HTTP transcripts, and redact declared secrets plus parameter names that look sensitive.

## Migrating from a folder of scripts

Pattern for adopting toolcraft incrementally:

1. Pick one script. Wrap its logic in `defineCommand`. Keep the existing imports, `fetch` calls, file I/O — they all work inside a handler.
2. Move env-var reads to `secrets`. Replace `process.env.X` access in the script body with `secrets.x` from the handler context.
3. Add the command to a `defineGroup`. Repeat. The tree grows file by file.
4. When you're ready, point your `bin` at `runCLI` and delete the per-script entry points. The script files become handler implementations imported by `defineCommand`s.
5. To expose to an MCP client, set `scope: ["cli", "mcp", "sdk"]` on the command and add the `runMCP` branch to the bin. No code changes needed inside handlers.
6. To expose to other JS code, `import { createSDK }` from your package and call methods directly.

If you have an existing MCP server you want to keep running, use the MCP proxy: a `defineGroup` with an `mcp` field pulls its tools into your tree without rewriting them.

## Environment variables

- `TOOLCRAFT_MCP_REFRESH` — MCP proxy cache refresh (`unset` = use cache, `1`/`true` = refresh all, comma-separated names = refresh those).
- `TOOLCRAFT_ERROR_REPORTS=1` — enables structured error report files for CLI, MCP, and SDK surfaces that wire `errorReports`.
- Per-command `secrets` declarations name additional env vars. They are read at command run time and passed to the handler.

## API reference

### `defineCommand(config)`

- `name: string`
- `description?: string`
- `aliases?: string[]`
- `positional?: string[]` — parameter names mapped from CLI argv order.
- `params: S.Object(...)` — input schema from `toolcraft-schema`.
- `secrets?: Record<string, { env: string; description?: string; optional?: boolean }>`
- `scope?: Array<"cli" | "mcp" | "sdk">` — defaults to `["cli", "sdk"]`.
- `confirm?: boolean` — deprecated CLI-only TTY confirmation; use `humanInLoop` instead. Cannot be combined with `humanInLoop`.
- `humanInLoop?: { mode: "sync" | "async"; message: ({ params, commandPath }) => string; declineInputPrompt?: string } | null`
- `requires?: { auth?: boolean; apiVersion?: string; check?: (ctx) => Promise<{ ok: boolean; message?: string }> }`
- `handler: (ctx) => Promise<unknown>`
- `render?: { rich?, markdown?, json? }` — per-format output renderers.

### `defineGroup(config)`

- `name: string`
- `description?: string`
- `aliases?: string[]`
- `mcp?: McpServerConfig` — proxy an upstream MCP server; uses the standard `@poe-code/agent-mcp-config` shape.
- `tools?: string[]` — proxy allowlist by upstream tool name.
- `rename?: Record<string, string>` — proxy upstream → dotted toolcraft path.
- `scope?` / `humanInLoop?` / `secrets?` / `requires?` — inherited by descendants that don't override. Set `humanInLoop: null` on a child to opt out.
- `children: Array<Command | Group>`
- `default?: Command` — invoked when no child token matches.

### `runCLI(root, options)`

- `casing?: "kebab" | "snake"` — generated CLI flag style.
- `services?: TServices` — merged into every handler context.
- `version?: string` — surfaced via `--version`.
- `presets?: boolean` — enables `--preset <path>` for loading parameter defaults from JSON files.
- `apiVersion?: string` — for `requires.apiVersion`.
- `humanInLoop?: HumanInLoopRuntimeOptions`
- `approvals?: boolean` — set to `true` to add built-in approval-management commands.
- `controls?: { yes?: boolean; output?: boolean; debug?: boolean; verbose?: boolean }` — opt in to generated global CLI controls.
- `errorReports?: boolean | { dir?: string }`
- `projectRoot?: string` — root used for MCP proxy cache files (`.toolcraft/mcp/*.json`).

### `createSDK(root, options)`

- `casing?: "camel"` — generated SDK member style.
- `services?` / `humanInLoop?` / `apiVersion?` / `approvals?` / `errorReports?`
- `projectRoot?: string` — root used for MCP proxy cache files (`.toolcraft/mcp/*.json`).

### `createMCPServer(root, options)` / `runMCP(root, options)`

- `name: string`
- `version: string`
- `services?` / `humanInLoop?` / `apiVersion?` / `approvals?` / `errorReports?`
- `projectRoot?: string` — root used for MCP proxy cache files (`.toolcraft/mcp/*.json`).
- `tools?: string[]` — allowlist of MCP tool names or group prefixes. Tool names are `__`-joined snake_case path segments (`root__bot__create`); a prefix like `root__bot` includes every descendant tool.
- `omitRootToolNamePrefix?: boolean` — defaults to `false`. Set to `true` to omit the root group name from single-root MCP tool names (`bot__create`).
- `casing?: "snake" | "camel"` — affects MCP **input-schema property names** only. Tool names always stay `__`-joined snake_case.

### `HumanInLoopRuntimeOptions`

```ts
type HumanInLoopRuntimeOptions = {
  provider?: HumanInLoopProvider;
  taskList?: TaskList | { dir: string; format: "markdown-dir" | "yaml-file" };
  listName?: string; // defaults to "approvals"
  binPath?: { execPath: string; entryArgs: readonly string[] };
};
```

### Handler context

- `params` — inferred from the command `params` schema.
- `secrets` — inferred from the command `secrets` declaration.
- `fetch: typeof globalThis.fetch`
- `fs: { readFile, writeFile, exists }`
- `env: { get(key: string): string | undefined }`
- `progress(message: string): void`
- All `services` keys merged in.

### Exports

- `defineCommand`, `defineGroup`
- `S`, `toJsonSchema`, type helpers — re-exported from `toolcraft-schema`
- `UserError`, `ApprovalDeclinedError`
- Type exports: `Command`, `Group`, `Scope`, `HandlerContext`, `HumanInLoopConfig`, `HumanInLoopPending`, `HumanInLoopRuntimeOptions`, schema types from `toolcraft-schema`.

Subpath imports:

- `toolcraft/cli` — `runCLI`
- `toolcraft/sdk` — `createSDK`
- `toolcraft/mcp` — `runMCP`, `createMCPServer`
- `toolcraft/human-in-loop` — provider helpers
- `toolcraft/mcp-proxy` — proxy internals
- `toolcraft/design` — bundled terminal design-system exports
