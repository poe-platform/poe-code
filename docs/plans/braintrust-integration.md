---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: add-config-scope
    title: Add integrations.braintrust scope to poe-code-config
    prompt: |
      In packages/poe-code-config/src/schema.ts, register a new scope named
      "integrations" using the existing `defineScope(...)` helper. Under it
      add a single key `braintrust` shaped as:

        enabled: boolean (default false)
        apiKey:  string  (optional)
        apiUrl:  string  (optional)
        project: string  (optional)

      Wire the new scope into the same place every other scope is exported
      from this package's index. Update any union/registry types so the new
      block type-checks. Add unit tests under packages/poe-code-config/src
      that verify: a config with no `integrations` block parses; a config
      with `enabled: false` parses without apiKey/project; a config with
      `enabled: true` parses (cross-field validation lives elsewhere).
      Use memfs for any disk reads. No env interpolation logic in this task
      — that already lives in the config layer.

    status:
      implement: open

  - id: create-braintrust-package
    title: Create @poe-code/braintrust workspace package skeleton
    prompt: |
      Create a new private workspace package at packages/braintrust.

      Files:
        package.json — name "@poe-code/braintrust", "private": true,
          "type": "module", peerDependencies: { "braintrust": "*" },
          peerDependenciesMeta: { "braintrust": { "optional": true } }.
          dependencies: workspace pointers to "@poe-code/agent-spawn",
          "@poe-code/pipeline", "@poe-code/superintendent",
          "@poe-code/experiment-loop", "@poe-code/poe-code-config".
          devDependencies: vitest matching the workspace version.
        tsconfig.json — extend the workspace base tsconfig used by other
          packages (copy from a sibling like packages/file-lock).
        src/index.ts — empty for now (export {}).
        README.md — one-line stub; full content lands in a later task.

      Add the new package to root package.json workspaces (it should be
      picked up automatically by the existing pattern, verify). Run
      `npm install` at the repo root and confirm the workspace resolves.
      Do not write any feature code yet.

    status:
      implement: open

  - id: impl-redact
    title: Implement redact()
    prompt: |
      In packages/braintrust/src/redact.ts implement and export:

        export function redact(value: unknown): unknown;

      Rules:
        - If value is a string and its UTF-8 byte length exceeds 65536,
          return "[truncated:<originalBytes>]".
        - If value is a Buffer/Uint8Array containing a 0x00 byte in the
          first 1024 bytes, return "[binary:<bytes>]".
        - Otherwise recurse into objects and arrays (returning new
          structures) applying the same rules to leaves.
        - If the JSON-serialised size of the entire value exceeds 262144,
          replace the whole value with "[truncated:<originalBytes>]".
          Compute the byte length once at the top, do not double-walk.

      TDD: write tests in packages/braintrust/src/redact.test.ts first
      covering each rule and a nested-structure case where unaffected
      leaves are preserved. No filesystem touched.

    status:
      implement: open

  - id: impl-client
    title: Implement BraintrustClient wrapper
    prompt: |
      In packages/braintrust/src/client.ts implement a thin wrapper around
      the Braintrust SDK. Public exports:

        export interface BraintrustClient {
          getRootLogger(): Promise<unknown>;        // SDK Logger
          getExperiment(name: string): Promise<unknown>; // SDK Experiment
          flush(timeoutMs: number): Promise<void>;
          recordError(err: unknown, ctx: string): void;
          status(): { lastError: string | null; errorCount: number;
                      project: string };
        }
        export function createClient(opts: {
          apiKey: string; apiUrl?: string; project: string;
        }): BraintrustClient;

      Behaviour:
        - The SDK is loaded via `await import("braintrust")` lazily on
          first use. Cache the loaded module on the client instance.
        - `getRootLogger` calls SDK `initLogger({ projectName, apiKey,
          apiUrl })` once and caches the result.
        - `getExperiment(name)` calls `initExperiment({ projectName,
          experimentName: name, apiKey, apiUrl })` once per name and
          caches by name.
        - `flush(timeoutMs)` calls `Promise.race` between the SDK's
          `flush()` (across logger and all cached experiments) and a
          timeout that resolves silently.
        - `recordError` updates internal state used by `status()`. Never
          throws.
        - All SDK calls are wrapped in try/catch; errors call
          `recordError` and are swallowed. The orchestrator never sees
          a Braintrust failure.

      TDD: tests in client.test.ts using vi.mock("braintrust", ...) to
      stub initLogger/initExperiment/flush. Cover: lazy import only on
      first use, caching, flush timeout, error recording, status output.

    status:
      implement: open

  - id: impl-trace-run
    title: Implement traceRun()
    prompt: |
      In packages/braintrust/src/trace-run.ts implement and export:

        export type TraceSurface =
          "pipeline" | "superintendent" | "experiment" | "spawn";

        export function makeTraceRun(client: BraintrustClient): <T>(
          surface: TraceSurface,
          name: string,
          fn: () => Promise<T>
        ) => Promise<T>;

      Behaviour:
        - Resolves the SDK's `traced` function via the client's lazy
          import path (don't statically import braintrust).
        - Calls `traced(fn, { name: "<surface>:<name>", type: "task" })`
          and returns its promise.
        - On any setup failure (SDK missing, init error), records via
          client.recordError and falls back to running `fn()` directly
          so the orchestrator runs to completion.
        - Adds a tag `surface:<surface>` to the root span when the SDK
          API allows tags on `traced` (verify against the SDK; if not,
          set the tag via `currentSpan().log({ tags: ... })` inside the
          wrapper).

      TDD: tests in trace-run.test.ts with mocked SDK confirming the
      span name, type, surface tag, and error fallback path.

    status:
      implement: open

  - id: impl-span-builder
    title: Implement logSpawnSession()
    prompt: |
      In packages/braintrust/src/span-builder.ts implement:

        export async function logSpawnSession(
          client: BraintrustClient,
          ctx: SpawnContext
        ): Promise<void>;

      `SpawnContext` is imported from "@poe-code/agent-spawn".

      Behaviour:
        - Lazy-import braintrust to get `currentSpan`.
        - Open an agent span as a child of `currentSpan()` (which the
          spawn middleware will arrange — see adapters task). The span:
            name: `agent:${ctx.agent}:${ctx.model ?? "?"}`
            type: "task"
        - Walk ctx.events (AcpEvent[]) and emit child spans for tool
          calls: each ToolCall opens a span with type "tool", name
          `tool_call:${tc.kind ?? "unknown"}`, input from tc.input,
          output assembled from matching ToolCallUpdate events.
        - On the agent span call .log with:
            input:    { prompt: ctx.prompt, mode: ctx.mode, cwd: ctx.cwd }
            output:   <accumulated agent message text from ctx.events>
            metadata: { sessionId: ctx.sessionId, threadId: ctx.threadId }
            metrics:  { prompt_tokens, completion_tokens, tokens,
                        prompt_cached_tokens, prompt_cache_creation_tokens,
                        durationMs }
              — pull from ctx.usage; missing fields omitted, not zeroed.
        - All inputs/outputs go through redact() before .log().
        - On exception while building, call client.recordError and
          return; never throw.

      TDD: tests in span-builder.test.ts using a fixture event sequence
      (text + tool_call + tool_call_update + agent_message_chunk).
      Assert the order of startSpan/log/end calls and that token counts
      land in `metrics` under canonical keys.

    status:
      implement: open

  - id: impl-row-builder
    title: Implement orchestrator span/row helpers
    prompt: |
      In packages/braintrust/src/row-builder.ts implement helpers that
      open child spans on currentSpan() for orchestrator events. All
      helpers swallow errors via client.recordError.

        // Pipeline — opens a span on onTaskStart, logs on onTaskComplete.
        export function makePipelineRowState(client: BraintrustClient): {
          start(progress: TaskProgress): void;
          complete(progress: TaskCompletion): void;
        };

        // Superintendent — one helper per role pair.
        export function logSuperintendentRole(
          client: BraintrustClient,
          role: "builder" | "inspector" | "superintendent" | "owner",
          result: unknown   // BuilderResult | InspectorResult | ...
        ): Promise<void>;

        // Experiment-loop — opens an iteration span on the experiment
        // (so it is also a row), populated across multiple callbacks.
        export function makeExperimentIterationState(
          client: BraintrustClient,
          experimentName: string
        ): {
          start(index: number, agent: string): Promise<void>;
          baseline(b: Record<string, number>): void;
          metric(name: string, value: number): void;
          commit(hash: string): void;
          reset(hash: string): void;
          complete(index: number, entry: JournalEntry): Promise<void>;
        };

      Span shapes per docs/plans contract:
        - Pipeline step span: type "task", name `step:<step>:<index>`,
          input { step_name, step_prompt, plan_section }, output
          { result_summary, files_changed, success }, scores
          { passed: success ? 1 : 0 }, metrics with usage + durationMs
          from TaskCompletion.
        - Superintendent role span: type "task", name `role:<role>`,
          input/output from result. For inspector: scores
          { satisfied: 0|1 } from the verdict.
        - Experiment iteration span: opened via
          `experiment.startSpan({ name: "iteration:<n>", type: "task" })`,
          input { brief, baseline, agent, iteration }, output
          { diff_summary, kept }, scores including `delta` vs baseline.

      Import only types from @poe-code/pipeline, @poe-code/superintendent,
      @poe-code/experiment-loop. Never call into them at runtime.
      All inputs/outputs go through redact().

      TDD: tests in row-builder.test.ts asserting the payload passed to
      span.log for each surface.

    status:
      implement: open

  - id: impl-spawn-adapter
    title: Implement spawn AcpMiddleware adapter
    prompt: |
      In packages/braintrust/src/adapters/spawn.ts implement and export:

        export function createSpawnMiddleware(
          client: BraintrustClient
        ): AcpMiddleware;

      `AcpMiddleware` comes from "@poe-code/agent-spawn".

      Behaviour:
        - Run `await next()` first so the spawn completes and ctx.events
          / ctx.usage / ctx.sessionResult are populated.
        - Wrap the call in try/finally; in finally call
          `await logSpawnSession(client, ctx)`.
        - If `next()` threw, still log: pass an `aborted: true` flag
          through metadata so logSpawnSession can mark the span as
          aborted. Re-throw the original error after logging — middleware
          must not swallow orchestrator errors.

      TDD: tests in adapters/spawn.test.ts using a stub SpawnContext and
      a mocked logSpawnSession. Cover: happy path; next() throws (logs
      then re-throws); SDK throws inside log (swallowed via client).

    status:
      implement: open

  - id: impl-orchestrator-adapters
    title: Implement pipeline, experiment, and superintendent callback adapters
    prompt: |
      In packages/braintrust/src/adapters/ create one file per surface:

        pipeline.ts — exports
          createPipelineCallbacks(client): PipelineCallbackFields
          where PipelineCallbackFields = Pick<PipelineRunOptions,
            "onPlanResolved" | "onTaskStart" | "onTaskComplete" |
            "onLockStatusChange">.
          Wires onTaskStart/onTaskComplete to makePipelineRowState from
          row-builder.ts. The other two callbacks are no-ops in v1
          (return them anyway so the merge helper can chain them).

        experiment.ts — exports
          createExperimentCallbacks(client, experimentName):
            ExperimentCallbackFields
          where ExperimentCallbackFields = Pick<ExperimentRunOptions,
            "onExperimentStart" | "onBaselineCollected" | "onMetricResult"
            | "onCommit" | "onReset" | "onExperimentComplete">.
          Threads makeExperimentIterationState across the lifecycle.
          The experimentName argument is the name used by initExperiment;
          the bootstrap derives it from the experiment doc filename.

        superintendent.ts — exports
          createSuperintendentCallbacks(client): LoopCallbacks
          (LoopCallbacks from "@poe-code/superintendent").
          Each onXxxComplete fires logSuperintendentRole. onXxxFailed
          logs a span with metadata.error and scores { passed: 0 }.

      No core package signature changes. Import only types from the
      three core packages. Inputs/outputs already redacted by the
      row-builder helpers.

      TDD: one test file per adapter. For each, assert the right
      span/row helper is called with the right arguments for each
      callback the surface exposes.

    status:
      implement: open

  - id: impl-merge-callbacks
    title: Implement mergeCallbacks helpers (CLI side)
    prompt: |
      Add a small new module that lives next to the CLI bootstrap
      (recommend packages/poe-code-config/src/merge-callbacks.ts so it
      can be reused from any subcommand without a new package).

      Export three helpers:

        mergePipelineCallbacks(
          user: PipelineCallbackFields | undefined,
          added: PipelineCallbackFields | undefined
        ): PipelineCallbackFields | undefined;

        mergeExperimentCallbacks(...): ExperimentCallbackFields | undefined;
        mergeLoopCallbacks(
          user: LoopCallbacks | undefined,
          added: LoopCallbacks | undefined
        ): LoopCallbacks | undefined;

      Behaviour for every callback key present in either side:
        - User callback runs first; if it throws, propagate
          (their semantics must not change).
        - Added callback runs second; if it throws, swallow and
          console.warn once with the callback name.
        - If only one side has the callback, use it directly.

      Type imports only from the relevant packages. No runtime
      dependency on @poe-code/braintrust.

      TDD: tests cover ordering, user-error propagation, added-error
      swallowed, asymmetric (only-user / only-added) cases.

    status:
      implement: open

  - id: impl-bootstrap
    title: Implement @poe-code/braintrust bootstrap()
    prompt: |
      In packages/braintrust/src/index.ts implement and export the
      single public entry:

        export interface Integrations {
          spawnMiddleware?: AcpMiddleware;
          pipelineCallbacks?: PipelineCallbackFields;
          experimentCallbacks?: ExperimentCallbackFields;
          superintendentCallbacks?: LoopCallbacks;
          traceRun<T>(
            surface: TraceSurface,
            name: string,
            fn: () => Promise<T>
          ): Promise<T>;
          shutdown(): Promise<void>;
        }

        export async function bootstrap(
          config: PoeCodeConfig
        ): Promise<Integrations | null>;

      Behaviour:
        - If `config.integrations?.braintrust?.enabled !== true`,
          return null. Do not import the SDK.
        - Otherwise validate cross-field requirements: `apiKey` and
          `project` must be present and non-empty. If not, throw with
          a one-line message naming the missing field.
        - Probe `await import("braintrust")`. If it throws
          ERR_MODULE_NOT_FOUND, throw with exactly:
          "Braintrust integration is enabled but the 'braintrust'
          package is not installed. Run: npm i braintrust"
        - Create a BraintrustClient via createClient(config.integrations
          .braintrust). Wire all four adapters and traceRun off the
          same client.
        - shutdown() calls client.flush(5000).

      TDD: tests in bootstrap.test.ts using vi.mock("braintrust") to
      simulate (a) module-not-found, (b) module present and healthy.
      Cover: disabled config returns null without import; enabled
      missing apiKey throws expected message; enabled missing peer
      throws expected message; enabled + valid returns Integrations
      with all four callback fields populated.

    status:
      implement: open
      test: open

  - id: wire-cli-integrations
    title: Wire loadIntegrations into pipeline / experiment / superintendent / spawn CLI entries
    prompt: |
      In each of these CLI entry points:
        packages/pipeline/src/run/pipeline.ts (or its CLI wrapper)
        packages/experiment-loop/src/run/* (or its CLI wrapper)
        packages/superintendent/src/runtime/run-superintendent.ts (or its
          CLI wrapper)
        packages/agent-spawn/src/spawn-acp.ts (or wherever spawnStreaming
          is invoked from CLI)

      Add a small CLI-side helper file that does:

        export async function loadIntegrations(
          config: PoeCodeConfig
        ): Promise<Integrations | null> {
          if (!config.integrations?.braintrust?.enabled) return null;
          const mod = await import("@poe-code/braintrust");
          return mod.bootstrap(config);
        }

      Place it where the CLI bootstrap currently composes options
      (look for the existing place that loads config). It is the only
      module in the codebase with a static reference to
      "@poe-code/braintrust" — and it accesses it via dynamic import,
      so the package isn't loaded when disabled.

      For each subcommand entry:
        1. Call loadIntegrations(config) once at start.
        2. Wrap the existing run call in
           `integrations?.traceRun(surface, name, () => existingRun(opts))
             ?? existingRun(opts)`.
        3. Merge integrations.<surface>Callbacks into the user-supplied
           callbacks via the merge helpers from impl-merge-callbacks.
        4. Add `integrations?.shutdown()` to the process-exit / SIGINT
           path. Use the existing shutdown hook surface; do not roll a
           new one.

      Pass the spawn middleware into the agent-spawn middleware chain
      where existing middlewares are registered (see
      packages/agent-spawn/src/acp/middlewares/).

      TDD: integration tests verifying that with enabled config the
      run produces the expected callback chain order (added after user)
      and that disabled config skips the dynamic import (mock
      `loadIntegrations` and assert it returns null without touching
      "@poe-code/braintrust").

    status:
      implement: open
      test: open

  - id: impl-status-subcommand
    title: Add `poe-code braintrust status` subcommand
    prompt: |
      Add a top-level CLI subcommand `poe-code braintrust` with a
      `status` action. Follow the existing CLI command registration
      pattern used by other subcommands (search for `defineCommand`,
      `registerCommand`, or equivalent in the CLI package).

      Behaviour of `poe-code braintrust status`:
        - Loads config via the existing loader.
        - If integrations.braintrust is absent or enabled is false,
          prints `disabled`.
        - If enabled but unconfigured (missing apiKey/project) prints
          one line per missing field.
        - If enabled and the `braintrust` peer is not installed prints
          `not installed: run npm i braintrust`.
        - If enabled and configured, calls bootstrap(config), then
          prints: `enabled, project=<name>, last error: <msg or "none">,
          errors: <count>`. Calls shutdown() before exiting.

      Use the existing design-system primitives for output (do not
      `console.log` raw — match the style of other CLI commands).

      TDD: command-level tests using the same harness other CLI tests
      use; mock @poe-code/braintrust where needed.

    status:
      implement: open
      test: open

  - id: integration-test-subagent-tree
    title: End-to-end subagent tree test against mocked SDK
    prompt: |
      Add packages/braintrust/src/integration.test.ts that drives a
      fake pipeline run through the real bootstrap + adapters with a
      vi.mock("braintrust") stub that records every startSpan call
      with its parent.

      The test should:
        1. Build a config with integrations.braintrust.enabled=true.
        2. Call bootstrap(config) to get Integrations.
        3. Run integrations.traceRun("pipeline", "demo", async () => {
             // simulate two task starts/completes via the merged
             // pipelineCallbacks; each onTaskStart fires the spawn
             // middleware against a stub SpawnContext with two tool
             // call events.
           });
        4. Assert the recorded span tree:
           pipeline:demo (type=task, surface:pipeline tag)
           ├── step:<n>:0  (type=task)
           │   └── agent:<a>:<m> (type=task)
           │       ├── tool_call:<k>  (type=tool)
           │       └── tool_call:<k2> (type=tool)
           └── step:<n>:1
               └── agent:<a>:<m>
                   └── tool_call:<k>

      Also assert that token counts on the agent span land in `metrics`
      under canonical keys (prompt_tokens, completion_tokens, tokens).

      No real network calls. No real braintrust SDK loaded. Use memfs
      if any filesystem reads are required.

    status:
      implement: open

  - id: write-qa-plan
    title: Write QA markdown plan
    prompt: |
      Create docs/plans/qa/braintrust-integration.md as a numbered
      markdown checklist for a human (or agent) to execute against a
      real Braintrust workspace.

      Steps to include:
        1. `npm i braintrust` in the test workspace.
        2. Set env: BRAINTRUST_API_KEY=...
        3. Write a poe-code.config.json fragment with
           integrations.braintrust = { enabled: true,
           apiKey: "${BRAINTRUST_API_KEY}", project: "poe-code-qa" }.
        4. Run `npm run dev -- spawn --agent claude-code --prompt "say hi"`
           — verify a single agent span with tool-call children appears
           in the project's logs view.
        5. Run `npm run dev -- pipeline run <demo-plan>` — verify root
           pipeline span with one child span per step, each containing a
           subagent span and tool calls. Verify token usage appears as
           numeric metrics (sortable column), not as text in metadata.
        6. Run `npm run dev -- experiment run <demo-experiment>` — verify
           one root span per run, one iteration child each, AND a row
           per iteration in the Braintrust experiments view (including
           discarded iterations with kept=false).
        7. Run `npm run dev -- superintendent run <demo-plan>` — verify
           root → round → role → agent → tool nesting.
        8. Run with `enabled: true` but BRAINTRUST_API_KEY unset — expect
           the bootstrap error "missing apiKey".
        9. Run with `enabled: true` but braintrust not installed — expect
           "Run: npm i braintrust".
       10. Run with `enabled: false` — verify no Braintrust traffic
           (e.g. set apiUrl to an unreachable host; the run still
           completes).
       11. Run `poe-code braintrust status` in each of the three states
           (disabled, enabled-unconfigured, enabled-healthy) — verify
           the expected output.

      Do not script this. It is a markdown plan, executed by a human or
      agent.

    status:
      implement: open

  - id: write-package-readme
    title: Write packages/braintrust/README.md
    prompt: |
      Replace the stub README at packages/braintrust/README.md with
      the full per-CLAUDE.md content for a poe-code package.

      Sections required:
        - Title: `@poe-code/braintrust`
        - One-paragraph summary of what it does.
        - Setup: `npm i braintrust` (peer dep).
        - Configuration: the integrations.braintrust block, every key
          documented with type and meaning.
        - Environment variables exposed: BRAINTRUST_API_KEY (consumed
          via config interpolation; not read directly).
        - What lands in Braintrust: a condensed version of the span tree
          diagrams from the design — pipeline, superintendent,
          experiment-loop, standalone spawn.
        - Failure modes: missing peer, missing apiKey, network errors.
        - Pointer to `poe-code braintrust status`.

      Do not edit the root README.

    status:
      implement: open
---

## Context

Optional Braintrust observability for poe-code's four agent-running
surfaces (spawn / pipeline / superintendent / experiment-loop). Activates
via `integrations.braintrust.{enabled,apiKey,project}` in poe-code config.
Single Braintrust project for everything; surfaces separated by tags
inside the project. Spawned agents render as **subagent** child spans
under the orchestrator that launched them — one span tree per outermost
run, propagated via the SDK's `currentSpan()` async-context.

Token usage and durations live in `metrics` under Braintrust's canonical
keys (`prompt_tokens`, `completion_tokens`, `tokens`,
`prompt_cached_tokens`, `prompt_cache_creation_tokens`); only IDs go in
`metadata`. Span types are lowercase strings — `"task"` for orchestrator
/ step / role / agent / iteration, `"tool"` for ACP tool calls. We do
not synthesise `"llm"` spans in v1; ACP doesn't expose raw model-call
boundaries.

The new package `@poe-code/braintrust` is private (not published). The
Braintrust SDK is an optional peer dep — users who don't enable the
integration download nothing extra. The package is dynamically imported
only when config opts in.

Experiment-loop additionally writes one row per iteration to a Braintrust
**experiment** (the only surface where Braintrust experiments are a real
fit, because iterations have a metric vs. baseline). The iteration span
opened on the experiment doubles as the experiment row.

Build order matters: schema → package skeleton → leaf utilities (redact,
client, trace-run) → builders → adapters → bootstrap → CLI wiring →
status subcommand → integration test → docs.
