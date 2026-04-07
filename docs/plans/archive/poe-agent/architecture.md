# Poe Agent Restoration Architecture

## Context

The Poe agent runtime existed as a full sub-system and was later removed as part of beta workspace cleanup.  
The goal is to restore that runtime as a standalone package, `@poe-code/poe-agent`, and integrate it into the current provider-based architecture without reintroducing interactive flows.

Hard requirement: the restored agent must be ACP compliant.

Execution order is strict:

1. Implement custom ACP-compliant `@poe-code/poe-agent`.
2. Implement custom ACP client/reporting.
3. Only then consider other coding agents/clients.

This document captures the recovered architecture from git history and defines how to bring it back in a way that fits the current codebase.

## Historical removal and source baseline

The implementation was removed in two structural commits:

- `cae64be` (2025-11-16): moved agent runtime from root paths into `beta/`
- `3e97549` (2025-11-26): deleted `beta/`, including the entire agent runtime

The most complete recoverable snapshot is the parent of the deletion commit:

- baseline snapshot: `3e97549^`

Behavioral commits that shaped the final runtime before deletion:

- `591abf2`: initial agent command + session integration
- `3fa8f1e`: async task execution integrated into tool executor and chat loop
- `b3bad3c`: task completion/drain behavior normalized across surfaces
- `c015250`: streaming/stop-related updates in session/chat
- `f8ba64f` + `deff0e4`: agent config manager + `poe-code` spawn path
- `15f07ce`: shared spawn command with custom handler for built-in poe agent

## What was removed

At deletion time (`3e97549`), these components were removed together:

- CLI entry points:
  - `beta/src/cli/commands/agent.ts`
  - `beta/src/cli/spawn-handlers.ts`
  - `beta/src/cli/commands/configure-agents.ts`
- Runtime orchestration:
  - `beta/src/services/agent-session.ts`
  - `beta/src/services/chat.ts`
- Tooling and execution:
  - `beta/src/services/tools.ts`
  - `beta/src/services/agent-task-registry.ts`
  - `beta/src/services/task-runner.ts`
- Agent selection/config:
  - `beta/src/services/agent-registry.ts`
  - `beta/src/services/agent-config-manager.ts`
  - `beta/src/services/poe-code.ts`
- Tests:
  - `beta/tests/agent-command.test.ts`
  - `beta/tests/agent-config-manager.test.ts`
  - `beta/tests/get-available-tools.test.ts`
  - relevant coverage in `beta/tests/cli.test.ts` and `beta/tests/tools-worktree.test.ts`

This was not a thin adapter; it was a complete agent runtime stack.

## Recovered architecture (high-level)

The deleted system had five layers:

1. Command surface
2. Session/runtime orchestration
3. Chat + tool-calling engine
4. Tool execution + worktree execution
5. Agent registry/config and adapter dispatch

The important architectural property was that sub-agent execution was adapter-driven, not hardcoded at callsites.

## Runtime flow

The target runtime flow is:

1. CLI command (`agent` or spawn handler) resolves model/api key and creates session.
2. Session constructs:
   - MCP manager
   - agent registry + agent config manager
   - tool executor
   - chat service
3. Chat service sends a Poe API chat completion request.
4. If tool calls are returned, each tool is executed and tool outputs are appended back into conversation history.
5. Final assistant message is returned to CLI caller.

Explicit target constraint:

- no async/background spawn path
- no detached task lifecycle methods (`waitForAllTasks`, `drainCompletedTasks`) in restored runtime

## ACP compliance contract

The restored runtime must emit ACP-native updates as the public stream contract.

Protocol references:

- schema: `agentclientprotocol/agent-client-protocol` `schema/schema.json`
- protocol docs: prompt turn, tool calls, content, plan, session config options

Required output model:

- `sessionUpdate` discriminator, not custom event-only vocabulary
- ACP tool kinds/statuses (`execute`, `pending|in_progress|completed|failed`)
- ACP content/tool-call structures
- `_meta` treated as extensibility space

Transport-only metadata may still exist as extension events, but ACP updates are the primary contract.

Required `sessionUpdate` coverage:

