# Poe Agent Restoration Architecture

## Context

The Poe agent runtime existed as a full sub-system and was later removed as part of beta workspace cleanup.  
The goal is to restore that runtime as a standalone package, `@poe-code/poe-agent`, and integrate it into the current provider-based architecture without reintroducing interactive flows.

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
4. Tool execution + worktree/async task execution
5. Agent registry/config and adapter dispatch

The important architectural property was that sub-agent execution was adapter-driven, not hardcoded at callsites.

## Runtime flow

The core runtime flow was:

1. CLI command (`agent` or spawn handler) resolves model/api key and creates session.
2. Session constructs:
   - MCP manager
   - task registry
   - agent registry + agent config manager
   - tool executor
   - chat service
3. Chat service sends a Poe API chat completion request.
4. If tool calls are returned, each tool is executed and tool outputs are appended back into conversation history.
5. If background tasks are spawned, task registry tracks lifecycle and completed summaries are injected into later context.
6. Final assistant message is returned to CLI caller.

That behavior is what must be preserved.

## Detailed subsystem decomposition

### 1) Command surface

`agent.ts` was a one-shot non-streaming command with explicit model/api-key options and deterministic post-run task draining.  
`spawn-handlers.ts` provided a custom spawn service handler for the built-in Poe agent path, so `spawn poe-code ...` could reuse the same conversation runtime.

Architectural value:

- command surface stayed thin
- execution logic lived in shared runtime services

### 2) Session orchestration

`agent-session.ts` was the composition root.  
It assembled all runtime dependencies and returned a stable session contract:

- `sendMessage`
- `waitForAllTasks`
- `drainCompletedTasks`
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
- sync and async worktree execution
- background process spawn and task logging
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
- `src/runtime/agent-task-registry.ts`
- `src/runtime/task-runner.ts`
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

## Migration approach

Restoration should happen in this order:

1. Port runtime internals from `3e97549^` into `packages/poe-agent`.
2. Normalize imports and boundaries so package is self-contained.
3. Enforce non-interactive behavior where historical code relied on prompts.
4. Integrate through new provider file.
5. Re-add optional one-shot `agent` command if still desired.
6. Port and adapt tests for runtime parity and current architecture.

## Testing posture

Coverage should preserve the old behavior contracts while fitting current test standards:

- unit tests for config manager, tool schema generation, and command runtime logic
- task registry behavior tests (wait/drain/lifecycle)
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

Risk: async task regressions (zombie tasks, missing completion summaries).  
Control: preserve task registry semantics and port lifecycle-focused tests.

## Decision

Restore as a package-owned runtime (`@poe-code/poe-agent`) with provider-driven integration, using `3e97549^` as the canonical source snapshot, and enforce non-interactive behavior as a first-class architectural constraint.

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
- builds MCP manager, task registry, tool executor, chat service
- enforces lifecycle (`waitForAllTasks`, `drainCompletedTasks`, `dispose`)

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
- background task process creation and task metadata streaming
- dynamic tool schema generation using agent config state

Core methods (must remain behaviorally equivalent):

- `executeTool`
- file tools: `readFile`, `writeFile`, `listFiles`
- command tools: `runCommand`, `executeManagedCommand`, `executeExternalCommand`
- worktree: `spawnGitWorktreeTool`, `executeWorktreeSynchronously`, `createBackgroundSpawner`
- agent gating: `resolveAgent`, `parseWorktreeArgs`
- schema: `getAvailableTools` with dynamic enum/description

### `beta/src/services/agent-task-registry.ts` (633 lines)

Exports:

- `AgentTask`, `ProgressUpdate`, `FsLike`, `AgentTaskRegistryOptions`
- `AgentTaskRegistry`

Role:

- persistent task state store and event queue
- progress file ingestion (`*.progress.jsonl`)
- completion queue and lifecycle notifications
- zombie process detection and cleanup
- retention/archive policy

Task data shape:

- identity: `id`, `toolName`, `args`
- runtime: `status`, `startTime`, `endTime`, `pid`, `command`
- artifacts: `logFile`, `progressFile`
- outcomes: `result`, `error`

### `beta/src/services/task-runner.ts` (209 lines)

Exports:

- `TaskRunnerOptions`
- `runTask(options)`

Role:

- child-process entrypoint for running registered tasks
- writes progress + final state through task registry and logger
- parses `--payload` runner envelope

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
- task wait/drain completion reporting

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

3. Stable task lifecycle
   - register -> update -> completion enqueue -> drain
   - no silent dropping of failed/terminated tasks

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
    -> AgentTaskRegistry(init)
    -> AgentConfigManager.loadConfig
    -> DefaultToolExecutor(init)
    -> PoeChatService(init)
  -> session.sendMessage(prompt)
    -> Poe API chat completion
    -> tool calls? yes -> executor.executeTool(...) loop
    -> final assistant message
  -> session.waitForAllTasks()
  -> session.drainCompletedTasks()
  -> session.dispose()
```

### Worktree spawn through tool call

```text
PoeChatService tool call: spawn_git_worktree
  -> DefaultToolExecutor.spawnGitWorktreeTool
    -> parseWorktreeArgs
    -> resolveAgent (registry + config gate)
    -> sync path: executeWorktreeSynchronously(...)
       or
    -> async path: taskRegistry.registerTask + background runner process
```

## Old-to-new file mapping (port blueprint)

Old source (`3e97549^`) -> New target (`@poe-code/poe-agent`)

- `beta/src/services/agent-session.ts` -> `packages/poe-agent/src/runtime/agent-session.ts`
- `beta/src/services/chat.ts` -> `packages/poe-agent/src/runtime/chat.ts`
- `beta/src/services/tools.ts` -> `packages/poe-agent/src/runtime/tools.ts`
- `beta/src/services/agent-task-registry.ts` -> `packages/poe-agent/src/runtime/agent-task-registry.ts`
- `beta/src/services/task-runner.ts` -> `packages/poe-agent/src/runtime/task-runner.ts`
- `beta/src/services/agent-registry.ts` -> `packages/poe-agent/src/runtime/agent-registry.ts`
- `beta/src/services/agent-config-manager.ts` -> `packages/poe-agent/src/runtime/agent-config-manager.ts`
- `beta/src/services/poe-code.ts` -> `packages/poe-agent/src/runtime/spawn-poe-agent.ts`
- `beta/src/cli/commands/agent.ts` logic -> either:
  - `packages/poe-agent/src/entrypoints/run-agent-command.ts`, or
  - retained as root CLI command delegating into package API

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

Everything else should default to parity with `3e97549^` unless a test or architectural constraint forces change.
