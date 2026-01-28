# Unified Spawn via ACP Implementation Plan

## Related Plans

- [spawn-modes-plan.md](./spawn-modes-plan.md) - Execution modes (yolo, edit, read)
- [spawn-mcp-plan.md](./spawn-mcp-plan.md) - MCP server configuration
- [spawn-interactive-plan.md](./spawn-interactive-plan.md) - Interactive vs non-interactive mode

## Goal

Unify spawn across all agents using the Agent Client Protocol (ACP) as the common event format. Agents that don't natively speak ACP get adapters that convert their JSON output to ACP events.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        poe-code spawn                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                  ACP Client (unified)                      │  │
│  │            Consumes ACP SessionUpdate events               │  │
│  │            Handles display, logging, result collection     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              ▲                                   │
│                              │ ACP SessionUpdate events          │
│         ┌────────────────────┼────────────────────┐             │
│         │                    │                    │             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │Claude Adapter│    │Codex Adapter │    │  Native ACP  │      │
│  │ (JSON → ACP) │    │(NDJSON → ACP)│    │  (passthrough)│     │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         ▲                    ▲                    ▲             │
│         │                    │                    │             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │claude --json │    │codex --json  │    │opencode/kimi │      │
│  │   (stdio)    │    │   (stdio)    │    │   (stdio)    │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

**Key Insight**: Convert Claude and Codex output to ACP format, then use one ACP client for all agents. Native ACP agents (OpenCode, Kimi) need no adapter.

## Research Summary

### ACP Event Model (Target Format)

ACP uses JSON-RPC 2.0 with `session/update` notifications containing `SessionUpdate` events:

| Event Type | Description |
|------------|-------------|
| `agent_message_chunk` | Text output from agent |
| `agent_thought_chunk` | Agent's internal reasoning |
| `tool_call` | Tool invocation start (with title, kind, status) |
| `tool_call_update` | Tool status/result update |
| `plan` | Task plan with entries |
| `user_message_chunk` | User input echo |

### Claude Code JSON Output

**Command** (non-interactive):
```bash
claude --model MODEL -p --output-format stream-json --verbose [mcp_args] [mode_args] PROMPT
```
Prompt passed as positional arg, outputs NDJSON to stdout.

**Command** (interactive):
```bash
claude --model MODEL [mcp_args] [mode_args] PROMPT
```

**Mode Configuration**: See [spawn-modes-plan.md](./spawn-modes-plan.md)

**MCP Config**: See [spawn-mcp-plan.md](./spawn-mcp-plan.md)

**Events** (NDJSON):
```json
{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{...}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"...","content":"..."}]}}
{"type":"result","num_input_tokens":100,"num_output_tokens":50,"cost_usd":0.003}
```

**Return Structure**:
```typescript
{
  success: boolean;      // exit code === 0
  output: string | null; // final text from assistant message
  events: Event[];       // all parsed events
  usage: { input_tokens: number; output_tokens: number; cost_usd: number };
  stderr: string | null; // only on failure
}
```

### Codex JSON Output

**Command** (non-interactive):
```bash
codex exec -m MODEL -s SANDBOX -C CWD --skip-git-repo-check --color never --json [mcp_args] -
```
Reads prompt from stdin (`-`), outputs NDJSON to stdout.

**Command** (interactive):
```bash
codex -m MODEL -s SANDBOX -a APPROVAL -C CWD [mcp_args] PROMPT
```

**Mode Configuration**: See [spawn-modes-plan.md](./spawn-modes-plan.md)

**MCP Config**: See [spawn-mcp-plan.md](./spawn-mcp-plan.md)

**Events** (NDJSON):
```json
{"type":"thread.started","thread_id":"..."}
{"type":"turn.started"}
{"type":"item.started","item":{"id":"...","type":"command_execution","command":"ls"}}
{"type":"item.started","item":{"id":"...","type":"file_edit","path":"src/foo.ts"}}
{"type":"item.started","item":{"id":"...","type":"thinking"}}
{"type":"item.started","item":{"id":"...","type":"mcp_tool_call","server":"srv","tool":"fn","arguments":{...}}}
{"type":"item.completed","item":{"id":"...","type":"agent_message","text":"..."}}
{"type":"item.completed","item":{"id":"...","type":"command_execution"}}
{"type":"item.completed","item":{"id":"...","type":"file_edit","path":"src/foo.ts"}}
{"type":"item.completed","item":{"id":"...","type":"mcp_tool_call","server":"srv","tool":"fn","result":"..."}}
{"type":"item.completed","item":{"id":"...","type":"reasoning","text":"..."}}
{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":50,"cached_input_tokens":25}}
{"type":"turn.failed"}
```

