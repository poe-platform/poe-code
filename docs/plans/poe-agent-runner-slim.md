---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: move-transcript
    title: Move transcript writer
    prompt: |
      Move the transcript writer from packages/superintendent/src/commands/poe-agent-transcript.ts to packages/poe-agent/src/runtime/transcript.ts. Keep the TranscriptFsApi injection point and preserve the existing ACP JSONL mapping from AcpEvent to SessionUpdate. Re-export the writer from the poe-agent package index, and migrate any transcript tests from superintendent to poe-agent using memfs. After this change, transcript writing should live entirely in @poe-code/poe-agent with no superintendent-specific logic left in the writer.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: enrich-run
    title: Enrich agent run
    prompt: |
      Update packages/poe-agent/src/agent.ts and any related runtime types so AgentRunOptions accepts onStdout?: (chunk: string) => void and logPath?: string. Make builder.run() aggregate the same data the superintendent runner currently collects from builder.stream(), including output, messages, toolCalls, usage, logFile, exitCode, and stderr. When logPath is provided, write ACP-formatted JSONL to that file and create parent directories as needed. In run() only, rescue session.error into exitCode: 1 and stderr instead of throwing; keep stream() and acp() error semantics unchanged. Preserve compatibility for existing callers such as agent.run('hello').
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: policy-undefined-mode
    title: Relax policy mode
    prompt: |
      Update packages/poe-agent/src/plugins/poe-agent-plugin-policy.ts so PolicyPluginOptions.mode accepts SpawnMode | undefined instead of requiring SpawnMode. When mode is undefined, have preToolUse return early with the same permissive behavior as the existing yolo path so callers can always wire policyPlugin({ mode: input.mode }) without branching or casting. Add or update tests to cover the undefined-mode behavior alongside the existing yolo-style expectations.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: add-mcp-map-overload
    title: Add MCP map overload
    prompt: |
      Extend packages/poe-agent/src/agent.ts so .mcp() supports both the existing array-based McpServerConfig inputs and a map-based McpSpawnConfig input shaped like Record<name, server>. Perform the Record-to-array conversion inside poe-agent so superintendent callers can pass .mcp(input.mcpServers ?? {}) directly with no toPoeMcpConfigs helper. Keep the existing array overload working for current callers.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: collapse-log-path
    title: Collapse log path input
    prompt: |
      Update packages/superintendent/src/runtime/loop.ts so AgentRunInput replaces the correlated optional fields logDir and logFileName with a single logPath?: string. Join the path once where those values are originally produced, then update every runner that consumes the input—claude, codex, opencode, and poe-agent—to read logPath directly instead of rebuilding it. Keep the rest of the superintendent loop contracts unchanged.
    status:
      implement: done
      refactor: done
      test: done
      commit: open

  - id: slim-execute-poe-agent
    title: Slim executePoeAgent
    prompt: |
      Rewrite packages/superintendent/src/commands/poe-agent-runner.ts so executePoeAgent parses the model from parseAgentSpecifier(agentSpec), throws when the model is missing, builds the plugin chain, calls .mcp(input.mcpServers ?? {}), and finishes with a single .run(input.prompt, ...) call. Remove the manual event loop, result mapping, conditional policy wiring, and any toPoeMcpConfigs-style helper. Make ExecutePoeAgentResult a direct alias of the enriched poe-agent RunResult, update the runner tests to assert the same observable behavior through the new run path, and delete packages/superintendent/src/commands/poe-agent-transcript.ts once the transcript writer has moved.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
---

# Slim poe-agent runner

Make [`executePoeAgent`](../../packages/superintendent/src/commands/poe-agent-runner.ts) read as a plugin list plus one call. Everything else moves into `@poe-code/poe-agent`.

## Target

