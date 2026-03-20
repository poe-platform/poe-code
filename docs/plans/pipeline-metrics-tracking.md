# Pipeline Metrics Tracking

## Context

Token usage data (`SpawnUsage`) is captured during `spawnStreaming()` in agent-spawn but is **dropped** at two boundaries:
1. **SDK spawn** (`src/sdk/spawn.ts:159-165`): Destructures `SpawnResult` and omits `usage`
2. **Pipeline types** (`packages/pipeline/src/types.ts`): `AgentRunResult` has no `usage` field

Result: `PipelineRunResult` has `totalDurationMs` and `runsCompleted` but zero token information. The goal is to propagate usage from spawn through the full chain, with pipeline only aggregating.

Additionally, spawn sessions should be logged (JSONL) per the existing `docs/plans/spawn-log-capture.md` plan. Pipeline overrides the log directory so all task session logs are grouped under the plan name.

## Plan

### Phase 1: Spawn log capture (prerequisite — from spawn-log-capture.md)

Implement the middleware pipeline from the existing plan:

1. Add `AcpMiddleware` type, `SpawnContext`, `applyMiddlewares()` in `packages/agent-spawn/src/acp/middleware.ts`
2. Extract `sessionCapture` middleware from inline code in `spawnStreaming()`
3. Extract `usageCapture` middleware from inline code in `spawnStreaming()`
4. Simplify `spawnStreaming()` to yield raw events only
5. Create `spawnLog` middleware — writes JSONL per session
6. Wire middlewares in SDK `src/sdk/spawn.ts`
7. Add `resolveSpawnLogDir(homeDir)` to `src/cli/environment.ts`

Default log dir: `~/.poe-code/spawn-logs/{YYYYMMDD}-{HHmmss}-{ms}-{agent}.jsonl`

### Phase 2: Propagate usage through SDK spawn

**File**: `src/sdk/types.ts`

Add `SpawnUsage` interface and `usage?: SpawnUsage` to SDK `SpawnResult`:

```typescript
export interface SpawnUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
}
```

**File**: `src/sdk/spawn.ts`

In all 3 return paths that destructure (lines 105-109, 129-135, 159-165):
- Include `...(final.usage ? { usage: final.usage } : {})`

The `spawnNonStreaming` path (line 170) already returns the full `SpawnResult` — no change needed.

### Phase 3: Pipeline types and metrics aggregation

**File**: `packages/pipeline/src/types.ts`

```typescript
export interface AgentRunUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
}

export interface PipelineMetrics {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  tasksCompleted: number;
  tasksFailed: number;
  stepsCompleted: number;
}
```

- Add `usage?: AgentRunUsage` to `AgentRunResult`
- Add `metrics: PipelineMetrics` to `PipelineRunResult`
- Extend `onTaskComplete` callback with `usage?: AgentRunUsage`
- Export new types from `packages/pipeline/src/index.ts`

**File**: `packages/pipeline/src/run/pipeline.ts`

- Initialize `metrics` (all zeros) before the while loop
- After each `runAgent()`: accumulate `result.usage` into metrics
- Track `tasksCompleted`/`tasksFailed`/`stepsCompleted`
- Include `metrics` in every return path

### Phase 4: Pipeline log directory override

**File**: `packages/pipeline/src/types.ts`

Add `logDir?: string` to `PipelineRunOptions`.

**File**: `packages/pipeline/src/run/pipeline.ts`

Pass `logDir` through to `runAgent()` input so the SDK spawn can write logs under the plan directory.

**File**: `packages/pipeline/src/types.ts`

Add `logDir?: string` to `AgentRunInput`.

**SDK wiring**: When pipeline provides a `logDir`, SDK `spawn()` passes it to the `spawnLog` middleware instead of the default `~/.poe-code/spawn-logs/`.

Pipeline log dir convention: `{planDir}/logs/{taskId}-{stepName}.jsonl`

### Phase 5: Simulation harness + tests

**File**: `packages/pipeline/src/testing/simulation.ts`

- Add `usage?: AgentRunUsage` to `TurnOutput`
- Update `normalizeAgentResult()` to include `usage`

**File**: `packages/pipeline/src/testing/simulation.test.ts`

- Test: single task with usage → verify `result.metrics` accumulation
- Test: multi-step with mixed usage → verify totals
- Update existing tests to assert `result.metrics` exists

### Phase 6: SDK re-exports + CLI display

**File**: `src/sdk/pipeline.ts` — re-export `AgentRunUsage`, `PipelineMetrics`

**File**: `src/cli/commands/pipeline.ts`

- In `onTaskComplete`: append token info when `progress.usage` exists
- In run summary: show total tokens from `result.metrics`

## Critical Files

| File | Change |
|------|--------|
| `packages/agent-spawn/src/acp/middleware.ts` | New — middleware types + compose |
| `packages/agent-spawn/src/acp/middlewares/session-capture.ts` | New — extract from spawnStreaming |
| `packages/agent-spawn/src/acp/middlewares/usage-capture.ts` | New — extract from spawnStreaming |
| `packages/agent-spawn/src/acp/middlewares/spawn-log.ts` | New — JSONL writer |
| `packages/agent-spawn/src/acp/spawn.ts` | Simplify — remove inline concerns |
| `src/sdk/types.ts` | Add SpawnUsage, extend SpawnResult |
| `src/sdk/spawn.ts` | Propagate usage + compose middlewares |
| `src/cli/environment.ts` | Add resolveSpawnLogDir |
| `packages/pipeline/src/types.ts` | New types, extend interfaces |
| `packages/pipeline/src/index.ts` | Export new types |
| `packages/pipeline/src/run/pipeline.ts` | Accumulate metrics, pass logDir |
| `packages/pipeline/src/testing/simulation.ts` | Support usage in turns |
| `packages/pipeline/src/testing/simulation.test.ts` | Metrics tests |
| `src/sdk/pipeline.ts` | Re-export new types |
| `src/cli/commands/pipeline.ts` | Display metrics |

## What NOT to change

- **ACP core / poe-agent**: No changes. Real token data comes from spawn adapters.
- **Local host**: Not its responsibility.

## Commit sequence

1. `feat(agent-spawn): add ACP event middleware pipeline` (Phase 1 steps 1-4)
2. `feat(agent-spawn): add spawn log middleware` (Phase 1 step 5)
3. `feat: wire spawn middlewares in SDK and add log dir resolver` (Phase 1 steps 6-7)
4. `feat: propagate token usage through SDK spawn` (Phase 2)
5. `feat(pipeline): add AgentRunUsage and PipelineMetrics types` (Phase 3 types)
6. `feat(pipeline): accumulate metrics in runPipeline` (Phase 3 accumulation + Phase 5 tests)
7. `feat(pipeline): route spawn logs to plan directory` (Phase 4)
8. `feat: display pipeline metrics in CLI summary` (Phase 6)

## Verification

1. `npm run test` — middleware tests, simulation tests with metrics
2. `npm run lint` — no type errors
3. `npm run dev -- spawn claude-code "Hello"` → verify JSONL in `~/.poe-code/spawn-logs/`
4. `npm run e2e:verbose` — e2e tests pass
5. `npm run screenshot-poe-code -- pipeline run` — visual check of metrics display