- stable: `user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, `available_commands_update`, `current_mode_update`, `config_option_update`
- unstable (supported when data exists): `session_info_update`, `usage_update`

Scope constraint:

- no rollout to other existing coding agents in this implementation

## Reusable ACP layer

ACP normalization/parsing is a shared concern and must not live inside a single provider runtime.

Shared package:

- `packages/poe-acp-client`
- npm name: `@poe-code/poe-acp-client`

Required responsibilities:

1. ACP schema-aligned TypeScript types (stable + unstable session updates)
2. JSON-RPC helpers for `session/update` notifications
3. Stream helper functions for extracting message/thought/usage/thread metadata
4. Legacy event-to-ACP mapper for adapters that still emit internal event vocabularies

Integration rule:

- every streamed provider surface must pass through this package and emit ACP `sessionUpdate` events as the public stream contract.

## Detailed subsystem decomposition

### 1) Command surface

`agent.ts` was a one-shot non-streaming command with explicit model/api-key options (historically with post-run task draining).  
`spawn-handlers.ts` provided a custom spawn service handler for the built-in Poe agent path, so `spawn poe-code ...` could reuse the same conversation runtime.

Architectural value:

- command surface stayed thin
- execution logic lived in shared runtime services

### 2) Session orchestration

`agent-session.ts` was the composition root.  
Historically it assembled all runtime dependencies and returned:

- `sendMessage`
- `waitForAllTasks`
- `drainCompletedTasks`
- `dispose`

Target session contract in restored runtime:

- `sendMessage`
- `dispose`

Architectural value:

- explicit lifecycle
- clear dependency wiring
- easy integration point for CLI and future SDK callers

### 3) Chat engine

`chat.ts` provided the LLM loop:

- conversation history
- model strategy selection
- tool-call iteration loop with max-attempt bound
- callback hooks for tool lifecycle events
- Poe API transport

Architectural value:

- deterministic control loop
- consistent tool call handling and error propagation

### 4) Tool executor and worktree execution

`tools.ts` was large because it owned both local tooling and worktree orchestration:

- built-ins (`read_file`, `write_file`, `list_files`, `run_command`, `search_web`, `spawn_git_worktree`)
- managed command handling for known adapters
- synchronous worktree/tool execution only
- dynamic tool schema generation from enabled agent config

Architectural value:

- single authority for tool behavior
- dynamic agent enum generation from config instead of hardcoded branching

### 5) Agent registry and config

`agent-registry.ts` defined available adapters and spawn detection.  
`agent-config-manager.ts` persisted enabled/disabled agent state in:

- `~/.poe-code/agent-config.json`

Architectural value:

- adapter registry decoupled execution from provider branching
- config file controlled availability in tool schema and runtime checks

## Target architecture in current monorepo

Restore the runtime as a package, not as scattered root files.

Proposed package:

- `packages/poe-agent`
- package name: `@poe-code/poe-agent`

Proposed internal structure:

- `src/runtime/agent-session.ts`
- `src/runtime/chat.ts`
- `src/runtime/tools.ts`
- `src/runtime/agent-registry.ts`
- `src/runtime/agent-config-manager.ts`
- `src/runtime/spawn-poe-agent.ts`
- `src/index.ts`

Integration strategy:

1. Add provider module `src/providers/poe-agent.ts`.
2. Let provider auto-discovery pick it up (same pattern as existing providers).
3. Use provider spawn hook for `poe-agent` path.
4. Keep shared CLI command logic generic; no provider-specific switch/case.
5. Optionally reintroduce `poe-code agent <prompt>` command as a thin facade over package runtime.

## Non-interactive design contract

Restored Poe agent must be non-interactive only.

That means:

- no prompt UI/multiselect flows in runtime or command surface
- no fallback to interactive input when required values are missing
- inputs come from args/env/credentials only
- clear failure message if required inputs are absent

Historical `configure agents` interactive flow should not be restored as interactive behavior.
If agent toggling is needed, it should be file/flag-driven and scriptable.

## Build order

Implementation order:

1. Port runtime internals from `3e97549^` into `packages/poe-agent`, excluding async background task runtime pieces.
2. Add ACP-compliant stream layer inside `packages/poe-agent`.
3. Enforce synchronous-only execution (no detached/background task spawn).
4. Integrate through new provider file.
5. Port and adapt tests for runtime parity and ACP conformance.
6. Build custom ACP client/reporting layer.

## ACP client/reporting deliverable

The ACP client is a concrete build target, not a placeholder.

Required definition:

- package: `packages/poe-acp-client` (`@poe-code/poe-acp-client`)
- input: ACP stream (`SessionUpdate` + transport extension events)
- outputs:
  - structured JSON run report
  - human-readable summary report
- minimum report fields:
  - run id, start/end timestamps, exit status
  - tool calls (id, kind, status, timings)
  - token/cost usage aggregates
  - error list with ACP context
- storage location: `~/.poe-code/reports/` (timestamped files)

## Testing posture

Coverage should preserve the old behavior contracts while fitting current test standards:

- unit tests for config manager, tool schema generation, and command runtime logic
- ACP stream conformance tests (stable + unstable updates)
- synchronous-only enforcement tests (no detached/background task path)
- integration tests for `spawn poe-agent`
- e2e for spawn/configure-adjacent changes before completion
- visual CLI verification with screenshot tooling for affected command surfaces

The original test baselines in deleted `beta/tests/*` are the primary reference set for parity.

## Architectural risks and controls

Risk: partial restoration that only reintroduces thin wrappers.  
Control: port session/chat/tools/task stack together from `3e97549^`.

Risk: provider-branching regressions in shared commands.  
Control: integrate only through provider registration and standard spawn path.

Risk: interactive behavior leaks back in.  
Control: explicit non-interactive tests and command-path assertions.

Risk: async/background spawn path is reintroduced unintentionally.  
Control: explicit tests and code-level guardrails that reject detached/background execution.

## Decision

Implement a synchronous, ACP-compliant `@poe-code/poe-agent` first, then implement custom ACP client/reporting, and only after both are complete consider broader rollout to other agents/clients.

## Deep code-level contract map

What follows is the recovered API surface from the deleted snapshot, grouped by responsibility.  
This is the practical contract we need to port, not a wishlist.

### `beta/src/services/poe-code.ts` (17 lines)

Exports:

- `SpawnPoeCodeOptions`
- `spawnPoeCode(options)`

Role:

- tiny adapter that shells out to `poe-code agent <prompt> ...args`
- should be renamed in package form to avoid legacy naming confusion (`spawn-poe-agent.ts`)

### `beta/src/services/agent-registry.ts` (129 lines)

Exports:

- `AgentSpawnOptions`
- `AgentDetectionContext`
- `AgentAdapter`
- `AgentRegistry`
- `createDefaultAgentRegistry()`
- `LEGACY_DEFAULT_AGENTS`

Role:

- centralizes spawn adapter definitions
- owns binary-detection behavior for known agents
- applies default-enabled policy (`claude-code`, `codex`, `opencode` true; `poe-code` false)

### `beta/src/services/agent-config-manager.ts` (178 lines)

Exports:

- `AgentConfigEntry`
- `AgentConfig`
- `AgentConfigManager`

Role:

- owns `~/.poe-code/agent-config.json`
- sanitizes loaded JSON
- merges file state with live registry entries
- persists canonicalized config

Behavioral detail worth preserving:

- registry additions auto-merge into config
- unknown or malformed file content does not crash runtime; it falls back safely

### `beta/src/services/agent-session.ts` (159 lines)

Exports:

- `AgentSession` interface
- `AgentSessionOptions`
- `createAgentSession(options)`

Role:

- composition root
- builds MCP manager, tool executor, chat service
- enforces lifecycle (`sendMessage`, `dispose`)

### `beta/src/services/chat.ts` (392 lines)

Exports:

- `ChatMessage`, `ToolCall`, `Tool`, request/response interfaces
- `ToolExecutor` interface
- `ToolCallEvent`, `ToolCallCallback`
- `PoeChatService`

Role:

- maintains conversation history
- executes iterative tool-call loop
- calls Poe `/v1/chat/completions`
- injects completed task summaries back into system context

Critical invariant:

- tool-call loop must be bounded (max attempts) to prevent infinite recursion.

### `beta/src/services/tools.ts` (1064 lines)

Exports:

- `ToolExecutorDependencies`
- `DefaultToolExecutor`
- `GetAvailableToolsOptions`
- `getAvailableTools(options)`

Role:

- execution engine for built-in tools + MCP pass-through
- dynamic worktree spawn orchestration
- dynamic tool schema generation using agent config state

Core methods (must remain behaviorally equivalent):

- `executeTool`
- file tools: `readFile`, `writeFile`, `listFiles`
- command tools: `runCommand`, `executeManagedCommand`, `executeExternalCommand`
- worktree: `spawnGitWorktreeTool`, `executeWorktreeSynchronously`
- agent gating: `resolveAgent`, `parseWorktreeArgs`
- schema: `getAvailableTools` with dynamic enum/description

### `beta/src/cli/commands/agent.ts` (118 lines)

Exports:

- `AgentCommandOptions`
- `registerAgentCommand`
- `AgentConversationOptions`
- `runAgentConversation`
- `logToolCallEvent`

Role:

- user-facing one-shot command
- session lifecycle wrapper
- completion reporting

### `beta/src/cli/spawn-handlers.ts` (63 lines)

Exports:

- `createPoeCodeSpawnHandler`

Role:

- bridges generic spawn command with built-in poe agent runtime
- parses `--model` and `--api-key`

### `beta/src/cli/commands/configure-agents.ts` (91 lines)

Exports:

- `registerConfigureAgentsCommand`

Role:

- interactive agent enable/disable editor
- explicitly not to be restored in interactive form under the new requirement

## Behavioral invariants to preserve

These are architecture-level invariants, not implementation trivia.

1. Adapter resolution before execution
   - no direct command-specific logic in callsites
   - registry decides adapter + capabilities

2. Config-gated spawn availability
   - enabled/disabled agent state must affect both schema and execution
   - disabled agent must fail clearly at runtime

3. Synchronous execution only
   - no detached/background spawn path
   - tool execution completes within turn lifecycle

4. Bounded tool-call iteration
   - chat engine cannot loop indefinitely on recursive tool plans

5. Non-interactive determinism
   - no runtime prompt side effects
   - errors over prompts when input missing

## Runtime sequence diagrams

### One-shot agent command

```text
CLI agent command
  -> createAgentSession
    -> McpManager.connectAll
    -> AgentConfigManager.loadConfig
    -> DefaultToolExecutor(init)
    -> PoeChatService(init)
  -> session.sendMessage(prompt)
    -> Poe API chat completion
    -> tool calls? yes -> executor.executeTool(...) loop
    -> final assistant message
  -> session.dispose()
```

### Worktree spawn through tool call

```text
PoeChatService tool call: spawn_git_worktree
  -> DefaultToolExecutor.spawnGitWorktreeTool
    -> parseWorktreeArgs
    -> resolveAgent (registry + config gate)
    -> executeWorktreeSynchronously(...)
```

## Old-to-new file mapping (port blueprint)

Old source (`3e97549^`) -> New target (`@poe-code/poe-agent`)

- `beta/src/services/agent-session.ts` -> `packages/poe-agent/src/runtime/agent-session.ts`
- `beta/src/services/chat.ts` -> `packages/poe-agent/src/runtime/chat.ts`
- `beta/src/services/tools.ts` -> `packages/poe-agent/src/runtime/tools.ts`
- `beta/src/services/agent-registry.ts` -> `packages/poe-agent/src/runtime/agent-registry.ts`
- `beta/src/services/agent-config-manager.ts` -> `packages/poe-agent/src/runtime/agent-config-manager.ts`
- `beta/src/services/poe-code.ts` -> `packages/poe-agent/src/runtime/spawn-poe-agent.ts`
- `beta/src/cli/commands/agent.ts` logic -> either:
  - `packages/poe-agent/src/entrypoints/run-agent-command.ts`, or
  - retained as root CLI command delegating into package API

Intentionally not ported in restored target:

- `beta/src/services/agent-task-registry.ts`
- `beta/src/services/task-runner.ts`

## Integration boundaries with current code

Current code already provides good seams:

- provider discovery: `src/providers/index.ts` (file-based auto-load)
- generic spawn command: `src/cli/commands/spawn.ts`
- SDK spawn orchestration: `src/sdk/spawn.ts` + `src/sdk/spawn-core.ts`

Restoration should plug into these seams by adding one provider file:

- `src/providers/poe-agent.ts`

No new shared branching should be introduced in:

- `src/cli/commands/spawn.ts`
- `src/sdk/spawn.ts`

## Notes on intentional deltas from historical code

These are acceptable architecture deltas:

1. Remove interactive `configure agents` UI behavior.
2. Keep all execution entrypoints non-interactive.
3. Rename legacy `poe-code` adapter naming where it improves clarity (`poe-agent` naming), while preserving semantics.
4. Remove async background task runtime (`agent-task-registry`, `task-runner`) from the restored target.

Everything else should default to parity with `3e97549^` unless a test or architectural constraint forces change.