**Return Structure**:
```typescript
{
  success: boolean;      // exit code === 0
  output: string | null; // final agent_message text
  events: Event[];       // all parsed events
  usage: { input_tokens: number; output_tokens: number; cached_input_tokens?: number };
  thread_id: string;     // for session resumption
  stderr: string | null; // only on failure
}
```

## Event Mapping

### Codex → ACP Mapping

| Codex Event | ACP Event |
|-------------|-----------|
| `thread.started` | (session init, capture `thread_id` for resumption) |
| `turn.started` | (turn init, no emit) |
| `item.started` + `type: command_execution` | `tool_call` with `kind: "execute"`, `title: command` |
| `item.started` + `type: file_edit` | `tool_call` with `kind: "edit"`, `title: path` |
| `item.started` + `type: thinking` | `tool_call` with `kind: "think"` |
| `item.started` + `type: mcp_tool_call` | `tool_call` with `kind: "other"`, `title: server.tool` |
| `item.completed` + `type: agent_message` | `agent_message_chunk` (final text) |
| `item.completed` + `type: command_execution` | `tool_call_update` with `status: "completed"` |
| `item.completed` + `type: file_edit` | `tool_call_update` with `status: "completed"` |
| `item.completed` + `type: mcp_tool_call` | `tool_call_update` with `rawOutput: result` |
| `item.completed` + `type: reasoning` | `agent_thought_chunk` (reasoning text) |
| `turn.completed` | (session end, capture `usage` metadata) |
| `turn.failed` | (session failed) |

### Claude → ACP Mapping

| Claude Event | ACP Event |
|--------------|-----------|
| `type: "assistant"` + `content[].type: "text"` | `agent_message_chunk` |
| `type: "assistant"` + `content[].type: "tool_use"` | `tool_call` with `title: name`, `kind` from tool name |
| `type: "user"` + `content[].type: "tool_result"` | `tool_call_update` with `status: "completed"` |
| `type: "result"` | (session end, capture `usage` metadata) |

**Tool name → kind mapping**:
| Tool Name | Kind |
|-----------|------|
| `Read` | `read` |
| `Write`, `Edit`, `NotebookEdit` | `edit` |
| `Bash` | `execute` |
| `Glob`, `Grep` | `search` |
| `Task` (thinking) | `think` |
| MCP tools | `mcp` |
| Others | `other` |

## Provider Configuration

Providers declare ACP support with one line:

```typescript
// Native ACP (OpenCode, Kimi)
acp: true

// Needs adapter (Claude, Codex)
acp: "claude-code" | "codex"
```

Full provider examples:

```typescript
// claude-code.ts
{
  name: "claude-code",
  acp: "claude-code",
  isolatedEnv: {
    agentBinary: "claude",
    env: { ANTHROPIC_API_KEY: { kind: "poeApiKey" }, ... }
  }
}

// codex.ts
{
  name: "codex",
  acp: "codex",
  isolatedEnv: {
    agentBinary: "codex",
    env: { OPENAI_API_KEY: { kind: "poeApiKey" }, ... }
  }
}

// opencode.ts (native ACP)
{
  name: "opencode",
  acp: true,
  isolatedEnv: { ... }
}
```

## Critical Files

| File | Action |
|------|--------|
| `src/acp/types.ts` | Create - ACP event types (SessionUpdate, ToolCall, etc.) |
| `src/acp/client.ts` | Create - Unified ACP client that consumes events |
| `src/acp/adapters/claude.ts` | Create - Claude JSON → ACP adapter |
| `src/acp/adapters/codex.ts` | Create - Codex NDJSON → ACP adapter |
| `src/acp/adapters/native.ts` | Create - Passthrough for native ACP agents |
| `src/acp/spawn.ts` | Create - Spawn runner using ACP |
| `src/cli/commands/spawn.ts` | Update - Use ACP spawn |
| `src/cli/service-registry.ts` | Update - Add `acp` field to ProviderService |
| `src/providers/*.ts` | Update - Add `acp` config, remove `spawn()` methods |