```ts
export async function executePoeAgent(
  agentSpec: string,
  input: AgentRunInput
): Promise<ExecutePoeAgentResult> {
  const { model } = parseAgentSpecifier(agentSpec);
  if (!model) {
    throw new Error(`poe-agent requires a model in the specifier; got "${agentSpec}".`);
  }

  return agent()
    .model(model)
    .use(openaiResponsesPlugin())
    .use(openaiChatCompletionsPlugin())
    .use(systemPromptPlugin())
    .use(environmentPlugin(input.cwd))
    .use(filesPlugin({ cwd: input.cwd }))
    .use(shellPlugin({ cwd: input.cwd }))
    .use(webPlugin())
    .use(compactionPlugin())
    .use(skillsPlugin({ definitions: {} }))
    .use(policyPlugin({ mode: input.mode }))
    .mcp(input.mcpServers ?? {})
    .run(input.prompt, {
      cwd: input.cwd,
      signal: input.signal,
      onStdout: input.onStdout,
      logPath: input.logPath
    });
}
```

No `if` branches. No correlated-optional pairs. No manual event loop. No result mapping at the call site.

## What moves — and where

### 1. Event aggregation → `builder.run()`

Today `builder.run()` returns [`RunResult`](../../packages/poe-agent/src/runtime/types.ts#L69) (`output`, `messages`, `toolCalls`). The superintendent runner re-implements its own loop over `builder.stream()` to collect the exact same things plus `usage` and a `logFile` path.

Change: enrich `builder.run()` itself.

- Add to [`AgentRunOptions`](../../packages/poe-agent/src/agent.ts#L37):
  - `onStdout?: (chunk: string) => void` — forwarded inside the loop on `message.delta`.
  - `logPath?: string` — when set, stream-writes ACP-formatted JSONL to that path (mkdir -p the parent).
- Change `run()`'s return type to `RunResult & { usage?: UsageInfo; logFile?: string; exitCode: 0 | 1; stderr: string }`.
  - `exitCode`/`stderr` reflect the `session.error` case without throwing — today the superintendent swallows the throw and maps it to `exitCode: 1`. Doing it in `run()` lets the caller treat the result uniformly. (`stream()` + `acp()` keep throwing — only `run()` gets the rescue.)

The new `RunResult` shape is a superset; existing callers (`agent.run("hello")` in tests) still work.

### 1b. Collapse `logDir + logFileName` → `logPath` in `AgentRunInput`

[`AgentRunInput`](../../packages/superintendent/src/runtime/loop.ts#L45) carries two correlated optional fields that together encode one concept. Replace with a single `logPath?: string`. The superintendent loop already has both parts at construction — it joins once with `path.join` and passes a single field through. Every runner (claude, codex, opencode, poe-agent) reads `logPath` instead of reassembling.

### 2. Transcript writer → poe-agent package

Move [`packages/superintendent/src/commands/poe-agent-transcript.ts`](../../packages/superintendent/src/commands/poe-agent-transcript.ts) → `packages/poe-agent/src/runtime/transcript.ts`. Nothing in it is superintendent-specific — it maps `AcpEvent` → ACP `SessionUpdate` JSONL, which is a poe-agent concern (the format is determined by poe-agent's event vocabulary).

The `TranscriptFsApi` injection point stays; tests in poe-agent use `memfs` the same way superintendent does.

### 3. Policy plugin accepts `undefined` mode

Today [`PolicyPluginOptions.mode`](../../packages/poe-agent/src/plugins/poe-agent-plugin-policy.ts#L6-L8) is required `SpawnMode`, so the superintendent conditionally wires it. Change `mode` to `SpawnMode | undefined`; when undefined, `preToolUse` returns early (same as `"yolo"` at [line 33](../../packages/poe-agent/src/plugins/poe-agent-plugin-policy.ts#L33)).

Effect: `.use(policyPlugin({ mode: input.mode }))` is unconditional. No cast.

### 4. `.mcp()` accepts `McpSpawnConfig` map

Today `.mcp(...configs: McpServerConfig[])` takes an array, so the superintendent has a `toPoeMcpConfigs` helper that converts `Record<name, server>` → `Array<{ name, ...server }>`.

Add an overload: `mcp(config: McpSpawnConfig): AgentBuilder` that does the conversion internally. The array overload stays for existing callers. Effect: `.mcp(input.mcpServers ?? {})` at the call site, no helper.

## File-by-file changes

| File | Change |
|---|---|
| [`packages/poe-agent/src/agent.ts`](../../packages/poe-agent/src/agent.ts) | Extend `AgentRunOptions` (`onStdout`, `logPath`). Extend `run()` return type. Rescue `session.error` → `{ exitCode: 1, stderr }`. Add `McpSpawnConfig` overload to `.mcp()`. |
| [`packages/superintendent/src/runtime/loop.ts`](../../packages/superintendent/src/runtime/loop.ts) | `AgentRunInput`: replace `logDir` + `logFileName` with `logPath`. Update all runners (claude/codex/opencode/poe-agent) to read `logPath`. |
| [`packages/poe-agent/src/plugins/poe-agent-plugin-policy.ts`](../../packages/poe-agent/src/plugins/poe-agent-plugin-policy.ts) | `mode: SpawnMode \| undefined`; early-return in `preToolUse` when undefined. |
| `packages/poe-agent/src/runtime/transcript.ts` | **New.** Moved from superintendent. Re-export from package `index.ts` as `createTranscriptWriter`. |
| [`packages/superintendent/src/commands/poe-agent-runner.ts`](../../packages/superintendent/src/commands/poe-agent-runner.ts) | Collapses to ~30 lines: parse model → plugin chain → `.run()`. No event loop, no helper functions, no `toPoeMcpConfigs`. |
| [`packages/superintendent/src/commands/poe-agent-transcript.ts`](../../packages/superintendent/src/commands/poe-agent-transcript.ts) | **Delete.** |
| [`packages/superintendent/src/commands/poe-agent-transcript.test.ts`](../../packages/superintendent/src/commands/poe-agent-transcript.test.ts) (if exists) | Move to poe-agent. |

## Why move transcript/aggregation into poe-agent (not a superintendent helper)

The initial instinct was a `runPoeAgent(builder, input)` helper in `packages/superintendent/src/runtime/`. Rejected because:

- The event shapes (`AcpEvent`, `UsageInfo`) and the JSONL session-update mapping are poe-agent's vocabulary. Owning the aggregation in superintendent means every consumer of poe-agent who wants "run to completion with a log" re-implements the same loop.
- The `exitCode: 0 | 1` mapping is the only genuinely "shell-flavored" bit. It fits on `run()` because `run()`'s job is already "collapse a stream to a single terminal result" — adding "don't throw, tag the failure" is a small generalization.
- After the move there is no `runPoeAgent` helper in superintendent — just `executePoeAgent`, which is already the superintendent-facing entry point.

## Tests

- **poe-agent**: existing [`agent.test.ts`](../../packages/poe-agent/src/agent.test.ts) keeps passing (new fields are optional). Add: `run()` with `transcript` writes JSONL via `memfs`; `run()` rescues `session.error` into `{exitCode: 1, stderr}`; `policyPlugin({ mode: undefined })` permits all tools (mirror of the `"yolo"` test).
- **superintendent**: `poe-agent-runner.test.ts` — assertions stay the same (stdout, toolCalls, logFile), the fixture just drives through the new `.run()` path.

## Non-goals

- No change to `stream()` or `acp()` semantics — they still throw on error.
- No change to `AgentRunInput`/`AgentRunResult` in superintendent's [`loop.ts`](../../packages/superintendent/src/runtime/loop.ts). `ExecutePoeAgentResult` becomes a direct alias of poe-agent's enriched `RunResult`.
- No new package. Everything lands in `@poe-code/poe-agent`.

## Migration order

1. Move transcript writer into poe-agent (with tests migrated).
2. Add `onStdout` + `logPath` + enriched return to `builder.run()` in poe-agent (with tests).
3. Policy plugin accepts undefined mode.
4. `.mcp(McpSpawnConfig)` overload.
5. `AgentRunInput`: collapse `logDir + logFileName` → `logPath`; update sibling runners.
6. Rewrite `executePoeAgent` against the new API; delete dead helpers.
