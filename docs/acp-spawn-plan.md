# Unified Spawn via ACP Implementation Plan

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

**Flags**: `--output-format stream-json`

**Format**: NDJSON

**Adapter**: Parse Claude's JSON output and convert to ACP `SessionUpdate` events.

### Codex JSON Output

**Flags**: `codex exec --json`

**Format**: NDJSON with custom event types

**Events** (need mapping to ACP):
```json
{"type":"thread.started","thread_id":"..."}
{"type":"turn.started"}
{"type":"item.started","item":{"id":"...","type":"command_execution","command":"ls"}}
{"type":"item.completed","item":{"id":"...","type":"agent_message","text":"..."}}
{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":50}}
```

## Event Mapping

### Codex → ACP Mapping

| Codex Event | ACP Event |
|-------------|-----------|
| `thread.started` | (session init, no emit) |
| `turn.started` | (turn init, no emit) |
| `item.started` + `type: agent_message` | `agent_message_chunk` |
| `item.started` + `type: reasoning` | `agent_thought_chunk` |
| `item.started` + `type: command_execution` | `tool_call` with `kind: "execute"` |
| `item.started` + `type: file_change` | `tool_call` with `kind: "edit"` |
| `item.completed` + `type: command_execution` | `tool_call_update` with `status: "completed"` |
| `item.completed` + `type: agent_message` | `agent_message_chunk` (final text) |
| `turn.completed` | (session end with usage metadata) |
| `turn.failed` | `tool_call_update` with `status: "failed"` |

### Claude → ACP Mapping

Claude outputs its own JSON format. The adapter:
- Parses NDJSON lines from `--output-format stream-json`
- Maps Claude events to ACP `SessionUpdate` events
- (Exact mapping TBD - need to document Claude's actual JSON event types)

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
  kind: "read" | "edit" | "execute" | "search" | "think" | "other";
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
export async function* adaptCodexToAcp(
  lines: AsyncIterable<string>
): AsyncIterable<SessionUpdate> {
  for await (const line of lines) {
    const event = JSON.parse(line);

    if (event.type === "item.started" || event.type === "item.completed") {
      const item = event.item;

      if (item.type === "agent_message") {
        yield {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: item.text ?? "" }
        };
      } else if (item.type === "reasoning") {
        yield {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: item.text ?? "" }
        };
      } else if (item.type === "command_execution") {
        yield event.type === "item.started"
          ? {
              sessionUpdate: "tool_call",
              toolCallId: item.id,
              title: item.command,
              kind: "execute",
              status: "pending"
            }
          : {
              sessionUpdate: "tool_call_update",
              toolCallId: item.id,
              status: item.status === "completed" ? "completed" : "failed",
              rawOutput: item.aggregated_output
            };
      } else if (item.type === "file_change") {
        yield event.type === "item.started"
          ? {
              sessionUpdate: "tool_call",
              toolCallId: item.id,
              title: `Edit: ${item.changes?.[0]?.path ?? "file"}`,
              kind: "edit",
              status: "pending"
            }
          : {
              sessionUpdate: "tool_call_update",
              toolCallId: item.id,
              status: "completed"
            };
      }
    }
  }
}
```

### Step 3: Claude Adapter (`src/acp/adapters/claude.ts`)

```typescript
// TBD: Need to research Claude's actual --output-format stream-json event types
// and map them to ACP SessionUpdate events
export async function* adaptClaudeToAcp(
  lines: AsyncIterable<string>
): AsyncIterable<SessionUpdate> {
  for await (const line of lines) {
    const event = JSON.parse(line);
    // Map Claude's event types to ACP format
    // Implementation depends on Claude's actual JSON output structure
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

export async function spawnWithAcp(options: {
  binary: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  stdin?: string;
  acpAdapter: "claude-code" | "codex" | true;
  clientOptions: AcpClientOptions;
}): Promise<{ output: string; exitCode: number }> {
  const child = spawn(options.binary, options.args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...options.env },
    cwd: options.cwd
  });

  if (options.stdin) {
    child.stdin.write(options.stdin);
    child.stdin.end();
  }

  // Create line stream from stdout
  const lines = readLines(child.stdout);

  // Pick adapter based on provider
  const events = options.acpAdapter === "claude-code"
    ? adaptClaudeToAcp(lines)
    : options.acpAdapter === "codex"
    ? adaptCodexToAcp(lines)
    : lines; // Native ACP - parse directly

  const result = await consumeAcpEvents(
    options.acpAdapter === true ? parseNativeAcp(lines) : events,
    options.clientOptions
  );

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 0));
  });

  return { output: result.output, exitCode };
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

## CLI Args for JSON Output

| Provider | Flag | Notes |
|----------|------|-------|
| Claude Code | `--output-format stream-json` | Already ACP-compatible |
| Codex | `--json` | Custom format, needs adapter |
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

## Open Questions

1. **Error handling**: How to surface agent errors through ACP events?
2. **Usage tracking**: Should we expose token usage from `turn.completed`?