## Implementation Steps

### Step 1: ACP Types (`src/acp/types.ts`)

```typescript
// Core ACP types (subset needed for spawn)
export type SessionUpdate =
  | AgentMessageChunk
  | AgentThoughtChunk
  | ToolCall
  | ToolCallUpdate
  | Plan;

export interface AgentMessageChunk {
  sessionUpdate: "agent_message_chunk";
  content: { type: "text"; text: string };
}

export interface AgentThoughtChunk {
  sessionUpdate: "agent_thought_chunk";
  content: { type: "text"; text: string };
}

export interface ToolCall {
  sessionUpdate: "tool_call";
  toolCallId: string;
  title: string;
  kind: "read" | "edit" | "execute" | "search" | "think" | "mcp" | "other";
  status: "pending" | "in_progress" | "completed" | "failed";
  rawInput?: unknown;
}

export interface ToolCallUpdate {
  sessionUpdate: "tool_call_update";
  toolCallId: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  rawOutput?: unknown;
}

export interface Plan {
  sessionUpdate: "plan";
  entries: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
  }>;
}
```

### Step 2: Codex Adapter (`src/acp/adapters/codex.ts`)

```typescript
import type { SessionUpdate } from "../types.js";

interface CodexResult {
  success: boolean;
  output: string | null;
  usage: { input_tokens: number; output_tokens: number; cached_input_tokens?: number } | null;
  threadId: string | null;
}

export async function* adaptCodexToAcp(
  lines: AsyncIterable<string>
): AsyncIterable<SessionUpdate> {
  for await (const line of lines) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);

    if (event.type === "item.started") {
      const item = event.item;

      if (item.type === "command_execution") {
        yield {
          sessionUpdate: "tool_call",
          toolCallId: item.id,
          title: truncate(item.command, 80),
          kind: "execute",
          status: "pending"
        };
      } else if (item.type === "file_edit") {
        yield {
          sessionUpdate: "tool_call",
          toolCallId: item.id,
          title: item.path,
          kind: "edit",
          status: "pending"
        };
      } else if (item.type === "thinking") {
        yield {
          sessionUpdate: "tool_call",
          toolCallId: item.id,
          title: "thinking",
          kind: "think",
          status: "pending"
        };
      } else if (item.type === "mcp_tool_call") {
        yield {
          sessionUpdate: "tool_call",
          toolCallId: item.id,
          title: `${item.server}.${item.tool}`,
          kind: "other",
          status: "pending",
          rawInput: item.arguments
        };
      }
    } else if (event.type === "item.completed") {
      const item = event.item;

      if (item.type === "agent_message") {
        yield {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: item.text ?? "" }
        };
      } else if (item.type === "reasoning") {
        yield {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: item.text ?? item.content ?? item.summary ?? "" }
        };
      } else if (item.type === "command_execution") {
        yield {
          sessionUpdate: "tool_call_update",
          toolCallId: item.id,
          status: "completed"
        };
      } else if (item.type === "file_edit") {
        yield {
          sessionUpdate: "tool_call_update",
          toolCallId: item.id,
          status: "completed"
        };
      } else if (item.type === "mcp_tool_call") {
        yield {
          sessionUpdate: "tool_call_update",
          toolCallId: item.id,
          status: "completed",
          rawOutput: item.result
        };
      }
    }
    // thread.started, turn.started, turn.completed, turn.failed are handled by the runner
  }
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(0, maxLength) + "...";
}
```

### Step 3: Claude Adapter (`src/acp/adapters/claude.ts`)

