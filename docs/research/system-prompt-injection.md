# System Prompt Injection for Coding Agents

Historical note: this investigation predates the current e2e snapshot/proxy
docs. Use [Snapshot testing](../development/SNAPSHOT_TESTING.md) for current
record/playback commands.

## Goal

Provide a static system prompt to all coding agents for the `test` command so we can record API usage (fixtures) and avoid breaking CI/CD.

## Agent Inventory

| Agent          | ID               | Binary           | System Prompt via CLI Flag | System Prompt via Config File              | E2E Fixtures                                                      | Test Prompt                      | Expected Output  |
| -------------- | ---------------- | ---------------- | -------------------------- | ------------------------------------------ | ----------------------------------------------------------------- | -------------------------------- | ---------------- |
| Claude Code    | `claude-code`    | `claude`         | No                         | No (uses `~/.claude/settings.json`)        | None                                                              | `Output exactly: CLAUDE_CODE_OK` | `CLAUDE_CODE_OK` |
| Codex          | `codex`          | `codex`          | No                         | No (uses `~/.codex/config.toml`)           | None                                                              | `Output exactly: CODEX_OK`       | `CODEX_OK`       |
| Kimi           | `kimi`           | `kimi`           | No                         | No (uses `~/.kimi/config.toml`)            | None                                                              | `Output exactly: KIMI_OK`        | `KIMI_OK`        |
| OpenCode       | `opencode`       | `opencode`       | No                         | No (uses `~/.config/opencode/config.json`) | None                                                              | `Output exactly: OPEN_CODE_OK`   | `OPEN_CODE_OK`   |
| Poe Agent      | `poe-agent`      | N/A (in-process) | N/A                        | N/A (loads `SYSTEM_PROMPT.md` internally)  | `e2e/fixtures/poe-agent-mcp/`, `e2e/fixtures/poe-agent-file-ops/` | varies                           | varies           |
| Claude Desktop | `claude-desktop` | N/A (GUI)        | N/A                        | N/A                                        | N/A                                                               | N/A                              | N/A              |

## Current Architecture

### Poe Agent (internal)

- Runs **in-process** via ACP (Agent Communication Protocol)
- System prompt loaded from `packages/poe-agent/src/SYSTEM_PROMPT.md`
- Injected as `messages[0]` with `role: "system"` in `PoeChatService`
- No override mechanism — `createAgentSession()` always calls `loadSystemPrompt()`
- E2E fixtures already exist — proxy in playback mode serves recorded responses keyed by `sha256(model + messages)`
- **If the system prompt changes, the hash changes, and all fixtures break (404)**

### External Agents (subprocess)

- Spawned as CLI subprocesses via `buildSpawnArgs()` → `child_process.spawn()`
- Only the **user prompt** is passed (via `-p`, `exec`, `run` flags)
- No system prompt injection — poe-code has zero control over the agent's internal system prompt
- The `test` command sends `"Output exactly: <EXPECTED>"` and checks stdout
- **No E2E fixtures exist** for external agents — test hits the real LLM API

### Test Command Flow

```
poe-code test <agent>
  → resolveServiceAdapter(agent)
  → provider.test(context)
  → context.runCheck(createSpawnHealthCheck(agentId, { expectedOutput }))
  → buildSpawnArgs(agentId, { prompt: "Output exactly: <X>", mode: "yolo" })
  → child_process.spawn(binary, args)
  → check stdout contains expectedOutput
```

## Options

### Option 1: Proxy all test traffic through fixture proxy

Create `e2e/fixtures/<agent>/` directories with pre-recorded responses for every external agent. The proxy server (already built) matches requests by `sha256(model + messages)` hash.

**Pros:**

- Already proven pattern (poe-agent-mcp uses this)
- Fully deterministic — no API calls in CI
- Does not require agent cooperation — records the full exchange as-is

**Cons:**

- Must re-record fixtures whenever the test prompt changes
- Each agent's internal system prompt is opaque — if the agent vendor updates it, fixtures go stale
- Docker proxy infra needed for each agent

### Option 2: Use agent-native config mechanisms for system prompt

Each agent has its own way to receive instructions:

| Agent       | Mechanism                                      |
| ----------- | ---------------------------------------------- |
| Claude Code | `CLAUDE.md` file in working directory          |
| Codex       | `AGENTS.md` or `codex.md` in working directory |
| Kimi        | Unknown — needs investigation                  |
| OpenCode    | Unknown — needs investigation                  |

Write a temp file in the test working directory with static instructions before spawning.

**Pros:**

- Works with each agent's native instruction system
- No proxy infra needed
- More realistic test (agent actually processes the instruction)

**Cons:**

- Agent-specific — each needs different mechanism
- Not all agents support this (Kimi, OpenCode unknown)
- Still non-deterministic — different models may behave differently
- Does not solve fixture recording for CI

### Option 3: Add `--system-prompt` / `--append-system-prompt` to spawn config

Extend `CliSpawnConfig` with an optional `systemPromptFlag` and pass a static prompt during test.

**Pros:**

- Clean, declarative approach
- Integrates with existing spawn config pattern

**Cons:**

- Most agents don't support such flags today
- Claude Code does support `--append-system-prompt` but others don't
- Doesn't help agents that lack the flag

### Option 4: Prepend instructions to the user prompt

Modify `createSpawnHealthCheck` to embed deterministic instructions directly in the user prompt:

```
"IMPORTANT: You must respond with exactly the following text and nothing else: CLAUDE_CODE_OK"
```

**Pros:**

- Works for all agents immediately
- No agent-specific mechanisms needed
- Simple implementation

**Cons:**

- Does not solve the CI determinism problem (still hits real API)
- LLMs may still hallucinate extra content

## Recommendation

**Option 1 (proxy all test traffic)** is the most robust for CI/CD determinism. It's already working for `poe-agent-mcp`. Steps:

1. Create fixture directories: `e2e/fixtures/claude-code/`, `e2e/fixtures/codex/`, etc.
2. Record fixtures once: `POE_PROXY_MODE=record npm run e2e:verbose`
3. CI runs in `playback` mode — fully deterministic, no API calls
4. The system prompt doesn't matter because the **entire request/response exchange is recorded**

For agents where we also want to control the system prompt (e.g. to make responses more predictable during recording), combine with **Option 2** (native config files like `CLAUDE.md`) during the recording step.
