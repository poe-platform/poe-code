# @poe-code/agent-spawn

`@poe-code/agent-spawn` contains the low-level spawn adapters used by the CLI and SDK to run supported coding agents, stream ACP-like events, pass model and permission-mode flags, inject MCP servers at spawn time, and resume prior sessions when an agent returns a thread/session ID.

Cursor spawns use the authenticated `cursor-agent` installation and the user's Cursor account. No environment variables are injected. Supported modes map to Cursor's forced sandbox-disabled, forced edit, and plan/read-only modes.

## Usage

```ts
import { spawn, spawnAutonomous, listMcpSupportedAgents } from "@poe-code/agent-spawn";

const result = await spawn("codex", {
  prompt: "Fix the failing tests",
  cwd: process.cwd(),
  mode: "edit",
  model: "openai/gpt-5.5",
  env: { WORKSPACE_ID: "workspace-1" },
  mcpServers: {
    fs: { command: "node", args: ["./mcp/fs.js"], timeout: 30 }
  }
});

console.log(result.exitCode, result.stdout);
console.log(listMcpSupportedAgents());
```

## Spawn modes

| Mode   | Purpose                                                                          |
| ------ | -------------------------------------------------------------------------------- |
| `yolo` | Full automation for trusted tasks.                                               |
| `auto` | The agent's native auto permission mode: safe actions approved, unsafe rejected. |
| `edit` | File-editing mode when the agent supports scoped permissions.                    |
| `read` | Read-only/research mode when the agent supports it.                              |

Mode-specific args and env vars are declared in each agent config. `auto` is optional per config: agents without a native auto/approval mode omit it, and requesting it fails before launch with the supported-mode list (`supportsSpawnMode(agentId, mode)` exposes the same check for static validation). Over ACP, auto mode answers `session/request_permission` with an explicit rejection so the agent adapts instead of ending the turn. Goose uses `GOOSE_MODE` internally for mode selection; callers do not need to set it manually.

## MCP at spawn time

Pass `mcpServers` as a map of server names to `{ command, args?, env?, timeout? }`. The package serializes that declarative config into agent-specific CLI arguments, environment variables, or a temporary workspace config file. `listMcpSupportedAgents()` reports the current agents with spawn-time MCP support.

## Resuming sessions

Pass `resumeThreadId` to continue a prior provider thread/session. Declarative agent configs decide where the resume arguments are inserted and how user-facing resume hints are rendered. Claude Code, Codex, Cursor, OpenCode, Kimi, Goose, and Poe Agent have resume mappings; Poe Agent persists its local message history under `~/.poe-code/sessions/`.

## Autonomous streaming

`spawnAutonomous(streamSpawn, options)` drives a streaming ACP spawn to completion, renders events through the design-system ACP writer, and retries activity timeouts. It is shared by SDK autonomous spawn flows and loop runners.

## ACP middlewares

Pass `middlewares` to `spawnStreaming` or `spawnAcp` to wrap the ACP session lifecycle. A middleware receives a mutable `SpawnContext` with session id, agent id, prompt/model/mode/cwd, accumulated events, usage, optional event stream, and any log file selected by the middleware. Middlewares must call `next()` at most once.

```ts
import { spawnStreaming, type AcpMiddleware } from "@poe-code/agent-spawn";

const telemetry: AcpMiddleware = async (ctx, next) => {
  await next();
  console.log(ctx.agent, ctx.threadId, ctx.usage);
};

const run = spawnStreaming({ agentId: "codex", prompt: "Summarize", middlewares: [telemetry] });
await run.done;
```

## Testing helper

The `./testing` export provides a Vitest helper for code that depends on `spawn`:

```ts
import { createSpawnMock } from "@poe-code/agent-spawn/testing";

const spawnMock = createSpawnMock({
  spawnResult: { stdout: "ok" },
  autonomousResult: { text: "done" }
});

vi.mock("@poe-code/agent-spawn", spawnMock.factory);
```

`createSpawnMock()` requires Vitest globals and exposes both `spawnMock.spawn` and `spawnMock.autonomous` for assertions.

## Config options

| Option                               | Type                                   | Description                                                                                  |
| ------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `prompt`                             | `string`                               | Prompt sent to the agent.                                                                    |
| `cwd`                                | `string`                               | Working directory. Defaults to the caller's process cwd.                                     |
| `model`                              | `string`                               | Optional model override. Provider prefixes are stripped or preserved per agent config.       |
| `mode`                               | `"yolo" \| "auto" \| "edit" \| "read"` | Permission mode. Defaults are chosen by the caller.                                          |
| `args`                               | `string[]`                             | Extra args forwarded to the agent process.                                                   |
| `mcpServers`                         | `Record<string, McpSpawnServer>`       | MCP servers injected into the spawned agent.                                                 |
| `resumeThreadId`                     | `string`                               | Provider thread/session id to resume.                                                        |
| `env`                                | `Record<string, string>`               | Per-invocation child environment overrides. Caller values take precedence.                   |
| `middlewares`                        | `AcpMiddleware[]`                      | Wrap `spawnStreaming`/`spawnAcp` execution for telemetry, logging, or post-processing.       |
| `captureOtel`                        | `boolean`                              | Capture native agent OTLP/HTTP JSON on host-runtime spawns.                                  |
| `captureOtelContent`                 | `boolean`                              | Opt in to native prompt/tool content capture.                                                |
| `useStdin`                           | `boolean`                              | Send the prompt through stdin when the agent supports it.                                    |
| `interactive`                        | `boolean`                              | Spawn the agent in interactive TUI mode.                                                     |
| `activityTimeoutMs`                  | `number`                               | Kill/retry inactive streaming processes after this many milliseconds.                        |
| `logPath` / `logDir` / `logFileName` | `string`                               | Persist spawn logs. `logPath` takes precedence. Message/tool content is redacted by default. |
| `logContent`                         | `boolean`                              | Include message text, reasoning, tool input, and tool output/path in ACP JSONL logs.         |

Native capture sets a per-spawn `poe.code.spawn.id` resource attribute and stores captured OTLP records plus the correlation id in the backend-neutral ACP trace metadata. Unsupported agents and non-host runtimes warn and continue. Environment equivalents are `POE_CODE_CAPTURE_OTEL=1` and `POE_CODE_CAPTURE_OTEL_CONTENT=1`.

## Environment variables

This package does not expose public environment variables. It inherits `process.env` for child processes and may add agent-specific env overrides from declarative spawn config, such as `GOOSE_MODE` for Goose modes, `GOOSE_DISABLE_KEYRING=1` for Goose file-backed credentials, or `OPENCODE_CONFIG_CONTENT` for OpenCode MCP injection. Per-invocation `env` values override inherited and agent-specific values without mutating `process.env`.
