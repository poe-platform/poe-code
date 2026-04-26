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
- `defineGroup(config)` creates a command group and inherits `secrets`, `requires`, `scope`, and `humanInLoop` through descendants.
- `UserError` marks expected user-facing failures.
- `runCLI(root, options)` runs the CLI for the given command tree.
- `createSDK(root, options)` builds the typed SDK surface for `sdk`-scoped commands.
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
- `confirm?: boolean`: deprecated CLI-only TTY confirmation. Use `humanInLoop` instead. Defaults to `false`. `confirm: true` cannot be combined with `humanInLoop`.
- `humanInLoop?: { mode: "sync" | "async"; message: ({ params, commandPath }) => string; declineInputPrompt?: string } | null`: gate the command on human approval.
- `requires?: { auth?: boolean; apiVersion?: string; check?: (ctx) => Promise<{ ok: boolean; message?: string }> }`: command preconditions.
- `handler: (ctx) => Promise<unknown>`: async command implementation.
- `render?: { rich?: (result, primitives) => void; markdown?: (result) => string; json?: (result) => unknown }`: optional output renderers.

### `defineGroup(config)`

- `name: string`: group name.
- `description?: string`: help text for the group.
- `aliases?: string[]`: alternate group names.
- `mcp?: McpServerConfig`: optional upstream MCP server config used to discover and proxy tools into this group.
- `scope?: Array<"cli" | "mcp" | "sdk">`: inherited by descendants that do not override it.
- `humanInLoop?: { mode: "sync" | "async"; message: ({ params, commandPath }) => string; declineInputPrompt?: string } | null`: inherited by descendants that do not override it. Set `humanInLoop: null` on a child command or group to opt out.
- `secrets?: Record<string, { env: string; description?: string; optional?: boolean }>`: inherited secret declarations.
- `tools?: string[]`: optional allowlist of upstream MCP tool names to expose from this proxy group.
- `rename?: Record<string, string>`: optional map from upstream tool names to dotted toolcraft command paths.
- `requires?: { auth?: boolean; apiVersion?: string; check?: (ctx) => Promise<{ ok: boolean; message?: string }> }`: inherited preconditions.
- `children: Array<Command | Group>`: nested commands and groups.
- `default?: Command`: default child command used by runners when no child token matches.

### `runCLI(root, options)`

- `casing?: "kebab" | "snake"`: changes generated CLI flag names.
- `services?: TServices`: extra services merged into the handler context.
- `version?: string`: CLI version shown by `--version`.
- `humanInLoop?: HumanInLoopRuntimeOptions`: human-in-loop runtime wiring shared with the SDK and MCP entry-points.

### `createSDK(root, options)`

- `casing?: "camel"`: changes generated SDK member names.
- `services?: TServices`: extra services merged into the handler context.
- `humanInLoop?: HumanInLoopRuntimeOptions`: human-in-loop runtime wiring shared with the CLI and MCP entry-points.

### `createMCPServer(root, options)` / `runMCP(root, options)`

- `name: string`: MCP server name.
- `version: string`: MCP server version.
- `services?: TServices`: extra services merged into the handler context.
- `humanInLoop?: HumanInLoopRuntimeOptions`: human-in-loop runtime wiring shared with the CLI and SDK entry-points.
- `tools?: string[]`: optional allowlist of MCP tool names or group prefixes. Tool names use `__`-joined snake_case path segments like `root__bot__create`; passing `root__bot` includes every descendant tool in that subtree.
- `casing?: "snake" | "camel"`: changes MCP input-schema property names and accepted argument keys only. It does **not** change MCP tool names, which always stay `__`-joined snake_case.

## Human In Loop

`humanInLoop` can be declared on commands and groups. Group values inherit through descendants; a child can override with its own config or opt out explicitly with `humanInLoop: null`.

