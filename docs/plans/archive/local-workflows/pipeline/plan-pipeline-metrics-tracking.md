---
kind: pipeline
version: 1
tasks:
  - id: acp-middleware-types
    title: Add AcpMiddleware type, SpawnContext, and applyMiddlewares
    prompt: >
      Create `packages/agent-spawn/src/acp/middleware.ts`.


      Define the middleware infrastructure for the ACP event pipeline:


      1. `SpawnContext` — carries mutable state through the middleware chain:
         - `sessionId: string`
         - `agent: string`
         - `events: AcpEvent[]` (accumulated events)
         - `usage: SpawnUsage` (accumulated token usage)
         - Any other spawn-relevant state

      2. `AcpMiddleware` — a function that receives a context and a `next` callback:
         ```ts
         type AcpMiddleware = (ctx: SpawnContext, next: () => Promise<void>) => Promise<void>;
         ```

      3. `applyMiddlewares(middlewares: AcpMiddleware[], ctx: SpawnContext)` — composes
         middlewares in order (onion model), calling each with the context and the rest
         of the chain as `next`.

      Export all types from the module. Add unit tests in a co-located test file.


      Reference: `docs/plans/spawn-log-capture.md` and `docs/plans/pipeline-metrics-tracking.md`
      Phase 1 steps 1.
    status:
      implement: done
      test: done
  - id: session-capture-middleware
    title: Extract sessionCapture middleware from spawnStreaming
    prompt: |
      Create `packages/agent-spawn/src/acp/middlewares/session-capture.ts`.

      Extract the session/event accumulation logic currently inline in `spawnStreaming()`
      (in `packages/agent-spawn/src/acp/spawn.ts`) into a standalone `AcpMiddleware`.

      The `sessionCapture` middleware should:
      - Accumulate ACP events into `ctx.events` as they stream through
      - Build the final `SessionResult` (output, messages, toolCalls) from accumulated events
      - Not modify the event stream itself — just observe and collect

      Import `AcpMiddleware` and `SpawnContext` from `../middleware.ts`.

      Add unit tests verifying event accumulation behavior.

      Reference: `docs/plans/pipeline-metrics-tracking.md` Phase 1 step 2.
    status:
      implement: done
      test: done
  - id: usage-capture-middleware
    title: Extract usageCapture middleware from spawnStreaming
    prompt: |
      Create `packages/agent-spawn/src/acp/middlewares/usage-capture.ts`.

      Extract the token usage tracking logic currently inline in `spawnStreaming()`
      (in `packages/agent-spawn/src/acp/spawn.ts`) into a standalone `AcpMiddleware`.

      The `usageCapture` middleware should:
      - Track `inputTokens`, `outputTokens`, and `cachedTokens` from model response events
      - Accumulate totals into `ctx.usage` (`SpawnUsage` type)
      - Not modify the event stream — just observe and accumulate

      Import `AcpMiddleware` and `SpawnContext` from `../middleware.ts`.

      Add unit tests verifying usage accumulation from mock events.

      Reference: `docs/plans/pipeline-metrics-tracking.md` Phase 1 step 3.
    status:
      implement: done
      test: done
  - id: simplify-spawn-streaming
    title: Simplify spawnStreaming to yield raw events only
    prompt: |
      Refactor `packages/agent-spawn/src/acp/spawn.ts`.

      Remove inline session capture and usage tracking logic from `spawnStreaming()`.
      After this change, `spawnStreaming()` should only yield raw ACP events — all
      accumulation and side effects are handled by middlewares composed externally.

      The function signature and event stream contract must remain the same for callers.
      The middleware composition happens at the SDK layer (next task), not here.

      Add/update unit tests to verify `spawnStreaming()` still yields correct raw events.

      Reference: `docs/plans/pipeline-metrics-tracking.md` Phase 1 step 4.
    status:
      implement: done
      refactor: done
      test: done
  - id: spawn-log-middleware
    title: Create spawnLog middleware for JSONL session logging
    prompt: |
      Create `packages/agent-spawn/src/acp/middlewares/spawn-log.ts`.

      Implement a `spawnLog` middleware (`AcpMiddleware`) that writes JSONL per session:

      - Each ACP event is written as one JSON line to the log file
      - Log file path is determined by `ctx.logDir` (if provided) or a default path
      - Default log path convention: `{logDir}/{YYYYMMDD}-{HHmmss}-{ms}-{agent}.jsonl`
      - The middleware creates the log directory if it doesn't exist
      - File handle is opened on first event and closed when the middleware completes
      - Errors during logging should be caught and not interrupt the event stream

      Import `AcpMiddleware` and `SpawnContext` from `../middleware.ts`.

      Use `memfs` for unit tests per project testing guidelines — do not create real files.

      Reference: `docs/plans/pipeline-metrics-tracking.md` Phase 1 step 5.
    status:
      implement: done
      test: done
  - id: wire-middlewares-in-sdk
    title: Wire middlewares in SDK spawn and add log dir resolver
    prompt: |
      Two changes:

      **File**: `src/sdk/spawn.ts`

      Compose the middleware pipeline in the SDK spawn layer:
      - Import `applyMiddlewares` from `packages/agent-spawn/src/acp/middleware.ts`
      - Import `sessionCapture`, `usageCapture`, `spawnLog` middlewares
      - In the SDK `spawn()` function, create a `SpawnContext` and apply the middleware
        chain around the raw `spawnStreaming()` call
      - The middleware order should be: sessionCapture → usageCapture → spawnLog

      **File**: `src/cli/environment.ts`

      Add `resolveSpawnLogDir(homeDir: string): string` that returns the default
      spawn log directory path: `{homeDir}/.poe-code/spawn-logs/`

      Add unit tests for the log dir resolver. Integration test for middleware wiring
      can use the simulation/mock approach.

      Reference: `docs/plans/pipeline-metrics-tracking.md` Phase 1 steps 6-7.
    status:
      implement: done
      test: done
  - id: commit-spawn-middleware
    title: Commit ACP middleware pipeline and spawn log capture
    prompt: |
      Commit all Phase 1 work:
      - AcpMiddleware type, SpawnContext, applyMiddlewares
      - sessionCapture, usageCapture, spawnLog middlewares
      - Simplified spawnStreaming (raw events only)
      - SDK middleware wiring and log dir resolver

      Run `npm run test && npm run lint` before committing.

      Commit message: `feat(agent-spawn): add ACP event middleware pipeline with spawn logging`
    status:
      commit: done
  - id: propagate-usage-sdk
    title: Propagate token usage through SDK spawn return paths
    prompt: |
      **File**: `src/sdk/types.ts`

      Add `SpawnUsage` interface if not already present:
      ```typescript
      export interface SpawnUsage {
        inputTokens: number;
        outputTokens: number;
        cachedTokens?: number;
      }
      ```

      Add `usage?: SpawnUsage` to the SDK `SpawnResult` type.

      **File**: `src/sdk/spawn.ts`

      In all 3 return paths that destructure `SpawnResult` (around lines 105-109,
      129-135, 159-165):
      - Include usage in the returned object: `...(final.usage ? { usage: final.usage } : {})`

      The `spawnNonStreaming` path (around line 170) already returns the full
      `SpawnResult` — verify it needs no change.

      Add unit tests verifying usage propagation in each return path.

      Reference: `docs/plans/pipeline-metrics-tracking.md` Phase 2.
    status:
      implement: done
      test: done
  - id: commit-usage-propagation
    title: Commit token usage propagation through SDK spawn
    prompt: |
      Commit Phase 2 work:
      - SpawnUsage type added to SDK types
      - Usage propagated through all SDK spawn return paths

      Run `npm run test && npm run lint` before committing.

      Commit message: `feat: propagate token usage through SDK spawn`
    status:
      commit: done
  - id: pipeline-metrics-types
    title: Add AgentRunUsage, PipelineMetrics types to pipeline
    prompt: |
      **File**: `packages/pipeline/src/types.ts`

      Add the following types:

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

      Extend existing interfaces:
      - Add `usage?: AgentRunUsage` to `AgentRunResult`
      - Add `metrics: PipelineMetrics` to `PipelineRunResult`
      - Extend `onTaskComplete` callback signature with `usage?: AgentRunUsage`

      **File**: `packages/pipeline/src/index.ts`

      Export `AgentRunUsage` and `PipelineMetrics` from the package barrel.

      Reference: `docs/plans/pipeline-metrics-tracking.md` Phase 3.
    status:
      implement: done
  - id: pipeline-metrics-accumulation
    title: Accumulate metrics in runPipeline
    prompt: |
      **File**: `packages/pipeline/src/run/pipeline.ts`

      Modify the `runPipeline` function to track and accumulate metrics:

      1. Initialize a `PipelineMetrics` object (all zeros) before the while loop
      2. After each `runAgent()` call completes:
         - If `result.usage` exists, accumulate `inputTokens`, `outputTokens`,
           `cachedTokens` into the metrics totals
         - Increment `stepsCompleted` for each agent run
         - Increment `tasksCompleted` or `tasksFailed` based on result status
      3. Include `metrics` in every return path of `PipelineRunResult`

      Pass `usage` to the `onTaskComplete` callback when available.

      Update existing tests and add new tests verifying:
      - Single task with usage → metrics accumulation correct
      - Multi-step with mixed usage (some present, some undefined) → totals correct
      - Failed tasks increment `tasksFailed`

      Reference: `docs/plans/pipeline-metrics-tracking.md` Phase 3.
    status:
      implement: done
      test: done
  - id: commit-pipeline-metrics
    title: Commit pipeline metrics types and accumulation
    prompt: |
      Commit Phase 3 work:
      - AgentRunUsage and PipelineMetrics types
      - Metrics accumulation in runPipeline
      - Updated tests

      Run `npm run test && npm run lint` before committing.

      Commit message: `feat(pipeline): add AgentRunUsage and PipelineMetrics with accumulation`
    status:
      commit: done
  - id: pipeline-log-dir-override
    title: Route spawn logs to plan directory via pipeline
    prompt: |
      **File**: `packages/pipeline/src/types.ts`

      Add `logDir?: string` to `PipelineRunOptions`.
      Add `logDir?: string` to `AgentRunInput`.

      **File**: `packages/pipeline/src/run/pipeline.ts`

      Pass `logDir` from `PipelineRunOptions` through to each `runAgent()` call
      via `AgentRunInput`. When pipeline provides a `logDir`, the SDK spawn should
      write logs under that directory instead of the default `~/.poe-code/spawn-logs/`.

      Pipeline log dir convention: `{planDir}/logs/{taskId}-{stepName}.jsonl`

      The SDK spawn must accept the `logDir` option and pass it to the `spawnLog`
      middleware. Update `src/sdk/spawn.ts` if needed to accept and forward `logDir`.

      Add tests verifying:
      - When `logDir` is provided, it flows through to the agent run
      - When `logDir` is not provided, the default log path is used

      Reference: `docs/plans/pipeline-metrics-tracking.md` Phase 4.
    status:
      implement: done
      test: done
  - id: commit-pipeline-log-dir
    title: Commit pipeline log directory override
    prompt: |
      Commit Phase 4 work:
      - logDir option added to PipelineRunOptions and AgentRunInput
      - logDir passthrough in runPipeline to runAgent
      - SDK spawn logDir forwarding

      Run `npm run test && npm run lint` before committing.

      Commit message: `feat(pipeline): route spawn logs to plan directory`
    status:
      commit: done
  - id: simulation-usage-support
    title: Add usage support to simulation harness
    prompt: |
      **File**: `packages/pipeline/src/testing/simulation.ts`

      - Add `usage?: AgentRunUsage` to `TurnOutput` type
      - Update `normalizeAgentResult()` to include `usage` from the turn output

      **File**: `packages/pipeline/src/testing/simulation.test.ts`

      Add new tests:
      - Test: single task with usage → verify `result.metrics` accumulates correctly
      - Test: multi-step with mixed usage (some turns have usage, some don't) → verify totals
      - Update existing tests to assert `result.metrics` exists and has correct shape

      Reference: `docs/plans/pipeline-metrics-tracking.md` Phase 5.
    status:
      implement: done
      test: done
  - id: commit-simulation-usage
    title: Commit simulation harness usage support
    prompt: |
      Commit Phase 5 work:
      - TurnOutput usage support
      - normalizeAgentResult usage propagation
      - New and updated simulation tests

      Run `npm run test && npm run lint` before committing.

      Commit message: `test(pipeline): add usage support to simulation harness`
    status:
      commit: done
  - id: sdk-reexports-cli-display
    title: Re-export types from SDK and display metrics in CLI
    prompt: |
      **File**: `src/sdk/pipeline.ts`

      Re-export `AgentRunUsage` and `PipelineMetrics` from the SDK pipeline module
      so consumers of the SDK can access these types.

      **File**: `src/cli/commands/pipeline.ts`

      Update the CLI pipeline command output:
      - In `onTaskComplete` callback: append token info when `progress.usage` exists
        (e.g., "tokens: 1234 in / 567 out")
      - In run summary (after pipeline completes): show total tokens from `result.metrics`
        (e.g., "Total tokens: 5000 input, 2000 output, 1000 cached")
      - Show `tasksCompleted`, `tasksFailed`, `stepsCompleted` counts

      Use the project's design system for formatting — do not use chalk or
      @clack/prompts directly.

      Test the visual output with `npm run screenshot-poe-code -- pipeline run`.

      Reference: `docs/plans/pipeline-metrics-tracking.md` Phase 6.
    status:
      implement: done
      test: done
  - id: commit-sdk-cli-metrics
    title: Commit SDK re-exports and CLI metrics display
    prompt: |
      Commit Phase 6 work:
      - SDK re-exports of AgentRunUsage and PipelineMetrics
      - CLI pipeline metrics display

      Run `npm run test && npm run lint` before committing.

      Commit message: `feat: display pipeline metrics in CLI summary`
    status:
      commit: open
  - id: final-verification
    title: Run full verification suite
    prompt: |
      Run the full verification suite as described in the plan:

      1. `npm run test` — all middleware tests, simulation tests with metrics pass
      2. `npm run lint` — no type errors
      3. `npm run e2e:verbose` — all e2e tests pass
      4. `npm run screenshot-poe-code -- pipeline run` — visual check of metrics display

      Fix any failures found. Do not skip tests or use --no-verify.
    status:
      test: open
---

# pipeline metrics tracking

Archived local pipeline plan converted from YAML during docs cleanup.
