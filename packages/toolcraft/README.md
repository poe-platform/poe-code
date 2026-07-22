# toolcraft

Create tools for both agents and humans.

Define a command once. Get a typed CLI, an MCP server, and a typed SDK from the same source. Built on `toolcraft-schema`.

## Why

You have one-off scripts and MCP servers. Each one re-derives argument parsing, env handling, and help text. Running them from a chatbot needs another adapter. Calling them from another script means subprocessing.

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

Keep the first migration direct:

1. Wrap existing scripts as thin `defineCommand` handlers.
2. Proxy existing MCP servers with `defineGroup({ mcp })` when you do not want to rewrite them yet.
3. Group commands by domain and put shared secrets or approvals on the group.
4. Add MCP scope only to tools that are safe and useful for agents.
5. Document exposed env vars and config options in the package README.

After the tool map exists, add commands to `root`, expose the same tree through CLI, MCP, and SDK, and remove old entrypoints when they are no longer needed.

## Install

```sh
npm install toolcraft
```

`toolcraft-schema` is a dependency and its `S` builders are re-exported from `toolcraft`. Requires Node 20+.

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
  result: S.Object({
    message: S.String()
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

await runCLI(root, { version: "0.1.0" });
```

```sh
mytool greet --name world
mytool greet --name world --loud
mytool greet --help
```

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
  await runCLI(root, { version: "0.1.0" });
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

**Examples**: commands may declare `examples: Array<{ title, params }>` alongside their params.
CLI help renders an `Examples` section for the command, and MCP tool descriptions include the
same examples so agents see concrete argument shapes.

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

## Testing commands

Use `createCommandTestHarness` to exercise the same command pipeline as the SDK without assembling a handler context by hand:

```ts
import { expect, it } from "vitest";
import { createCommandTestHarness, fakeService } from "toolcraft/testing";
import { root } from "./root.js";

it("creates a deployment", async () => {
  const deployments = fakeService({
    create: async (name: string) => ({ id: "dep-1", name })
  });
  const harness = createCommandTestHarness(root, {
    services: { deployments },
    env: { HOME: "/test/home" },
    secrets: { apiKey: "test-token" },
    fs: { "/test/input.json": "{}" },
    fetch: [{ method: "POST", url: "https://api.example.com/deployments", json: { ok: true } }],
    confirmations: "approve",
    apiVersion: "1.2.0",
    logLevel: "debug"
  });

  const result = await harness.run<{ id: string }>(["deploy", "create"], {
    name: "production"
  });

  expect(result).toMatchObject({ ok: true, value: { id: "dep-1" } });
});
```

Harness options provide injected `services`, an explicit `env`, named `secrets`, an initial file map or `HandlerFs`, a fetch implementation or `fakeFetch` routes, confirmation behavior (`"approve"`, `"decline"`, or a callback), `apiVersion`, and `logLevel`. `fakeService`, `fakeFetch`, and `createMemoryFs` are also exported for standalone tests.

Each `run()` returns a `RunResult` instead of throwing. Assert `ok`, `value`, or `error`, and use `failedAt` to identify the pipeline stage: `resolve`, `secrets`, `requirements`, `params`, `confirm`, `handler`, or `render`. The result also captures `pending`, diagnostic `logs`, `progress`, `confirmations`, the ordered effect `timeline`, `fsChanges`, and rendered rich, Markdown, and JSON output. Pre-handler validation can therefore be asserted directly:

```ts
const result = await harness.run(["deploy", "create"], { name: 42 });

expect(result.ok).toBe(false);
expect(result.failedAt).toBe("params");
expect(result.timeline).toEqual([]);
expect(deployments.calls).toEqual([]);
```

The harness is hermetic by default: it never falls back to `process.env`, starts with an in-memory filesystem, blocks unmatched network requests, records injected service and effect calls, and uses deterministic timestamp-free pending approval data. Provide every external input through the harness options.

Use `parity()` when a command must behave identically through the real SDK, MCP, and CLI adapters:

```ts
const parity = await harness.parity(["deploy", "create"], { name: "production" });

expect(parity.agree, parity.diff).toBe(true);
expect(parity.sdk.value).toEqual(parity.mcp.value);
expect(parity.mcp.value).toEqual(parity.cli.value);
```

## Output rendering

Handlers return raw values. Add `result:` when a command returns structured data and may be exposed over MCP; Toolcraft turns that schema into MCP `outputSchema`, validates the returned object, returns it as `structuredContent`, and keeps a JSON text backstop for older MCP clients.

Add per-format renderers when you want richer CLI output:

```ts
defineCommand({
  // ...
  result: S.Object({
    rows: S.Array(S.Object({ id: S.Number() }))
  }),
  handler: async () => ({ rows: [{ id: 1 }, { id: 2 }] }),
  render: {
    rich: (result, { renderTable }) =>
      console.log(renderTable({ rows: result.rows, columns: ["id"] })),
    markdown: (result) => `Found ${result.rows.length} rows`,
    json: (result) => result
  }
});
```

MCP assumes an unannotated tool may mutate data destructively, is not safe to retry, and can
interact with an open world. Declare the standard hints on each MCP command so clients can present
the operation accurately:

```ts
defineCommand({
  name: "inspect",
  title: "Inspect deployment",
  description: "Inspect a deployment without changing it.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  },
  scope: ["mcp"],
  params: S.Object({ deploymentId: S.String() }),
  result: S.Object({ status: S.String() }),
  handler: async ({ params }) => inspectDeployment(params.deploymentId)
});
```

## HTTP errors

Toolcraft exports a fixed HTTP error hierarchy for transports and generated API clients:

- `HttpError`
- `ClientError`
- `BadRequestError`
- `AuthenticationError`
- `PermissionDeniedError`
- `NotFoundError`
- `ConflictError`
- `UnprocessableEntityError`
- `RateLimitError`
- `ServerError`
- `InternalServerError`
- `ServiceUnavailableError`

Each error carries `status`, optional `code`, optional `requestId`, and serializable `request` and
`response` context.

CLI picks `rich` by default. Enable the generated output selector when starting the CLI:

```ts
await runCLI(root, { controls: { output: true } });
```

Then choose structured output with `mytool command --output json`. The selector also accepts `rich`,
`md`, and `markdown`. SDK calls return the raw handler value. MCP calls with `result:` return the
handler value as `structuredContent` using the configured MCP casing; MCP calls without `result:`
keep content-block behavior.

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

The runtime never ships with the core entrypoints — it loads only through the `toolcraft/human-in-loop` export, and providers are surfaced from the same export. Wire the same runtime into every entrypoint:

```ts
import { createHumanInLoop, osascriptProvider } from "toolcraft/human-in-loop";

const humanInLoop = createHumanInLoop({
  provider: osascriptProvider({ title: "Approval needed" }), // required
  taskList: { dir: ".toolcraft/approvals.yaml", format: "yaml-file" as const }
});

await runCLI(root, { humanInLoop, approvals: true });
createMCPServer(root, { name: "mytool", version: "0.1.0", humanInLoop, approvals: true });
const sdk = createSDK(root, { humanInLoop, approvals: true });
```

`provider` is required — there is no implicit platform default. `defaultProviderForPlatform()` (osascript on macOS, a throwing stub elsewhere) is exported for callers that want that behavior explicitly. A command that declares `humanInLoop` config while no runtime is wired fails at startup, as does `approvals: true` without a runtime.

With `approvals: true`, the built-in `approvals` group is merged into the root:

- `approvals list` — list pending tasks (CLI, MCP, SDK).
- `approvals show --approval-id <id>` — show one task.
- `approvals run --approval-id <id>` — execute one queued task. CLI-only; used by the detached runner.

The name `approvals` is reserved. Defining your own `approvals` group fails at startup.

The async runner re-execs your binary (`process.execPath` + `process.argv[1]` by default; override via the `binPath` option of `createHumanInLoop`). Re-exec calls the same toolcraft entrypoint with the same wired runtime — do not branch on `argv` before calling `runCLI`/`runMCP`/`createSDK`.

Async results must be JSON-serializable; non-serializable returns mark the approval as failed instead of being persisted.

A minimal Slack-style provider:

```ts
import type {
  ApprovalRequest,
  ApprovalResult,
  HumanInLoopProvider
} from "toolcraft/human-in-loop";

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

## Standalone Bundles

Toolcraft supports standalone ESM CLI bundles built with esbuild `0.28.1`. The release workflow builds and starts the same recipe on Node.js `18.18.0`, `20`, `22`, and `24`. Use `node18` as the compilation target so one artifact runs across those supported runtimes.

Install the supported bundler with `npm install --save-dev esbuild@0.28.1`.

```js
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  splitting: false,
  sourcemap: "external",
  sourcesContent: true
});
```

Import the command definitions from `toolcraft` and the CLI runner from `toolcraft/cli`. A command tree that does not configure MCP proxies, process runners, or human-in-loop gates leaves those optional integrations out of the bundle.

esbuild records dependency paths relative to the build layout. A standalone install can produce `node_modules/toolcraft/...`, while a hoisted workspace can produce `../../node_modules/toolcraft/...` in module-label comments and source-map `sources`. For layout-independent artifacts, canonicalize every dependency path by keeping the substring from the first `node_modules/` segment onward. Parse the source map as JSON and apply the same operation to each string in `sources`; do not modify application source paths. Serialize the map, then hash or publish the canonical bundle and map.

## Environment Variables

- `TOOLCRAFT_MCP_REFRESH` — MCP proxy cache refresh (`unset` = use cache, `1`/`true` = refresh all, comma-separated names = refresh those).
- `TOOLCRAFT_ERROR_REPORTS=1` — enables structured error report files for CLI, MCP, and SDK surfaces that wire `errorReports`.
- Per-command `secrets` declarations name additional env vars. They are read at command run time and passed to the handler.

## Configuration Options

Toolcraft configuration is code-first. Use `defineCommand(config)` and `defineGroup(config)` for the command tree, then pass runtime options to `runCLI`, `createSDK`, `createMCPServer`, or `runMCP`. MCP proxy schemas are cached under `.toolcraft/mcp`, and human-in-loop approvals are wired explicitly with `createHumanInLoop` from `toolcraft/human-in-loop`.

## API reference

### `defineCommand(config)`

- `name: string`
- `title?: string` — human-readable MCP display name.
- `description?: string`
- `annotations?: { title?; readOnlyHint?; destructiveHint?; idempotentHint?; openWorldHint? }` — standard MCP behavior hints passed through unchanged.
- `aliases?: string[]`
- `positional?: string[]` — parameter names mapped from CLI argv order.
- `params: S.Object(...)` — input schema from `toolcraft-schema`.
- `result?: S.Object(...)` — structured result schema for MCP `outputSchema`; must be a root object.
- `secrets?: Record<string, { env: string; description?: string; optional?: boolean }>`
- `scope?: Array<"cli" | "mcp" | "sdk">` — defaults to `["cli", "sdk"]`.
- `confirm?: boolean` — deprecated CLI-only TTY confirmation; use `humanInLoop` instead. Cannot be combined with `humanInLoop`.
- `humanInLoop?: { mode: "sync" | "async"; message: ({ params, commandPath }) => string; declineInputPrompt?: string } | null`
- `requires?: { auth?: boolean; apiVersion?: string; check?: (ctx) => Promise<{ ok: boolean; message?: string }> }`
- `handler: (ctx) => Promise<unknown>`
- `render?: { rich?, markdown?, json? }` — per-format output renderers.

Parameter schemas may set `short: "x"` for a short CLI flag and `cliAliases: ["alias"]` for
additional long CLI flags. For example, `rawResponse` normally maps to `--raw-response`; adding
`cliAliases: ["raw"]` also accepts `--raw` while the SDK parameter remains `rawResponse`.

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
- `controls?: { debug?, logLevel?, output?, verbose?, yes? }` — enables generated global CLI controls. Set `output: true` to expose `--output <rich|md|markdown|json>`.
- `apiVersion?: string` — for `requires.apiVersion`.
- `humanInLoop?: HumanInLoopRuntime` — from `createHumanInLoop` (`toolcraft/human-in-loop`); required for commands with `humanInLoop` config.
- `approvals?: boolean` — merge the built-in `approvals` group; requires `humanInLoop`.
- `errorReports?: boolean | { dir?: string }`
- `projectRoot?: string` — root used for MCP proxy cache files (`.toolcraft/mcp/*.json`).

### `createSDK(root, options)`

- `casing?: "camel"` — generated SDK member style.
- `services?` / `humanInLoop?` / `apiVersion?` / `errorReports?`
- `projectRoot?: string` — root used for MCP proxy cache files (`.toolcraft/mcp/*.json`).

### `createMCPServer(root, options)` / `runMCP(root, options)`

- `name: string`
- `version: string`
- `services?` / `humanInLoop?` / `apiVersion?` / `errorReports?`
- `projectRoot?: string` — root used for MCP proxy cache files (`.toolcraft/mcp/*.json`).
- `tools?: string[]` — allowlist of MCP tool names or group prefixes. Tool names are `__`-joined snake_case path segments (`root__bot__create`); a prefix like `root__bot` includes every descendant tool.
- `omitRootToolNamePrefix?: boolean` — defaults to `false`. Set to `true` to omit the root group name from single-root MCP tool names (`bot__create`).
- `casing?: "snake" | "camel"` — affects MCP input-schema property names, output-schema property names, and structured result keys. Tool names always stay `__`-joined snake_case.

### `createHumanInLoop(options)` (from `toolcraft/human-in-loop`)

```ts
import { createHumanInLoop, defaultProviderForPlatform, osascriptProvider } from "toolcraft/human-in-loop";

type HumanInLoopRuntimeOptions = {
  provider: HumanInLoopProvider; // required
  taskList?: TaskList | { dir: string; format: "markdown-dir" | "yaml-file" };
  listName?: string; // defaults to "approvals"
  binPath?: { execPath: string; entryArgs: readonly string[] };
};
```

Returns the `HumanInLoopRuntime` accepted by `runCLI` / `createMCPServer` / `createSDK`.

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
- `UserError`, `ApprovalDeclinedError`, `HttpError` and the HTTP error subclasses.
- Type exports: `Command`, `Group`, `Scope`, `HandlerContext`, `HumanInLoopConfig`, `HumanInLoopPending`, `HumanInLoopRuntime`, schema types from `toolcraft-schema`.

Subpath imports:

- `toolcraft/cli` — `runCLI`
- `toolcraft/sdk` — `createSDK`
- `toolcraft/mcp` — `runMCP`, `createMCPServer`
- `toolcraft/human-in-loop` — provider helpers
- `toolcraft/mcp-proxy` — proxy internals

## Manual QA

Use these package-local walkthroughs after behavior changes:

- [Help output](QA-help-output.md)
- [Error UX](QA-error-ux.md)
- [Human-in-loop](QA-human-in-loop.md)
- [MCP proxy](QA-mcp-proxy.md)