```typescript
import type { SessionUpdate, ToolCall } from "../types.js";

const TOOL_KIND_MAP: Record<string, ToolCall["kind"]> = {
  Read: "read",
  Write: "edit",
  Edit: "edit",
  NotebookEdit: "edit",
  Bash: "execute",
  Glob: "search",
  Grep: "search",
  Task: "think",
};

export async function* adaptClaudeToAcp(
  lines: AsyncIterable<string>
): AsyncIterable<SessionUpdate> {
  for await (const line of lines) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);

    if (event.type === "assistant") {
      const content = event.message?.content ?? [];
      for (const block of content) {
        if (block.type === "text") {
          yield {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: block.text ?? "" }
          };
        } else if (block.type === "tool_use") {
          const toolName = block.name ?? "unknown";
          yield {
            sessionUpdate: "tool_call",
            toolCallId: block.id ?? crypto.randomUUID(),
            title: toolName,
            kind: TOOL_KIND_MAP[toolName] ?? "other",
            status: "pending",
            rawInput: block.input
          };
        }
      }
    } else if (event.type === "user") {
      const content = event.message?.content ?? [];
      for (const block of content) {
        if (block.type === "tool_result") {
          yield {
            sessionUpdate: "tool_call_update",
            toolCallId: block.tool_use_id,
            status: "completed",
            rawOutput: block.content
          };
        }
      }
    }
    // type: "result" is handled by the runner for usage capture
  }
}
```

### Step 4: ACP Client (`src/acp/client.ts`)

```typescript
export interface AcpClientOptions {
  onMessage?: (text: string) => void;
  onThought?: (text: string) => void;
  onToolStart?: (id: string, title: string, kind: string) => void;
  onToolComplete?: (id: string, status: string) => void;
}

export async function consumeAcpEvents(
  events: AsyncIterable<SessionUpdate>,
  options: AcpClientOptions
): Promise<{ output: string; success: boolean }> {
  let output = "";

  for await (const event of events) {
    switch (event.sessionUpdate) {
      case "agent_message_chunk":
        output += event.content.text;
        options.onMessage?.(event.content.text);
        break;
      case "agent_thought_chunk":
        options.onThought?.(event.content.text);
        break;
      case "tool_call":
        options.onToolStart?.(event.toolCallId, event.title, event.kind);
        break;
      case "tool_call_update":
        options.onToolComplete?.(event.toolCallId, event.status);
        break;
    }
  }

  return { output, success: true };
}
```

### Step 5: Unified Spawn (`src/acp/spawn.ts`)

```typescript
import { spawn } from "node:child_process";
import { adaptClaudeToAcp } from "./adapters/claude.js";
import { adaptCodexToAcp } from "./adapters/codex.js";
import { consumeAcpEvents, type AcpClientOptions } from "./client.js";

export interface SpawnResult {
  success: boolean;
  output: string | null;
  exitCode: number;
  usage: { input_tokens: number; output_tokens: number; cached_input_tokens?: number } | null;
  threadId: string | null;
  stderr: string | null;
}

export async function spawnWithAcp(options: {
  binary: string;
  args: string[];  // args include mode/mcp settings, built by adapter
  env: Record<string, string>;
  cwd: string;
  stdin?: string;
  acpAdapter: "claude-code" | "codex" | true;
  clientOptions: AcpClientOptions;
}): Promise<SpawnResult> {
  const child = spawn(options.binary, options.args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...minimalEnv(), ...options.env },
    cwd: options.cwd
  });

  if (options.stdin) {
    child.stdin.write(options.stdin);
    child.stdin.end();
  }

  // Create line stream from stdout
  const lines = readLines(child.stdout);

  // State captured from meta-events
  let threadId: string | null = null;
  let usage: SpawnResult["usage"] = null;

  // Pick adapter based on provider
  const events = options.acpAdapter === "claude-code"
    ? adaptClaudeToAcp(lines)
    : options.acpAdapter === "codex"
    ? adaptCodexToAcp(lines)
    : parseNativeAcp(lines);

  // Wrap to capture meta-events (thread.started, turn.completed)
  const wrappedEvents = captureMetaEvents(events, {
    onThreadStarted: (id) => { threadId = id; },
    onTurnCompleted: (u) => { usage = u; }
  });

  const result = await consumeAcpEvents(wrappedEvents, options.clientOptions);

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 0));
  });

  const stderr = await readAll(child.stderr);

  return {
    success: exitCode === 0,
    output: result.output,
    exitCode,
    usage,
    threadId,
    stderr: exitCode !== 0 ? stderr : null
  };
}

function minimalEnv(): Record<string, string> {
  const keys = ["PATH", "HOME", "USER", "SHELL", "TMPDIR"];
  const env: Record<string, string> = {};
  for (const key of keys) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return env;
}
```

### Step 6: Update Spawn Command