```ts
const deploy = defineGroup({
  name: "deploy",
  humanInLoop: {
    mode: "async",
    message: ({ commandPath, params }) => `Run ${commandPath} for ${params.target}?`,
  },
  children: [
    defineCommand({
      name: "prod",
      params: S.Object({ target: S.String() }),
      handler: async ({ params }) => ({ target: params.target }),
    }),
    defineCommand({
      name: "preview",
      params: S.Object({ target: S.String() }),
      humanInLoop: null,
      handler: async ({ params }) => ({ target: params.target }),
    }),
  ],
});
```

All three runtime entry-points accept the same `HumanInLoopRuntimeOptions` shape via `options.humanInLoop`:

```ts
type HumanInLoopRuntimeOptions = {
  provider?: HumanInLoopProvider;
  taskList?:
    | TaskList
    | {
        dir: string;
        format: "markdown-dir" | "yaml-file";
      };
  listName?: string;
  binPath?: {
    execPath: string;
    entryArgs: readonly string[];
  };
};
```

- `provider`: the approval UI implementation.
- `taskList`: required for async commands. Pass either an already-open `TaskList` or a `{ dir, format }` config and toolcraft will open it with `approvalStateMachine`.
- `listName`: task-list name used for approvals. Defaults to `"approvals"`.
- `binPath`: override the process used for async re-exec. Use this when the host entrypoint is not simply `process.execPath` plus `process.argv[1]`.

If `provider` is omitted, toolcraft resolves a default lazily on first human-in-loop use:

- `process.platform === "darwin"`: `osascriptProvider({ title: "Approval needed" })`
- other platforms: a built-in provider that throws `UserError("no human-in-loop provider configured for this platform — pass humanInLoop.provider to the runtime")`

Async human-in-loop commands enqueue work and return a pending marker immediately. Toolcraft also installs a built-in reserved `approvals` group:

- `approvals list`: list approval tasks. Available in CLI, MCP, and SDK.
- `approvals show --approval-id <id>`: show one approval task. Available in CLI, MCP, and SDK.
- `approvals run --approval-id <id>`: execute one queued approval. CLI-only; used by the detached runner.

`approvals` is reserved for these built-ins. A user-defined `approvals` group causes startup to fail with `Error: 'approvals' is reserved for human-in-loop built-ins`.

The host binary must call `runCLI`, `createMCPServer`, or `createSDK` with the same `humanInLoop` options whether it is invoked normally or re-entered as `approvals run <id>`. Do not branch on `argv` before calling the toolcraft entry-point; the detached runner depends on the same provider, task-list, and `binPath` wiring on re-exec.

In async mode the queued command runs in a fresh process. That runner re-resolves `secrets` from the command definition against that process's `process.env`, and the stored result must be JSON-serializable because it is written into approval metadata. Non-serializable async results mark the approval as failed instead of storing the value.

Provider implementations use `HumanInLoopProvider` from `@poe-code/agent-human-in-loop` directly. A minimal Slack-style provider looks like this:

```ts
import type { ApprovalRequest, ApprovalResult, HumanInLoopProvider } from "@poe-code/agent-human-in-loop";

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
    },
  };
}
```

Wire that provider the same way on every entry-point:

```ts
const humanInLoop = {
  provider: slackApprovalProvider({ channel: "#deploys", client }),
  taskList: { dir: ".toolcraft/approvals.yaml", format: "yaml-file" as const },
};

await runCLI(root, { humanInLoop });
createMCPServer(root, { name: "my-server", version: "1.0.0", humanInLoop });
const sdk = createSDK(root, { humanInLoop });
```

### Handler context

- `params`: inferred from the command `params` schema.
- `secrets`: inferred from the command `secrets` declaration.
- `fetch`: `typeof globalThis.fetch`.
- `fs`: `{ readFile, writeFile, exists }`.
- `env`: `{ get(key: string): string | undefined }`.
- `progress(message: string): void`.
- Custom runner services are merged into the same context object.
