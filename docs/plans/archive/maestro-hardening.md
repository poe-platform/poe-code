---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: mock-agent-spawn
    title: Build invisible mock agent spawn test double
    prompt: >
      In packages/maestro create `src/__test_utils__/mock-spawn.ts`.

      It must implement the same callable shape as

      `spawn` from `@poe-code/agent-spawn` so callers cannot tell it

      apart (same args, same `SpawnResult`-compatible return, same

      thrown error types including `ActivityTimeoutError` and AbortError).


      The mock is deterministic: no LLM, no network, no child process,

      no real fs. Build behavior from a declarative script:


      ```ts

      type MockSpawnStep =
        | { kind: "emit"; event: AcpEvent }
        | { kind: "exit"; exitCode: number }
        | { kind: "throw"; error: "abort" | "activity_timeout" | "agent_startup_error" | "agent_crashed" | Error }
        | { kind: "wait"; ms: number }     // virtual; advances fake clock
        | { kind: "assert"; fn: (call: SpawnCall) => void }; // assertion on the call
      ```


      Behavior requirements:

      - `createMockSpawn(scripts: Record<string, MockSpawnStep[]> | ((call) =>
      MockSpawnStep[]))` returns
        a `spawn`-shaped function plus a `calls` array (all invocations
        with `{ agent, prompt, model, mode, cwd, signal }` captured).
      - Default (no script) succeeds with exitCode 0 and one synthetic
        `agent_message` event.
      - Honors `signal.aborted`: throws AbortError synchronously if
        signal is already aborted; aborts mid-script if signal fires.
      - Honors `cwd`: verifies it exists in the mock fs if a `cwd`
        verifier is supplied; otherwise records.
      - Never imports anything from outside `@poe-code/agent-spawn`
        types — production code paths must not see the mock.

      Re-export under `src/__test_utils__/index.ts`. Do NOT export

      from the package root `src/index.ts`. Add a unit test

      `mock-spawn.test.ts` covering: scripted exit, scripted throw

      mapped to each error type, abort honoring, call capture, default

      no-script behavior, multiple-call scripts (one per kind).


      Treat the mock as part of the public test contract: every later

      task uses it. If a real production seam is missing for any

      injection point, add the seam — do not add branches in production

      code that "know" the mock is active.
    status:
      implement: done
      test: done
      commit: done
  - id: mock-task-list
    title: Build invisible in-memory TaskList test double
    prompt: |
      In packages/maestro create `src/__test_utils__/mock-task-list.ts`.
      It must implement the full `TaskList` interface from
      `@poe-code/task-list` (every method on the exported `TaskList`
      type and `Tasks` namespace surface used by maestro: `allTasks`,
      `get`, `list`, `lists`, `create`, `update`, `setState`, `fire`,
      `comment`, `refresh`, plus any state-machine helpers). It must
      throw the same error classes (`TaskNotFoundError`,
      `InvalidTransitionError`, etc.) on the same conditions.

      Storage is plain in-memory maps. No fs. No memfs. No yaml.
      No network.

      `createMockTaskList(opts)` accepts:
      - `tasks`: seed `Task[]`
      - `lists`: seed list names; defaults inferred from tasks
      - `stateMachine`: optional `StateMachineDef`; defaults to
        whatever maestro's resolved `stateOrder` produces
      - `failures`: optional fault-injection map:
        - `getError?: (taskId) => Error | undefined`
        - `setStateError?: (taskId, from, to) => Error | undefined`
        - `refreshError?: (taskId) => Error | undefined`
        - `allTasksError?: (state) => Error | undefined`
        - `transient`: counter-based one-shot failures
      - `clock`: optional fake clock for timestamp determinism

      Behaviors:
      - State transitions validate against the configured machine;
        invalid transitions throw `InvalidTransitionError`.
      - `setState` to a non-existing target throws same error class
        as the real backends.
      - `get` on missing taskId throws `TaskNotFoundError`.
      - Internal storage is mutable — tests can stage state changes
        between ticks by calling `mock.mutate(...)` to simulate
        out-of-band edits without changing observable Task ids.
      - `mock.events`: array of `{ method, args, result }` for every
        method call (used for assertion). The events are not
        observable through the `TaskList` interface — only through
        the `mock` handle.

      Add `mock-task-list.test.ts` covering: state transitions, fault
      injection per failure key, `mutate` simulating external edits,
      `TaskNotFoundError` parity, `InvalidTransitionError` parity,
      `allTasks` state filter, `comment` no-op for non-supporting
      lists (mirror `gh-issues`-only behavior).

      Same isolation rule as the mock spawn task: never reachable from
      production code paths.
    status:
      implement: done
      test: done
      commit: done
  - id: shared-test-fixtures
    title: Extract shared maestro test fixtures and event collector
    prompt: |
      In packages/maestro create `src/__test_utils__/fixtures.ts`
      and `src/__test_utils__/event-collector.ts`.

      `fixtures.ts` exports factories used across every maestro test:
      - `createTask(overrides): Task` — sensible defaults for
        `id`, `qualifiedId`, `name`, `description`, `state`,
        `metadata`, `list`, `url`.
      - `createConfig(overrides): ResolvedConfig` — minimal valid
        config: one `planned` active state, one `done` terminal
        state, default agent service, in-memory workspace root.
      - `createTickDeps(overrides): TickDeps` — wires the mock spawn
        and mock TaskList from the prior tasks by default.
      - `createDriverContext(overrides): WorkflowDriverContext` —
        for direct driver unit tests.
      - `createWorkflowDefinition(overrides)` — `loadWorkflow`-shaped
        output, no fs.

      `event-collector.ts` exports `createEventCollector()`:
      - Returns `{ onEvent, events, waitFor, snapshot }`.
      - `onEvent` is a callable matching `RunMaestroOptions.onEvent`.
      - `events` is the live array (chronological).
      - `waitFor(predicate, { timeoutMs })` resolves when an event
        matching predicate is recorded; rejects on timeout — backed
        by a virtual clock so tests stay fast.
      - `snapshot()` returns a frozen copy useful for assertion
        message diagnostics.

      Add `fixtures.test.ts` and `event-collector.test.ts` covering
      every helper's defaults, overrides, and `waitFor` timeout
      behavior. Use vitest fake timers; assert that timing is
      virtual.

      Then convert every existing duplicate `createTask`/
      `createConfig`/`createDeps`/`createTaskList`/`successSpawn`
      across `src/runtime/loop.test.ts`,
      `src/agent/runner.test.ts`, `src/drivers/pipeline.test.ts`,
      `src/drivers/ralph.test.ts`, `src/runtime/reconcile.test.ts`,
      and `src/index.test.ts` to import the shared helpers. Net diff
      should remove lines, not add. Do not change observable test
      behavior; the migration is mechanical.
    status:
      implement: done
      test: done
      commit: done
  - id: pipeline-driver-coverage
    title: Pipeline driver exhaustive failure-mode coverage
    prompt: |
      In `packages/maestro/src/drivers/pipeline.test.ts`, using
      the shared `mock-spawn`, `mock-task-list`, and fixtures, add
      coverage for every code path in `pipeline.ts`. Each scenario
      must assert the full `AttemptEvent`/`MaestroEvent` sequence,
      not just the final outcome.

      Cases to add (where absent):
      - State-level `agent` falls back to workflow `agent.service`.
      - State-level `model` falls back to agent runner default
        (mock spawn captures `model: undefined`).
      - State-level `mode` defaults to `yolo`; `read` and `edit`
        forward verbatim.
      - Spawn throws `ActivityTimeoutError` → phase transitions to
        `failed` with `failure: step_timeout`.
      - Spawn throws AbortError after `signal.abort()` → outcome
        `canceled`, no retry scheduled.
      - Spawn throws an `agent_startup_error`-tagged error →
        `failure: agent_startup_error`.
      - Spawn throws a plain Error → `failure: agent_crashed` with
        the message preserved.
      - Spawn returns exitCode != 0 → `failure: step_failed`.
      - Spawn returns exitCode 0 → outcome `succeeded`, phase
        sequence `preparing-workspace → running-step → succeeded`.
      - Terminal state encountered → driver returns `skip` with the
        reason `terminal_state`; no spawn call.
      - State name missing from `config.states` → driver emits
        `unconfigured_state` and skips; mock spawn never called.
      - Prompt template expands every `task.*` variable
        (`id`, `qualifiedId`, `url`, `description`, `name`, `state`,
        `metadata`, `list`). Verify the rendered prompt the mock
        spawn receives.
      - Task `refresh` throws mid-attempt → outcome maps to the
        right failure category (write the test against current
        behavior; if behavior is wrong, fix `pipeline.ts` and update
        the test).
      - Concurrent two-state dispatch order: invoking the driver
        twice in sequence with different state names produces
        distinct prompts and distinct spawn calls.

      Where the test surfaces a bug in `pipeline.ts`, fix the bug at
      the correct layer rather than encoding the buggy behavior.
    status:
      implement: done
      test: done
      commit: done
  - id: ralph-driver-coverage
    title: Ralph driver exhaustive failure-mode coverage
    prompt: |
      In `packages/maestro/src/drivers/ralph.test.ts`, using the
      shared mocks, cover every branch of `ralph.ts`. The mock spawn
      must impersonate the ralph child-spawn contract exactly — the
      ralph driver must not know it is mocked.

      Cases to add (where absent):
      - Plan file copy in: planPath present → file copied into
        workspace; mock fs verifies content matches source.
      - Plan persistence out: ralph reports updated plan content →
        original planPath is overwritten; original mtime advances.
      - planPath is null/undefined → driver returns failure with
        category aligned to current `ralph.ts` mapping; test
        records and asserts.
      - Ralph `stopReason: completed` → outcome `succeeded`.
      - Ralph `stopReason: cancelled` → outcome `canceled`.
      - Ralph `stopReason: failed` with each reported sub-reason →
        failure category mapped per spec.
      - Ralph `stopReason: timeout` → `failure: step_timeout`.
      - Mid-iteration abort via `signal.abort()` → outcome
        `canceled`; partial plan changes are not persisted.
      - File persistence error (mock fs throws on write) →
        `failure: step_failed` and outcome flagged so the original
        plan is not corrupted.
      - Archive path fallback when configured archive dir is missing.
      - Spawn args forwarding: assert exact `{ agent, model, cwd,
        signal, mode }` shape and that `cwd` is the per-task
        workspace, not the maestro cwd.
      - Multi-iteration plan: mock spawn scripts three iterations,
        third reports completed; driver emits three
        `agent_event`s and one `succeeded` phase.

      If `ralph.ts` lacks a stable seam for any of these, expose one
      in production code (driver-level injection of the ralph
      runner) rather than reaching into globals.
    status:
      implement: done
      test: done
      commit: done
  - id: loop-tick-coverage
    title: Loop tick concurrency, claim, and dispatch coverage
    prompt: |
      In `packages/maestro/src/runtime/loop.test.ts`, using the
      shared mocks, add scenarios that drive the loop through its
      full state space.

      Cases to add (where absent):
      - Empty task list → tick emits `tick_started` only.
      - One candidate, capacity 1 → dispatched.
      - Two candidates, capacity 1 → first dispatched; second waits
        until first releases on next tick.
      - Two candidates, capacity 2 → both dispatched same tick.
      - Capacity reached mid-tick → no claim past the limit even if
        more candidates remain.
      - `claim` race: candidate already claimed in `state.claimed`
        is skipped; not re-claimed.
      - Unsupported `kind:` → emit `task_skipped` and do not claim.
      - Workspace creation fails → schedule retry with backoff;
        next tick does not re-dispatch before due time; subsequent
        tick after due time dispatches.
      - Retry scheduled task that becomes terminal before due →
        cancel retry; do not dispatch.
      - Dispatch validation fails on startup → emit
        `validation_failed`; do not dispatch anything this tick.
      - Worker succeeds → `worker_exit reason: normal`; state
        released; workspace removed.
      - Worker fails retryable → `worker_exit reason: abnormal`
        plus `retry_scheduled` with monotonically growing
        `due_in_ms`.
      - Worker fails non-retryable (`canceled` outcome) → no retry
        scheduled, state released.
      - Worker rejects (throws outside the driver contract) → state
        released and logged via `Logger.error`.
      - Reconcile injection: a custom `reconcileRunning` injected
        via `TickDeps` is invoked exactly once per tick and its
        events flow through `onEvent`.

      Use the event collector for ordered assertions on the
      `MaestroEvent` stream.
    status:
      implement: done
      test: done
      commit: done
  - id: reconcile-coverage
    title: Reconcile state-mutation-mid-attempt coverage
    prompt: |
      In `packages/maestro/src/runtime/reconcile.test.ts`, using
      the shared `mock-task-list`, exercise every reconcile branch.

      Cases to add (where absent):
      - Running task whose state moves to terminal mid-attempt →
        `stop_clean`; worker is aborted; workspace is removed.
      - Running task whose state moves to another active state →
        `update`; do not abort.
      - Running task that disappears from the backend
        (`TaskNotFoundError`) → `stop_clean`.
      - `refresh` throws a non-`TaskNotFoundError` → emit
        `refresh_failed` event; do not stop the worker; do not
        crash the tick.
      - `removeWorkspace` throws during `stop_clean` → logged warn,
        reconcile continues to next entry.
      - Two running tasks: one becomes terminal, one stays active;
        only the first is stopped.
      - `stop_keep` path: terminal but with `keep_workspace` flag
        (if config supports it) — verify workspace not removed and
        state released.
      - Reconcile is idempotent across two consecutive ticks with
        no change.
    status:
      implement: done
      test: done
      commit: done
  - id: workspace-manager-coverage
    title: Workspace manager security and cleanup edge cases
    prompt: |
      In `packages/maestro/src/workspace/manager.test.ts`,
      using memfs, cover every workspace branch.

      Cases to add (where absent):
      - `sanitizeWorkspaceKey` rejects `..`, absolute paths, NUL
        bytes, control chars, slashes, backslashes.
      - Long ids (>255 chars) are hashed/truncated deterministically.
      - Unicode ids (emoji, CJK, RTL) round-trip safely.
      - Collision: two distinct ids that sanitize to the same key
        produce distinct workspaces (suffix or hash).
      - `ensureWorkspace` creates root if missing.
      - `ensureWorkspace` throws when root path exists but is a file.
      - `ensureWorkspace` returns existing dir without rewriting
        its contents.
      - `removeWorkspace` deletes recursively; nested files are
        gone.
      - `removeWorkspace` is best-effort: throws on permission
        errors are caught and logged in the runtime layer, not in
        the manager — assert that the manager surfaces the error,
        and the runtime swallows it.
      - `startupTerminalCleanup` removes only workspaces whose ids
        match a terminal task; leaves unknown directories alone.
      - `startupTerminalCleanup` survives a workspace dir that is
        actually a file (corrupt state) without throwing.
      - Path traversal: a crafted task id like `../etc` cannot
        escape the configured root — assert the resolved path
        startsWith the root after `path.resolve`.
    status:
      implement: done
      test: done
      commit: done
  - id: retry-and-phase-coverage
    title: Retry, backoff, and phase-machine edge cases
    prompt: |
      In `packages/maestro/src/runtime/retry.test.ts` and
      `phases.test.ts`, cover every branch.

      Retry:
      - `backoffMs(attempt)` doubles each attempt; capped at
        `max_retry_backoff_ms`.
      - `CONTINUATION_DELAY_MS` is used for non-failure
        continuations (e.g. ralph multi-iteration handoff).
      - `shouldRetry` returns `no_retry` for `canceled` outcomes.
      - `shouldRetry` returns `no_retry` for non-retryable failure
        categories.
      - `shouldRetry` returns `retry` for retryable categories;
        attempt counter increments.
      - Attempt counter reset on success.
      - Max attempts boundary: if a hard cap exists, the final
        retry decision is `no_retry`. If no cap exists, document
        that explicitly in the test name.

      Phases:
      - `ATTEMPT_TRANSITIONS` table enforces every legal pair.
      - Every illegal transition throws.
      - `transitionPhase(null → preparing-workspace)` legal.
      - Terminal phases (`succeeded`, `failed`, `canceled`) reject
        any further transition.
      - Failure category is required on `failed` transition;
        absent → throw.
      - Failure category must be absent on `succeeded`/`canceled`;
        present → throw.
    status:
      implement: done
      test: done
      commit: done
  - id: config-coverage
    title: Config load, schema, and validate edge cases
    prompt: |
      In `packages/maestro/src/config/{load,schema,validate}.test.ts`,
      add coverage using memfs.

      load:
      - Missing WORKFLOW.md → `WorkflowLoadError` with stable
        `code: file_not_found`.
      - Invalid YAML frontmatter → `code: invalid_yaml`.
      - Frontmatter present but empty body → loads with empty
        prompt template.
      - Env var expansion: `$NAME` where name is allowed chars only
        is expanded; mixed `${NAME}` is left literal (or expanded,
        depending on documented behavior — pin it).
      - Env var name with invalid chars → not expanded, raw `$X`
        preserved.

      schema:
      - All defaults applied when fields are missing.
      - Relative paths in `workspace.root` resolve against the
        workflow dir.
      - `~` expansion in `workspace.root`.
      - Terminal-only state map → `resolveConfig` throws or
        validation rejects (depending on current contract).
      - Active state without prompt → treated as inactive; assert.
      - `agent.list` required for `gh-issues`; assert error if
        missing.
      - Duplicate state names → reject.

      validate:
      - Every `DispatchPreflightCode` is producible by some input;
        write one test per code. Codes include at minimum:
        `tasks_unreachable`, `no_active_states`,
        `no_terminal_states`, `unknown_initial_state`,
        and any others present in `validate.ts`.
      - `ok: true` returned when config is well-formed and the
        backend responds.
    status:
      implement: done
      test: done
      commit: done
  - id: integration-coverage
    title: End-to-end maestro loop integration coverage
    prompt: |
      In `packages/maestro/src/index.test.ts` add a new
      `describe("integration", ...)` block that uses the shared
      mocks for a full `runMaestro` lifecycle, no memfs, no real
      timers (use vitest fake timers).

      Each integration test wires:
      - `taskList`: mock-task-list seeded with N tasks.
      - `agentSpawn`: mock-spawn scripted per task id.
      - `onEvent`: event collector.
      - Virtual clock for `pollIntervalMs` and retry timing.

      Scenarios:
      - Happy path: one task `planned → done` after one full tick.
      - Three tasks, capacity 2: tick 1 dispatches two; tick 2
        dispatches third; all reach terminal in tick 3.
      - Mixed outcomes: one task succeeds, one fails retryable
        (verify retry fires next tick), one fails non-retryable
        (verify state released, no retry).
      - Abort during dispatch: call returned stop() while a worker
        is mid-attempt → STOP_BUDGET_MS budget honored, workspaces
        cleaned, file lock released.
      - Abort before first tick: stop() called before
        `setInterval` fires → no workers spawned, lock released.
      - Reentrant stop: stop() called twice → second call resolves
        without error, no double-cleanup.
      - File lock contention: a second `runMaestro` on the same
        workflow path rejects with a lock error (or whatever the
        documented behavior is) without corrupting the first.
      - Dry-run with mock task list: validation passes, candidate
        count reported, no dispatch.
      - Dry-run with validation failure: emits
        `validation_failed` event and throws.
      - Multi-driver mix: pipeline + ralph tasks in the same list,
        each routed to the right driver via `resolveWorkflowKind`.

      Use the event collector to assert the full chronological
      `MaestroEvent` sequence per scenario. Sequence equality, not
      subset matching.
    status:
      implement: done
      test: done
      commit: done
  - id: shutdown-and-abort-coverage
    title: Shutdown, abort, and lifecycle edge cases
    prompt: |
      In `packages/maestro/src/index.test.ts` add a
      `describe("shutdown", ...)` block focused on lifecycle
      correctness, using the shared mocks.

      Cases:
      - stop() with no active workers returns within < 50ms of
        virtual time.
      - stop() with 5 active workers — all `controller.abort()`
        called; all promises settle within STOP_BUDGET_MS.
      - stop() with 1 worker that ignores abort (mock-spawn script
        with `wait` exceeding budget) → stop returns after budget;
        workspace cleanup still attempted.
      - stop() during a tick that is currently running → tick
        completes (or is short-circuited via `stopped`) before
        stop returns.
      - Workspace cleanup failure during stop → logged warn, stop
        still resolves.
      - File lock released even when stop encounters errors.
      - SIGTERM-style cancellation: caller wires
        `process.once("SIGTERM", stop)` → assert stop is callable
        from a signal handler context (no async required-before).
      - Worker that throws synchronously inside `runAttempt` →
        state released, retry decision applied, no leaked workers
        in `workers` map.

      Add an assertion helper `assertNoLeakedWorkers(state, workers)`
      in `__test_utils__` that fails the test if either the
      runtime's worker map or the maestro state's `running`/
      `claimed` maps still hold entries after stop resolves.
    status:
      implement: done
      test: done
      commit: done
  - id: driver-registry-and-prompt-render-coverage
    title: Driver registry and prompt render edge cases
    prompt: |
      In `packages/maestro/src/drivers/registry.test.ts`:
      - `registerDriver` rejects duplicate kinds with a stable
        error message.
      - `getDriver` returns undefined for unknown kinds (no throw).
      - `listDrivers` returns sorted kind names.
      - Registering during a run is observed on the next call to
        `getDriver` (no caching surprises).

      In `packages/maestro/src/drivers/kind.test.ts` (create
      if missing):
      - `resolveWorkflowKind(task)` returns `pipeline` when
        frontmatter is absent.
      - Returns the explicit `kind:` value when present.
      - Whitespace and casing handling matches documented behavior.
      - Tasks without a description (gh-issues) get `pipeline`.

      In `packages/maestro/src/prompt/render.test.ts`:
      - Every documented template variable expands.
      - Missing variables render as empty string, not as a literal
        unrendered handlebars placeholder.
      - Metadata JSON-stringifies stably (sorted keys if the
        renderer sorts; otherwise pin the documented order).
      - Templates with no variables pass through unchanged.
      - Templates with malformed `{{` (no closing) — pin behavior:
        raw passthrough or error? Test the documented choice.
      - HTML/markdown content in task description is not escaped.
    status:
      implement: done
      test: done
      commit: done
  - id: concurrency-stress
    title: Concurrency stress and determinism
    prompt: |
      In `packages/maestro/src/integration.stress.test.ts`
      (new file), build a stress harness on top of the shared
      mocks. Use vitest fake timers — virtual time only, no real
      sleeps. Each test must complete in < 500ms of real time.

      Scenarios:
      - 50 tasks, capacity 5, all succeed in one iteration of
        tick scheduling → all reach `done` deterministically; the
        order of dispatch is the order returned by `allTasks`.
      - 50 tasks, capacity 5, every task fails retryable on first
        attempt and succeeds on second → all reach `done` after
        the expected number of ticks; retry counts sum to 50.
      - 20 tasks, all hit `step_timeout` then `agent_crashed` then
        `step_failed` then succeed — each task accumulates four
        attempt records; final state `done`.
      - Mid-run task injection: while 10 tasks are running, inject
        5 more via `mock.mutate` between ticks; new tasks are
        picked up on the next tick.
      - Mid-run task deletion: while a task is running, delete it
        from the backend; reconcile stops the worker on next tick.
      - Random fault injection: with a seeded PRNG, randomly fail
        20% of spawns, 5% of `refresh` calls, 1% of workspace
        creations; assert no leaks (no workers, no claimed, no
        running) and that every task reaches a terminal state
        eventually.

      Add `assertEventually(predicate, { ticks })` to the test
      utils that advances fake time and runs ticks until predicate
      holds or budget exhausted.
    status:
      implement: done
      test: done
      commit: done
  - id: replace-adhoc-mocks-in-existing-tests
    title: Remove duplicated ad-hoc mocks from production-adjacent tests
    prompt: |
      Search every `*.test.ts` under
      `packages/maestro/src/` for ad-hoc mock spawn
      factories (`successSpawn`, inline `vi.fn()` shaped like the
      `spawn` signature) and ad-hoc TaskList object literals
      (`{ allTasks: vi.fn(), get: vi.fn(), ... }`). Replace each
      with imports from `src/__test_utils__/`.

      Rule: after this task lands, the only file that constructs a
      mock spawn or mock TaskList is `__test_utils__/`. Grep for
      `vi.fn().*exitCode` and similar patterns should return zero
      hits in production-test files.

      Test behavior must not change. Compare event sequences
      before and after the swap using the event collector.

      If a test depends on a behavior the shared mock does not
      yet model, extend the shared mock (in `mock-spawn.ts` or
      `mock-task-list.ts`) rather than re-inlining a one-off.
    status:
      implement: done
      test: done
      commit: done
  - id: harden-runtime-bugs
    title: Fix every production bug surfaced by the hardening tests
    prompt: |
      Aggregate the bugs surfaced by the preceding tasks (each
      task fixes bugs at the correct layer rather than encoding
      them; this task is the cleanup pass for anything deferred).

      Walk every TODO, every test marked `.todo` or `.skip`, and
      every test that pinned current-but-suspect behavior with a
      comment like `// pin: matches today's behavior; revisit`.
      For each:
      - If the documented contract says the behavior is wrong,
        fix `pipeline.ts`, `ralph.ts`, `loop.ts`, `reconcile.ts`,
        `retry.ts`, `phases.ts`, or `manager.ts` at the right
        layer; un-pin the test.
      - If the contract is silent, document the intended behavior
        in the package README under a new "Failure semantics"
        section and pin the test to match.

      Specific items already identified during planning that must
      be settled here:
      - Whether `loop.ts` polls the abort signal between
        dispatches inside a single tick. If not, add the check so
        large ticks honor shutdown promptly.
      - Whether `runMaestro` rejects when `acquireFileLock`
        contends, or busy-waits. Document and test.
      - Whether `removeWorkspace` errors during normal worker
        exit are surfaced via `MaestroEvent` or silently swallowed.
        Pick one and make both paths consistent.
      - Whether retry state is intentionally not persisted across
        process restarts. If yes, document under "Failure
        semantics". If no, that is out of scope for this plan and
        gets its own follow-up.

      No new feature work in this task. Only bugfixes and
      documentation that the test suite required.
    status:
      implement: done
      test: done
      commit: done