```typescript
// In spawn.ts action handler
if (adapter.acp) {
  const details = await resolveIsolatedEnvDetails(...);
  const args = buildSpawnArgs(adapter.spawnConfig, spawnOptions);

  const result = await spawnWithAcp({
    binary: details.agentBinary,
    args,
    env: details.env,
    cwd: spawnOptions.cwd,
    stdin: spawnOptions.useStdin ? spawnOptions.prompt : undefined,
    acpAdapter: adapter.acp,
    clientOptions: {
      onMessage: (text) => process.stdout.write(text),
      onToolStart: (id, title) => logger.info(`→ ${title}`),
      onToolComplete: (id, status) => logger.info(`✓ ${status}`)
    }
  });
}
```

## Codex Argument Building

See:
- [spawn-modes-plan.md](./spawn-modes-plan.md) for mode-specific argument building
- [spawn-mcp-plan.md](./spawn-mcp-plan.md) for MCP config serialization

## CLI Args for JSON Output

| Provider | Command | Notes |
|----------|---------|-------|
| Claude Code | `claude -p --output-format stream-json --verbose PROMPT` | Prompt as positional arg |
| Codex | `codex exec --json -` | Reads prompt from stdin |
| OpenCode | (native) | Speaks ACP directly |
| Kimi | (native) | Speaks ACP directly |

## Benefits

1. **One client** - Single ACP consumer handles all agents
2. **Minimal adapters** - Claude is almost passthrough, Codex needs mapping
3. **Declarative** - Providers just declare `acp: true | "adapter-name"`
4. **No SDKs** - Uses CLI + JSON parsing, no vendor SDK dependencies
5. **Future-proof** - Native ACP agents need zero adapter code
6. **Streaming** - Real-time event processing via async iterables

## Testing Strategy

- Unit test adapters with sample NDJSON fixtures
- Unit test ACP client with mock events
- Integration tests spawn actual binaries with mocked prompts
- No real LLM calls in tests

## Configured vs Isolated Mode

Spawn detects whether the user ran `poe-code configure <service>` by checking `~/.poe-code/credentials.json`:

```json
{
  "apiKey": "poe-api-key",
  "configured_services": {
    "claude-code": { "files": ["~/.claude/settings.json"] },
    "codex": { "files": ["~/.codex/config.toml"] }
  }
}
```

| Mode | Detection | Behavior |
|------|-----------|----------|
| **Configured** | Service exists in `configured_services` | Run agent binary directly - Poe config is in native config files |
| **Isolated** | Service NOT in `configured_services` | Use `wrap` to inject Poe credentials via environment variables |

Both modes use Poe API key. The difference is where credentials come from:
- **Configured**: from native config files that `poe-code configure` created (e.g., `~/.claude/settings.json`)
- **Isolated**: from environment variables that `wrap` injects (uses `~/.poe-code/<provider>/` isolated config)

```typescript
import { loadConfiguredServices } from "../services/credentials.js";

// In spawn logic
const configuredServices = await loadConfiguredServices({
  fs: container.fs,
  filePath: container.env.credentialsPath
});
const isConfigured = adapter.name in configuredServices;

if (isConfigured) {
  // Run directly - Poe config is in native config files
  spawn(adapter.isolatedEnv.agentBinary, args, { env: process.env });
} else {
  // Use wrap - inject Poe credentials via isolated env
  const isolatedDetails = await resolveIsolatedEnvDetails(...);
  spawn(adapter.isolatedEnv.agentBinary, args, { env: isolatedDetails.env });
}
```

## Session Resumption

Codex supports session resumption via `thread_id`:
```bash
codex resume -C CWD THREAD_ID
```

The `thread_id` is captured from `thread.started` event and returned in `SpawnResult.threadId`. This enables:
- Resuming interrupted sessions
- Continuing multi-turn conversations
- Debugging failed runs

## Open Questions

1. **Error handling**: How to surface agent errors through ACP events? (Currently: stderr is captured and returned on failure)
2. ~~**Usage tracking**: Should we expose token usage from `turn.completed`?~~ → Yes, exposed in `SpawnResult.usage`
3. ~~**Interactive mode**: Do we need to support `codex` (interactive) in addition to `codex exec` (non-interactive)?~~ → Yes, see [spawn-interactive-plan.md](./spawn-interactive-plan.md)