teardown:
  prompt: |
    Run `npm run lint` and `cd packages/maestro && npm run test`
    in the package, confirm both are green, then run the full repo
    test suite from the root to confirm no cross-package regressions.
    Commit any remaining changes.
name: maestro-hardening
state: archived
---

# Context

`@poe-code/maestro` is the workflow driver runtime: it polls a
task backend, claims candidates, allocates per-task workspaces, runs
drivers (pipeline, ralph, plus stubs for experiment / superintendent
/ harness), reconciles state between ticks, and gracefully shuts
down. Today it has reasonable unit coverage on individual modules
but lacks an exhaustive integration-level test surface and shares
test-double code by copy-paste across files.

## Goal

Make maestro production-ready by building a fully scripted,
deterministic test environment — invisible to production code —
that exercises every failure mode and edge case end to end.

## Invisible mocks

Two test doubles, both implementing the exact production interfaces
of their counterparts:

- **Mock agent spawn** (`mock-spawn.ts`) — same callable shape as
  `spawn` from `@poe-code/agent-spawn`. Driven by a declarative
  script of `emit | exit | throw | wait | assert` steps. No LLM,
  no child process, no network. Honors `AbortSignal`. Captures
  every call for assertion.
- **Mock task handler** (`mock-task-list.ts`) — full `TaskList`
  interface from `@poe-code/task-list`, in-memory only. Same error
  classes, same state-machine semantics. Fault injection per
  method. Supports out-of-band `mutate()` to simulate external
  edits between ticks.

Both live in `src/__test_utils__/` and are not exported from the
package root. Production code paths must never import them and
must never branch on their presence. Where a production seam is
missing for a clean injection, the seam is added to production
code — never an `if (test)` branch.

## What "production-ready" means here

- Every reachable code path in `loop.ts`, `reconcile.ts`,
  `pipeline.ts`, `ralph.ts`, `retry.ts`, `phases.ts`, and
  `manager.ts` has at least one test driving it.
- Every documented `MaestroEvent` and `AttemptPhase` is asserted
  in at least one ordered sequence test.
- Shutdown is correct under load: stop() always resolves within
  `STOP_BUDGET_MS` plus cleanup overhead, with no leaked workers,
  no leaked workspaces, and the file lock released.
- Fault injection on spawn, task refresh, and workspace creation
  never leaks workers, never corrupts task state, and never
  prevents the loop from making forward progress on other tasks.
- All shared test infrastructure (mocks, fixtures, event
  collector) is colocated in `src/__test_utils__/` and reused
  across every test file in the package.

## Out of scope

- Implementing the unfinished `experiment`, `superintendent`,
  `harness` drivers. They are stubs today; this plan tests what
  exists.
- Persisting maestro state across process restarts.
- New backends. The `gh-issues` backend is exercised via the
  generic `TaskList` interface only.
