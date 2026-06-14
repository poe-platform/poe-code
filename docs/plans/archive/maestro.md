---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: scaffold-package
    title: Scaffold packages/maestro
    prompt: |
      Create packages/maestro with package.json, tsconfig, an empty
      src/index.ts, and a README skeleton. Add deps: @poe-code/task-list,
      @poe-code/pipeline, @poe-code/markdown-reader, @poe-code/poe-code-config,
      @poe-code/agent-spawn, @poe-code/file-lock. Wire into root workspaces
      and tsconfig path mapping if needed. `npm run build` must pass with
      an empty index. See docs/plans/26-maestro.md §3 package layout.
    status:
      implement: done
  - id: runtime-sanitize
    title: Workspace-key sanitizer
    prompt: |
      Implement packages/maestro/src/runtime/sanitize.ts exporting
      `sanitizeWorkspaceKey(qualifiedId: string): string`. Rules: keep
      `[A-Za-z0-9._-]`, replace everything else with `_`, throw on empty.
      Examples to cover in tests: `ENG-412` → `ENG-412`;
      `octo-org/7/412` → `octo-org_7_412`; `foo/bar baz` → `foo_bar_baz`;
      empty input throws. See docs/plans/26-maestro.md §3 safety invariants
      and §4 test table.
    status:
      implement: done
      test: done
  - id: runtime-phases
    title: Attempt phase state machine
    prompt: |
      Implement packages/maestro/src/runtime/phases.ts with the
      `AttemptPhase`, `FailureCategory`, `AttemptState` types and the
      `ATTEMPT_TRANSITIONS` table exactly as defined in
      docs/plans/26-maestro.md §3 "Attempt phase machine". Add a pure
      `transitionPhase(current, next, ctx)` that throws on illegal moves
      and preserves `failure`/`failedStep`/`step` fields. No IO. Tests
      must accept every legal transition and reject every illegal one,
      and verify failure categories survive a `failed` transition.
    status:
      implement: done
      test: done
  - id: state-machine-export
    title: Recommended task state machine constant
    prompt: |
      Implement packages/maestro/src/state-machine.ts exporting
      `maestroTaskStateMachine: StateMachineDef` from @poe-code/task-list.
      States and events per docs/plans/26-maestro.md §3 "Recommended task
      state machine": queued → agent-running (start), agent-running → done
      (complete), agent-running → human-review (handoff), human-review →
      done (accept), agent-running|human-review → failed (fail),
      done|failed → archived (archive). Tests: passes `validateMachine`;
      canonical path queued → agent-running → human-review → done fires
      cleanly; illegal transitions throw `InvalidTransitionError`.
    status:
      implement: done
      test: done
  - id: config-load-and-schema
    title: WORKFLOW.md loader, schema, preflight validation
    prompt: |
      Implement these three files in packages/maestro/src/config/:
      `load.ts` exports `loadWorkflow(path): Promise<WorkflowDefinition>`
      using @poe-code/markdown-reader to split YAML frontmatter and body
      (sourcePath, config, promptTemplate). `schema.ts` exports
      `resolveConfig(raw, cwd): ResolvedConfig` applying defaults from
      §3 "Config defaults", `$VAR` resolution and `~` expansion via
      @poe-code/poe-code-config, picking up `step_overrides`. `validate.ts`
      exports `validateDispatch(cfg, taskList, steps)` returning a typed
      ok/error union. Preflight failure codes from §3 edge cases:
      `missing_tasks_config`, `missing_steps_config`, `no_steps_defined`,
      `list_not_found`, plus `board_not_provisioned` when
      tasks.type === "gh-issues" and `verifyGhProject` is not ok. Tests
      cover front-matter split, missing/non-map YAML errors, body-only
      file, defaults, `$VAR` and `~`, missing required fields, and the
      preflight failure paths. Schema details in docs/plans/26-maestro.md §3.
    status:
      implement: done
      test: done
  - id: prompt-render
    title: Task and step prompt renderers
    prompt: |
      Implement packages/maestro/src/prompt/render.ts. Both
      `renderTaskPrompt(template, { task, attempt })` and
      `renderStepPrompt(step, { prompt, task, attempt })` are thin
      wrappers around `interpolatePipelineVars` from @poe-code/pipeline
      (strict `\{{ var }}`, throws `Missing pipeline variable "x"`).
      Empty task-prompt template falls back to
      `"{{ task.qualifiedId }}: {{ task.name }}\n\n{{ task.description }}"`
      per docs/plans/26-maestro.md §2. Tests cover normal render,
      fallback on empty body, and a thrown error on unknown var.
    status:
      implement: done
      test: done
  - id: workspace-manager
    title: Per-task workspace manager
    prompt: |
      Implement packages/maestro/src/workspace/manager.ts exporting
      `ensureWorkspace(root, qualifiedId)`, `removeWorkspace(...)`, and
      `startupTerminalCleanup(root, terminalQualifiedIds)`. Use
      `sanitizeWorkspaceKey` and enforce path-containment:
      `resolve(workspacePath).startsWith(resolve(root) + sep)` — reject
      `../foo` and absolute paths that escape the root. `ensureWorkspace`
      returns `{ path, createdNow }`. Cleanup removes only directories
      whose key matches a terminal task. All tests use memfs (CLAUDE.md
      rule). Reference: docs/plans/26-maestro.md §3 safety invariants and
      §4 test table.
    status:
      implement: done
      test: done
  - id: runtime-retry-and-state
    title: Retry math and claim state mutators
    prompt: |
      Implement two modules in packages/maestro/src/runtime/:
      `retry.ts` exports `backoffMs(attempt, capMs) =
      min(10_000 * 2^(attempt-1), capMs)`, `CONTINUATION_DELAY_MS = 1_000`,
      and `shouldRetry(phase, failure)`: `succeeded` → continuation,
      `canceled` → no retry, anything else terminal → backoff retry.
      `state.ts` exports `createState(cfg)` and named mutators `claim`,
      `release`, `markRunning`, `markCompleted`, `scheduleRetry`,
      `cancelRetry` over a single in-memory `MaestroState` object holding
      `running`, `claimed`, `retry_attempts`, `completed` sets/maps. Tests
      cover backoff at attempts 1..10 with the cap, claim/release symmetry,
      double-claim rejection, and disjointness of running/retry sets.
      Spec: docs/plans/26-maestro.md §3 "Three state machines" and "Retry math".
    status:
      implement: done
      test: done
  - id: runtime-reconcile
    title: Reconciliation against task store
    prompt: |
      Implement packages/maestro/src/runtime/reconcile.ts exporting
      `reconcileRunning(state, deps)`. Per tick refresh every running id
      via `tasks.get(id)`; treat `TaskNotFoundError` as terminal. Actions
      per docs/plans/26-maestro.md §3 "Reconciliation":
      terminal → kill worker + remove workspace + release claim
      (`stop_clean`); active → update snapshot (`update`); other
      intermediate → kill worker, keep workspace, release claim
      (`stop_keep`). Refresh failure (network/auth) keeps workers running.
      Tests use an in-memory markdown-dir TaskList against memfs and cover
      all four branches plus the refresh-failure path.
    status:
      implement: done
      test: done
  - id: agent-runner
    title: Per-attempt step pipeline runner
    prompt: >
      Implement packages/maestro/src/agent/runner.ts exporting

      `runAttempt({ task, attempt, cfg, steps, deps, abort })`. Walk

      `setup → steps[*] → teardown` in declared order, calling

      `agent-spawn` once per step with that step's `agent`/`model`/`mode`

      and `renderStepPrompt(step, { prompt: renderTaskPrompt(...), task, attempt
      })`.

      Between every step boundary check the abort signal AND refresh the

      task state via reconcile; if terminal or aborted, enter `canceled`

      and skip remaining steps. Setup failure aborts steps but still runs

      teardown best-effort; step failure skips remaining steps but still

      runs teardown best-effort; teardown failure is logged and ignored.

      Emit `attempt_phase` events on every phase change. Return

      `AttemptOutcome { reason, failure?, failedStep?, error? }` mapping

      to a phase per the failure category table in

      docs/plans/26-maestro.md §3. Tests: three-step happy path

      (implement/test/commit) with correct agent/model/mode per step;

      `\{{ prompt }}` is the rendered task body; phase sequence matches

      §4 test table; mid-step abort → canceled, remaining skipped;

      setup-fail / step-fail / teardown-fail / reconcile-to-terminal

      between steps. Use a mock spawn and a real `loadResolvedSteps` over

      a memfs `steps.yaml`.
    status:
      implement: done
      test: done
  - id: runtime-loop
    title: Poll-tick orchestration
    prompt: |
      Implement packages/maestro/src/runtime/loop.ts exporting
      `tick(state, deps)`. Order per docs/plans/26-maestro.md §4 test
      table: reconcile running → preflight (skip dispatch on fail but
      keep reconciling) → fetch candidates from active_states union →
      sort by `metadata.priority` asc (null last) then
      `metadata.createdAt` then `qualifiedId` → dispatch up to
      `max_concurrent_agents - currently_running`. Each dispatch creates
      the workspace, calls `runAttempt`, and on exit schedules retry per
      `shouldRetry`. Emit `tick_started`, `dispatch`, `worker_exit`,
      `retry_scheduled`, `reconcile`, `validation_failed` events. Tests
      cover the order, the sort, the preflight-fail-but-reconcile branch,
      and the concurrency cap.
    status:
      implement: done
      test: done
  - id: index-and-integration
    title: Public SDK wire-up and integration tests
    prompt: |
      Implement packages/maestro/src/index.ts exporting
      `runMaestro(opts?: RunMaestroOptions): Promise<() => Promise<void>>`,
      the `MaestroEvent` union, and re-exports for `AttemptPhase`,
      `FailureCategory`, `maestroTaskStateMachine`. `runMaestro` loads
      the workflow, resolves config, opens the file lock at
      `<workflow>.lock`, runs `verifyGhProject` when applicable, opens
      the task list (or uses the injected `taskList`), loads resolved
      steps via `loadResolvedSteps` merged with `step_overrides`, runs
      startup terminal cleanup, schedules the poll loop, and returns a
      stop fn that cancels the timer, awaits in-flight workers, runs
      best-effort teardown with a 10s budget, releases the lock, and
      resolves. Two integration tests against memfs + mock spawn:
      (1) default state machine — dispatch one task, see full phase
      sequence and per-step agent_events, fire `complete` externally,
      reconcile to terminal, workspace removed; (2) recommended
      machine — agent fires `handoff` mid-pipeline, maestro sees
      `human-review`, cancels remaining steps + cleanup + no retry.
      Full SDK shape in docs/plans/26-maestro.md §4.
    status:
      implement: done
      test: done
  - id: cli-register
    title: Register `poe-code maestro` command
    prompt: |
      Add a new command in src/cli/program.ts alongside `superintendent`
      and `pipeline`. Use cmdkit-schema with positional `path` (default
      `./WORKFLOW.md`) and options `--max-concurrent` / `-c`,
      `--poll-interval-ms`, `--list`, `--dry-run`, `--yes`,
      `--log-level` (default `info`). The handler calls `runMaestro`
      from @poe-code/maestro with the parsed args. CLI and SDK
      args must stay at parity (CLAUDE.md rule). Add a smoke test that
      `poe-code maestro --help` renders and exits 0. Reference:
      docs/plans/26-maestro.md §2 CLI block and §4 cmdkit declaration.
    status:
      implement: done
      test: done
  - id: package-readme
    title: maestro README
    prompt: |
      Write packages/maestro/README.md per CLAUDE.md package rules:
      list every env var consumed by chosen task-list backends (start with
      `GH_HOST` for gh-issues), every config field under `tasks`, `agent`,
      `polling`, `workspace`, `active_states`, `terminal_states`,
      `step_overrides`, and one example `WORKFLOW.md` for each of the
      three backends (markdown-dir, yaml-file, gh-issues). Point at the
      @poe-code/pipeline README for `steps.yaml`. No content beyond the
      env-vars/config/examples sections without user approval.
    status:
      implement: done
  - id: dry-run-smoke
    title: Manual --dry-run smoke check
    prompt: |
      Create a throwaway WORKFLOW.md under /tmp pointing `tasks` at a
      `markdown-dir` with three seeded task files, and run
      `npm run dev -- maestro /tmp/WORKFLOW.md --dry-run`. Verify the
      output reports `config OK`, opens the task store, lists candidates,
      and exits 0 without launching any agent. Also run `npm run lint`
      and `npm run test -- packages/maestro` from repo root and fix
      anything that fails. Delete the temp files when done. See
      docs/plans/26-maestro.md §4 autonomy checklist.
    status:
      implement: done
      commit: done
name: maestro
state: archived
---

# Maestro — Task-driven agent daemon

A long-running daemon that polls a [`@poe-code/task-list`](../../packages/task-list/README.md) task store and dispatches per-task coding-agent runs in isolated workspaces. Modeled after the [Symphony spec](https://github.com/openai/symphony/blob/main/SPEC.md) but rebuilt on the existing task-list abstraction — no new tracker layer.

## 1. What we're building

A new package `packages/maestro` plus a `poe-code maestro` CLI command. The daemon:

- Loads a repo-owned `WORKFLOW.md` (YAML frontmatter + Markdown prompt body).
- Opens a `TaskList` via `openTaskList(frontmatter.tasks)` — the `tasks:` block is passed through verbatim, so `markdown-dir`, `yaml-file`, and `gh-issues` are all supported on day one with zero adapter code.
- Loads multi-step definitions via `@poe-code/pipeline`'s `loadResolvedSteps({ cwd, homeDir, stepOverrides })`. The step file schema is the **same `.poe-code/pipeline/steps.yaml`** the pipeline package already uses — `steps: { <name>: { prompt, mode, agent?, model? } }` plus optional `setup:` and `teardown:`. The maestro does not own a separate step parser.
- Polls every `polling.interval_ms` for tasks whose `state` is in the configured `active_states` (defaults to `["planned", "in-progress"]` against the default state machine).
- For each candidate, creates a per-task workspace dir under `workspace.root` keyed by sanitized `Task.qualifiedId`, builds a per-task prompt from the WORKFLOW.md body, then runs `setup → steps[*] → teardown` in order. Each step is one `agent-spawn` invocation with that step's `agent`/`model`/`mode` and its `prompt` template rendered with `{ prompt: <task-prompt>, task, attempt }`.
- Single in-memory state object owns `running`, `claimed`, `retry_attempts`, `completed`. All mutations go through one module.
- Reconciles between steps (and on every poll tick) by re-reading `tasks.get(id)`: terminal state → abort remaining steps + remove workspace; non-active non-terminal → abort remaining steps, keep workspace; active → update snapshot and continue.
- Retries with exponential backoff (`10s * 2^(attempt-1)`, capped at `agent.max_retry_backoff_ms`, default 5m). Retry restarts the whole pipeline from `setup`. Normal exit schedules a ~1s continuation retry.
- Cleans up stale terminal workspaces at startup.

Ticket writes (state transitions) stay on the agent side per spec §11.5: the agent calls `tasks.fire(id, event)` through whatever tool surface it's given (typically from a final `commit` step). The maestro never mutates task state itself.

### Non-goals (v1)

Deferred to v2 and explicitly not implemented in this plan: shell hooks (`after_create`, `before_run`, `after_run`, `before_remove`) and the hook timeout/runner; dynamic `WORKFLOW.md` watch/reload (v1 reads once at startup, edit + restart to re-apply); per-state concurrency (`max_concurrent_agents_by_state`); stall detection (`codex.stall_timeout_ms`); HTTP server / dashboard / `/api/v1/*`; SSH worker extension (Appendix A); token-usage and rate-limit aggregation (raw agent events are logged but not summed); restart recovery beyond "next poll picks the work back up"; agent-side `tasks.fire` tool surface (separate plan, not blocking — agents that don't transition tasks just keep getting picked up until the operator moves them). Default `max_concurrent_agents` is **1** (sequential), not 10 — concurrency limit is wired in and enforced but the default reflects the current sequential-only operating assumption.

## 2. User-facing shape

### Files involved

Two files, both already familiar:

1. **`.poe-code/pipeline/steps.yaml`** — the multi-step definition. Exact same schema the pipeline package uses today. The maestro does not duplicate this parser.
2. **`WORKFLOW.md`** — the per-tracker config + the per-task prompt template that fills `{{ prompt }}` for every step. Resolved relative to cwd by default.

#### `.poe-code/pipeline/steps.yaml` (unchanged from pipeline)

```yaml
steps:
  implement:
    prompt: |
      Implement
      {{ prompt }}
  refactor:
    agent: claude-code
    prompt: |
      Original task:
      {{ prompt }}
      Refactor and simplify the code if you can, don't sweat it though.
  test:
    prompt: |
      Original task:
      {{ prompt }}
      Be a user and test all edge cases, fix bugs if needed
  commit:
    prompt: |
      Make sure tests run, commit all changes, and fire the `complete` event on this task.
teardown:
  prompt: |
    Make sure tests run, and commit all changes
```

#### `WORKFLOW.md` (new)

```markdown
---
tasks:
  type: gh-issues
  repo: octo-org/octo-repo
  project:
    owner: octo-org
    number: 7
active_states: [in-progress]
terminal_states: [done, archived]
polling:
  interval_ms: 30000
workspace:
  root: ~/maestro-workspaces
agent:
  service: codex
  list: octo-org/7
  max_concurrent_agents: 1
  max_retry_backoff_ms: 300000
# Optional: same shape as a pipeline plan's stepOverrides
step_overrides:
  refactor:
    model: claude-sonnet-4.6
---

You are working on {{ task.qualifiedId }}: {{ task.name }}.

{{ task.description }}

{{ attempt }}
```

The body is the per-task prompt template. After rendering with `{ task, attempt }`, the result becomes the `{{ prompt }}` variable injected into each step's template (same convention as pipeline today). If the body is empty, the maestro falls back to `"{{ task.qualifiedId }}: {{ task.name }}\n\n{{ task.description }}"`.

Alternate local-only example (markdown-dir tasks, no network):

```yaml
tasks:
  type: markdown-dir
  path: ./tasks
  create: true
active_states: [planned, in-progress]
terminal_states: [done, archived]
agent:
  service: codex
  list: backlog
```

### CLI

```text
$ poe-code maestro [path] [options]

Arguments:
  path                       Path to WORKFLOW.md (default: ./WORKFLOW.md)

Options:
  --max-concurrent <n>       Override agent.max_concurrent_agents
  --poll-interval-ms <ms>    Override polling.interval_ms
  --list <name>              Override agent.list (which Tasks list to poll)
  --dry-run                  Validate config + open task store, print first candidates, exit
  --yes                      Accept defaults non-interactively (CI)
  --log-level <level>        trace|debug|info|warn|error (default: info)
```

Examples:

```text
$ poe-code maestro
[info] maestro starting workflow=./WORKFLOW.md tasks=gh-issues list=octo-org/7
[info] startup terminal cleanup removed=2 workspaces
[info] poll tick candidates=3 dispatched=1 slots_remaining=0
[info] dispatched task=octo-org/7/412 workspace=~/maestro-workspaces/octo-org_7_412
[info] agent event task=octo-org/7/412 session_id=t1-tu1 event=session_started
[info] agent event task=octo-org/7/412 session_id=t1-tu1 event=turn_completed
[info] worker exit task=octo-org/7/412 reason=normal continuation_in_ms=1000
[info] reconcile task=octo-org/7/412 state=done action=stop cleanup=true

$ poe-code maestro ./WORKFLOW.md --dry-run
[info] config OK tasks=gh-issues list=octo-org/7
[info] task store open OK candidates=4 first=octo-org/7/412
[info] dry-run complete
```

### SDK

```ts
import { runMaestro } from "@poe-code/maestro";

const stop = await runMaestro({
  workflowPath: "./WORKFLOW.md",
  maxConcurrent: 1,
  pollIntervalMs: 30_000,
  onEvent: (e) => console.log(e),
});

// graceful shutdown
process.on("SIGINT", () => stop());
```

Returned `stop()` cancels the next tick, awaits in-flight workers, releases the file lock, resolves.

For tests / programmatic use, the SDK also accepts a pre-built `TaskList`:

```ts
import { openTaskList } from "@poe-code/task-list";
import { runMaestro } from "@poe-code/maestro";

const taskList = await openTaskList({ type: "markdown-dir", path: "./tasks" });
await runMaestro({ workflowPath: "./WORKFLOW.md", taskList });
```

When `taskList` is supplied, the `tasks:` block in `WORKFLOW.md` is ignored.

## 3. Implementation details and technical decisions

### Package layout

```text
packages/maestro/
  src/
    index.ts                 # public SDK: runMaestro, types
    config/
      load.ts                # WORKFLOW.md → WorkflowDefinition (uses markdown-reader)
      schema.ts              # typed-getters, defaults, $VAR resolution (uses poe-code-config)
      validate.ts            # dispatch preflight + startup checks
    runtime/
      state.ts               # MaestroState + single-authority mutators
      loop.ts                # poll tick, dispatch, reconcile
      retry.ts               # exponential backoff math + continuation
      reconcile.ts           # terminal / non-active / active transitions
      sanitize.ts            # workspace-key sanitization
    workspace/
      manager.ts             # mkdir under root, path-containment check, terminal cleanup
    prompt/
      render.ts              # strict template render { task, attempt }
    agent/
      runner.ts              # workspace + prompt + agent-spawn glue
    logging.ts               # structured logger (key=value)
  test/
    *.spec.ts                # vitest + memfs
  package.json
  README.md                  # env vars, config options (per CLAUDE.md package rules)
```

No `tracker/` directory: `@poe-code/task-list` *is* the tracker layer. The maestro never imports `@linear/sdk` or talks GraphQL directly.

### Prerequisite: GitHub Project v2 board

When the operator picks `tasks.type: gh-issues`, the GitHub Project v2 board (with a `Status` single-select field and the right options) must exist before `maestro` runs. That setup ships as a sibling feature in `@poe-code/task-list`: see [docs/plans/25-tasks-board-sync.md](25-tasks-board-sync.md) for `poe-code tasks verify <list>` (read-only preflight) and `poe-code tasks sync <list>` (idempotent provision). The maestro's startup runs `verifyGhProject` (when `tasks.type === "gh-issues"`) and fails preflight with `board_not_provisioned` if the report is not `ok`, telling the operator to run `poe-code tasks sync` first. No board mutations happen from inside the maestro daemon.

### Reused packages (no duplication)

- `@poe-code/task-list` — the issue/task store. Provides `openTaskList`, `Tasks`, `Task`, state machine, three backends, plus `verifyGhProject` / `syncGhProject` for board provisioning (per the linked plan).
- `@poe-code/pipeline` — provides `loadResolvedSteps`, `StepDefinition`, `StepDefinitionOverrides`, `ResolvedStepsConfig`, and `interpolatePipelineVars`. The maestro does not re-parse `steps.yaml` and does not own its own template-interpolation function.
- `@poe-code/markdown-reader` — parse YAML frontmatter + body of `WORKFLOW.md`.
- `@poe-code/poe-code-config` — typed config getters, scoped merge, `$VAR` resolution, `~` expansion.
- `@poe-code/agent-spawn` — launches the coding agent; supplies events + result promise. Replaces the spec's Codex app-server protocol section entirely.
- `@poe-code/file-lock` — one daemon per workflow file; lock at `<workflow>.lock`.

`worktree` and `workspace-resolver` are deliberately **not** used in v1. v1 workspaces are plain directories under `workspace.root`. Git semantics are deferred.

No `liquidjs` dep — `interpolatePipelineVars` is strict (`Missing pipeline variable "x"`) and uses `{{ var }}` syntax, matching what `steps.yaml` already expects.

### Mapping the spec onto `task-list`

| Spec concept | `task-list` mapping |
| --- | --- |
| `tracker.kind` + adapter | `tasks.type` (`markdown-dir` / `yaml-file` / `gh-issues`) |
| `tracker.api_key`, `project_slug`, `endpoint` | Backend-specific options inside `tasks:`, passed through |
| `Issue` domain model | `Task` (`id`, `qualifiedId`, `name`, `state`, `description`, `metadata`) |
| `Issue.identifier` (workspace key) | `Task.qualifiedId` (sanitized) |
| `Issue.priority` | `task.metadata.priority` (read by sort, missing → last) |
| `Issue.created_at` | `task.metadata.createdAt` (read by sort tie-break) |
| `Issue.blocked_by` | Out of scope for v1 — blocker semantics not in task-list's default model |
| `fetch_candidate_issues()` | `tasks.all({ state: <active> })` ∪ for each active state |
| `fetch_issue_states_by_ids()` | `Promise.all(ids.map(id => tasks.get(id)))` with `TaskNotFoundError` → terminal-equivalent |
| `fetch_issues_by_states(terminal)` | `tasks.all({ state: <terminal> })` ∪ + `{ includeArchived: true }` filter |
| Tracker writes (spec §11.5) | `tasks.fire(id, event)` from the agent side; maestro does not write |
| Per-task prompt | WORKFLOW.md body, rendered with `{ task, attempt }` |
| Multi-turn loop (§7.1: "continue through multiple back-to-back coding-agent turns") | Multi-step pipeline: each step is one agent invocation; reconcile runs between steps |
| Step definitions | `loadResolvedSteps` from `@poe-code/pipeline` reading `.poe-code/pipeline/steps.yaml` (project) or `~/.poe-code/pipeline/steps.yaml` (global), with `step_overrides` from `WORKFLOW.md` frontmatter |

`Tasks.list` is the unit of polling. The workflow picks one list via `agent.list` (e.g. `"backlog"` for markdown-dir, `"octo-org/7"` for gh-issues). Polling multiple lists in one daemon is deferred.

### Three state machines

The maestro is modeled as three explicit state machines. Each runs at a different scope and lives in a different module — none of them is implicit.

1. **Maestro claim machine** (per task id, in-memory) — owns dispatch eligibility. States: `Unclaimed → Claimed → {Running, RetryQueued} → Released`. Implemented as set membership in `runtime/state.ts` (`claimed`, `running`, `retry_attempts`). Transitions: `claim`, `markRunning`, `scheduleRetry`, `cancelRetry`, `release`.
2. **Attempt phase machine** (per worker run, in-memory) — owns observability and retry classification. See [Attempt phase machine](#attempt-phase-machine) below.
3. **Task state machine** (per task, persisted via `task-list`) — owns operator-visible workflow. The default machine ships with task-list; the maestro also exports a richer recommended machine. See [Recommended task state machine](#recommended-task-state-machine-operator-supplied) below.

All mutations to the maestro claim machine funnel through one module (`runtime/state.ts`) that exposes named transitions. Direct field access from `loop.ts` / `reconcile.ts` is allowed for *reads* only.

### Attempt phase machine

Step-aware. Spec §7.2 lists 11 phases assuming a single agent invocation per attempt; the maestro runs a `setup → steps[*] → teardown` pipeline per attempt, so the phase set tracks pipeline position instead:

| Phase | Terminal? | Entered when | Emitted event |
| --- | --- | --- | --- |
| `preparing-workspace` | no | Worker spawned; `ensureWorkspace` running | `attempt_phase` |
| `running-setup` | no | `setup` step starts (only if a `setup:` block exists) | `attempt_phase` |
| `running-step` | no | A named step starts; carries `step: string` (the step name) | `attempt_phase` |
| `running-teardown` | no | `teardown` step starts (only if a `teardown:` block exists) | `attempt_phase` |
| `succeeded` | yes | All steps finished cleanly | `worker_exit reason=normal` |
| `failed` | yes | Any step failed or workspace setup failed; carries `failure: FailureCategory` and `failedStep?: string` | `worker_exit reason=abnormal failure=<category>` |
| `canceled` | yes | Reconciliation aborted between steps (or mid-step abort signal) | `worker_exit reason=abnormal failure=canceled` |

Implementation:

```ts
// runtime/phases.ts
export type AttemptPhase =
  | "preparing-workspace"
  | "running-setup"
  | "running-step"
  | "running-teardown"
  | "succeeded"
  | "failed"
  | "canceled";

export type FailureCategory =
  | "workspace_error"        // ensureWorkspace failed, path-containment failed
  | "prompt_render_error"    // missing variable, malformed step template
  | "agent_startup_error"    // spawn never produced a session_started event
  | "step_failed"            // agent returned non-zero / turn_failed
  | "step_timeout"           // agent-spawn enforced turn timeout
  | "agent_crashed"          // subprocess exited unexpectedly
  | "canceled";              // reconciliation killed it

export interface AttemptState {
  phase: AttemptPhase;
  step?: string;             // set whenever phase is running-step/setup/teardown
  failure?: FailureCategory;
  failedStep?: string;       // set on failed
  error?: string;
}

export const ATTEMPT_TRANSITIONS: Readonly<Record<AttemptPhase, readonly AttemptPhase[]>> = {
  "preparing-workspace": ["running-setup", "running-step", "failed", "canceled"],
  "running-setup":       ["running-step",  "failed",       "canceled"],
  "running-step":        ["running-step",  "running-teardown", "succeeded", "failed", "canceled"],
  "running-teardown":    ["succeeded",     "failed",       "canceled"],
  "succeeded":           [],
  "failed":              [],
  "canceled":            [],
};
```

A self-transition on `running-step` (with a different `step` value in `AttemptState`) covers stepping between named steps. Reconciliation is checked between every step boundary — if the task went terminal, the worker enters `canceled` instead of advancing.

Retry policy reads `failure`:

- `workspace_error`, `prompt_render_error`, `agent_startup_error`, `step_failed`, `step_timeout`, `agent_crashed` → retry with backoff (whole pipeline restarts from `setup`).
- `succeeded` → continuation retry (1s) per spec §7.1.
- `canceled` → no retry; reconciliation already released the claim.

v1 deliberately does **not** resume from the failed step (that's a v2 enhancement modeled after pipeline plans' per-task status). Spec §7.2 phases `TimedOut` / `Stalled` are folded into `failed` with `failure=step_timeout` (basic, via agent-spawn) / future `failure=stalled` (v2).

### Recommended task state machine (operator-supplied)

The maestro ships an opinionated `StateMachineDef` operators can pass to `openTaskList({ stateMachine: maestroTaskStateMachine })`. The default `task-list` machine still works; this one just gives operators a richer workflow with a Symphony-style handoff state.

States: `queued → agent-running → human-review → done`, with `failed` and `archived` as terminal triage states.

```text
        ┌──────────┐ start  ┌───────────────┐  handoff  ┌──────────────┐
        │  queued  │───────▶│ agent-running │──────────▶│ human-review │
        └──────────┘        └──────┬────────┘           └──────┬───────┘
              │                    │                           │
              │                    │ complete                  │ accept
              │                    ▼                           ▼
              │              ┌─────────┐ archive    ┌────────────┐
              └─────────────▶│  done   │───────────▶│  archived  │
                fail         └─────────┘            └────────────┘
                                  ▲                        ▲
                                  │                        │
                          ┌───────┴────┐ archive            │
                          │   failed   │────────────────────┘
                          └────────────┘
```

| Event | from | to | Who fires it |
| --- | --- | --- | --- |
| `start` | `queued` | `agent-running` | Maestro? No — operator/agent (maestro only polls; doesn't mutate task state) |
| `complete` | `agent-running` | `done` | Agent (turn-end tool call) |
| `handoff` | `agent-running` | `human-review` | Agent (when workflow says "stop here for human") |
| `accept` | `human-review` | `done` | Human |
| `fail` | `agent-running`, `human-review` | `failed` | Agent or human |
| `archive` | `done`, `failed` | `archived` | Human |

With this machine, the maestro's defaults change:

| Field | Default state machine | This recommended machine |
| --- | --- | --- |
| `active_states` | `["planned", "in-progress"]` | `["queued"]` |
| `terminal_states` | `["done", "archived"]` | `["done", "human-review", "failed", "archived"]` |

`human-review` is terminal *to the maestro* — once a task lands there the daemon stops working it and cleans the workspace. The human moves it forward via `accept` or `fail` in the tracker UI.

The constant is exported as `maestroTaskStateMachine` from `@poe-code/maestro`. It's documentation + a default; nothing in v1 requires operators to use it.

### Retry math

```ts
// retry.ts
export function backoffMs(attempt: number, capMs: number): number {
  return Math.min(10_000 * 2 ** (attempt - 1), capMs);
}
export const CONTINUATION_DELAY_MS = 1_000;
```

`onWorkerExit({ reason: "normal" })` → `scheduleRetry(id, 1, CONTINUATION_DELAY_MS)`.
`onWorkerExit({ reason: "abnormal", attempt })` → `scheduleRetry(id, attempt + 1, backoffMs(attempt + 1, cap))`.

### Reconciliation

Per tick, refresh task state for every running id via `tasks.get(id)` (or treat `TaskNotFoundError` as terminal-equivalent):

- `task.state ∈ terminal_states` (or task not found) → kill worker, remove workspace dir, release claim.
- `task.state ∈ active_states` → update in-memory snapshot.
- otherwise (some intermediate state like `draft` / `planned` that's been removed from the active set mid-run) → kill worker, keep workspace, release claim.

Refresh failures (network/auth) keep workers running and retry next tick.

### Safety invariants

Three checks before any agent launch (fail closed):

1. `resolve(workspacePath).startsWith(resolve(workspace.root) + sep)` — path-containment.
2. `cwd === workspacePath` passed to `agent-spawn`.
3. workspace-dir name matches `^[A-Za-z0-9._-]+$` (sanitize: replace others with `_`).

### Edge cases

- Empty front matter → `tasks:` block missing → preflight fails with `missing_tasks_config`. Validation also requires `agent.list` to identify which list to poll.
- Empty prompt body → falls back to `"{{ task.qualifiedId }}: {{ task.name }}\n\n{{ task.description }}"`.
- `$VAR` resolving to empty string → treat as missing, fail preflight.
- Unknown step-template variable → `interpolatePipelineVars` throws `Missing pipeline variable "x" in step "<name>"`; that step fails with `prompt_render_error`. Whole pipeline fails; retry queued.
- No `steps.yaml` found at either project or global path → preflight fails with `missing_steps_config`. The maestro requires at least one step.
- Empty `steps:` map (file present, no entries) → preflight fails with `no_steps_defined`.
- `step_overrides` references a step name not in `steps.yaml` → `loadResolvedSteps` happily synthesizes it; if the override doesn't include `prompt`, it throws `Missing prompt for plan step "<name>"`. We surface that as preflight failure.
- SIGINT / SIGTERM → cancel poll timer, abort the current step via `agent-spawn`'s plugin abort, skip remaining steps, run `teardown` best-effort with 10s budget, release file lock, exit 0.
- Two daemons on same workflow file → second exits non-zero with `file_lock_held`.
- Task deleted from store mid-pipeline → reconciliation between steps sees `TaskNotFoundError` → treat as terminal (worker enters `canceled`, workspace cleaned).
- `agent.list` is not in `taskList.lists()` → preflight fails with `list_not_found`.
- `setup` step fails → no `steps[*]` run; `teardown` still runs best-effort.
- A `step` fails → remaining steps skipped; `teardown` still runs best-effort.
- `teardown` fails → logged, ignored. Pipeline outcome is whatever the steps decided.

### Config defaults (cheat sheet)

| Field | Default | Source |
| --- | --- | --- |
| `polling.interval_ms` | 30_000 | spec |
| `workspace.root` | `<os.tmpdir()>/poe-code-maestro` | spec-equiv |
| `agent.max_concurrent_agents` | **1** | poe-code sequential-only assumption |
| `agent.max_turns` | 20 | spec |
| `agent.max_retry_backoff_ms` | 300_000 | spec |
| `active_states` | `["planned", "in-progress"]` | default state machine |
| `terminal_states` | `["done", "archived"]` | default state machine |
| `tasks` | required (no default) | passed through to `openTaskList` |
| `agent.list` | required (no default) | which list to poll |
| `agent.service` | `codex` | agent-spawn default; per-step `agent:` in `steps.yaml` overrides |
| `step_overrides` | `{}` (none) | merged into `loadResolvedSteps` |

## 4. Interfaces and test plan

### Public SDK

```ts
// packages/maestro/src/index.ts
import type { Task, TaskList, OpenTaskListOptions } from "@poe-code/task-list";
import type { spawn } from "@poe-code/agent-spawn";

export interface RunMaestroOptions {
  workflowPath?: string;          // default: ./WORKFLOW.md
  maxConcurrent?: number;         // overrides agent.max_concurrent_agents
  pollIntervalMs?: number;        // overrides polling.interval_ms
  list?: string;                  // overrides agent.list
  dryRun?: boolean;
  onEvent?: (e: MaestroEvent) => void;
  taskList?: TaskList;            // injection: skip openTaskList(frontmatter.tasks)
  agentSpawn?: typeof spawn;      // injection seam for tests
  logger?: Logger;
}

export type MaestroEvent =
  | { type: "tick_started"; at: string }
  | { type: "dispatch"; task_id: string; qualified_id: string; workspace: string }
  | { type: "attempt_phase"; task_id: string; from: AttemptPhase | null; to: AttemptPhase; step?: string; failure?: FailureCategory }
  | { type: "agent_event"; task_id: string; step: string; session_id: string; event: string; payload?: unknown }
  | { type: "worker_exit"; task_id: string; reason: "normal" | "abnormal"; failure?: FailureCategory; failedStep?: string; error?: string }
  | { type: "reconcile"; task_id: string; action: "stop_clean" | "stop_keep" | "update" }
  | { type: "retry_scheduled"; task_id: string; attempt: number; due_in_ms: number }
  | { type: "validation_failed"; reason: string };

export { type AttemptPhase, type FailureCategory } from "./runtime/phases.js";
export { maestroTaskStateMachine } from "./state-machine.js";

export function runMaestro(opts?: RunMaestroOptions): Promise<() => Promise<void>>;
```

### CLI declaration (cmdkit-schema)

```ts
defineCommand({
  name: "maestro",
  positional: { path: { type: "string", default: "./WORKFLOW.md" } },
  options: {
    maxConcurrent: { type: "number", short: "c" },
    pollIntervalMs: { type: "number" },
    list: { type: "string" },
    dryRun: { type: "boolean" },
    yes: { type: "boolean" },
    logLevel: { type: "string", default: "info" },
  },
  run: async (args) => { /* calls runMaestro */ },
});
```

### Tests (vitest + memfs, no real network/FS)

Every test uses an in-memory `markdown-dir` task store (memfs-backed) or a hand-rolled mock `TaskList`. `gh-issues` backend is not unit-tested here — that's covered by `@poe-code/task-list`'s own suite.

| File | Proves |
| --- | --- |
| `config/load.spec.ts` | front-matter split, missing file → typed error, non-map YAML → typed error, body-only file → empty config |
| `config/schema.spec.ts` | defaults applied, `$VAR` resolution, `~` expansion, missing `tasks`/`agent.list` → preflight failure, default active/terminal state lists |
| `runtime/sanitize.spec.ts` | `ENG-412` → `ENG-412`; `octo-org/7/412` → `octo-org_7_412`; `foo/bar baz` → `foo_bar_baz`; empty → throws |
| `runtime/phases.spec.ts` | every legal transition in `ATTEMPT_TRANSITIONS` accepted; every illegal one rejected; failure categories preserved through `failed` |
| `state-machine.spec.ts` | `maestroTaskStateMachine` passes `validateMachine`; canonical `queued → agent-running → human-review` path fires cleanly; illegal transitions throw `InvalidTransitionError` |
| `workspace/manager.spec.ts` | new dir created → `created_now=true`; existing dir → `created_now=false`; path-escape attempt rejected (`../foo`, absolute outside root); terminal cleanup removes only workspaces whose key matches a terminal task |
| `prompt/render.spec.ts` | renders `{{ task.qualifiedId }}`, `{{ task.name }}`, `{{ attempt }}`; unknown var throws; empty body → fallback |
| `runtime/retry.spec.ts` | backoff math at attempts 1..10 with cap; continuation = 1000ms; `canceled` phase → no retry; `succeeded` → continuation; other terminal phases → backoff retry |
| `runtime/state.spec.ts` | claim/release symmetry; double-claim rejected; running/retry sets disjoint |
| `runtime/loop.spec.ts` | tick = reconcile → preflight → fetch → sort → dispatch; preflight fail skips dispatch but still reconciles; sort by `metadata.priority` asc (null last) then `metadata.createdAt` then `qualifiedId` |
| `runtime/reconcile.spec.ts` | terminal → kill+cleanup + worker ends in `canceled`; non-active non-terminal → kill no cleanup; active → snapshot updated; `TaskNotFoundError` → terminal; refresh failure → workers stay |
| `agent/runner.spec.ts` | three steps `implement`/`test`/`commit` run in order; each step gets correct `agent`/`model`/`mode`; `{{ prompt }}` is the rendered task body; phase sequence `preparing-workspace → running-step(implement) → running-step(test) → running-step(commit) → succeeded`; mid-step abort → `canceled` and remaining steps skipped; `setup` failure aborts but still runs `teardown`; reconcile-to-terminal between steps → `canceled` |
| `integration.spec.ts` | full tick against an in-memory markdown-dir store + real `loadResolvedSteps` (memfs-backed `.poe-code/pipeline/steps.yaml`) + mock spawn: dispatch one task, observe full phase sequence + per-step `agent_event`s, fire `complete` event externally, reconcile to terminal, workspace removed |
| `integration-recommended-sm.spec.ts` | same flow but with `maestroTaskStateMachine`: task starts in `queued`, dispatched, agent fires `handoff` mid-pipeline, maestro sees `human-review` → cancel remaining steps + cleanup + no retry |

### Rollout

No existing callers. New CLI command, new package — fully additive.

### Autonomy checklist

An agent executing this plan needs to:

- Create `packages/maestro/` with `package.json` (deps: `@poe-code/task-list`, `@poe-code/pipeline`, `@poe-code/markdown-reader`, `@poe-code/poe-code-config`, `@poe-code/agent-spawn`, `@poe-code/file-lock`).
- Run `npm install` from repo root after package skeleton is in place.
- Implement modules in the build order from §5; each module has its tests passing before moving on.
- Wire CLI in [src/cli/program.ts](src/cli/program.ts) — register `maestro` command alongside `superintendent`, `pipeline`.
- Add README.md to package: env vars (any consumed by chosen task-list backends — `GH_HOST` for gh-issues), config fields, example `WORKFLOW.md` for each backend, and a pointer at the pipeline package's docs for `steps.yaml`.
- Use `memfs` for all fs tests. For task-store fakes, prefer constructing a real `markdown-dir` `TaskList` against memfs over hand-mocking `Tasks`. For step-file fakes, write a real `steps.yaml` into memfs and let `loadResolvedSteps` parse it — do not mock the loader.
- Run `npm run lint`, `npm run test -- packages/maestro`, and a manual `--dry-run` invocation against a fake `WORKFLOW.md` (markdown-dir backend with three seeded tasks) and a fake `steps.yaml` before declaring done.

## 5. Code plan

### Files to create

| File | Purpose |
| --- | --- |
| `packages/maestro/package.json` | Deps + scripts |
| `packages/maestro/README.md` | Env vars, config, example workflows (one per backend) |
| `packages/maestro/src/index.ts` | Re-exports public types + `runMaestro` |
| `packages/maestro/src/config/load.ts` | `loadWorkflow(path): WorkflowDefinition` |
| `packages/maestro/src/config/schema.ts` | `resolveConfig(raw, cwd): ResolvedConfig`, defaults, `$VAR`, picks up `step_overrides` |
| `packages/maestro/src/config/validate.ts` | `validateDispatch(cfg, taskList, steps): { ok: true } \| { ok: false; error }` |
| `packages/maestro/src/runtime/sanitize.ts` | `sanitizeWorkspaceKey` |
| `packages/maestro/src/runtime/phases.ts` | `AttemptPhase`, `FailureCategory`, `ATTEMPT_TRANSITIONS`, `transitionPhase()` |
| `packages/maestro/src/runtime/state.ts` | `createState()`, claim/release/dispatch/retry mutators |
| `packages/maestro/src/runtime/loop.ts` | `tick(state, deps): Promise<void>`; sort/dispatch logic |
| `packages/maestro/src/runtime/retry.ts` | `backoffMs`, `CONTINUATION_DELAY_MS`, `scheduleRetry`, `shouldRetry(phase, failure)` |
| `packages/maestro/src/runtime/reconcile.ts` | `reconcileRunning(state, deps): Promise<void>` |
| `packages/maestro/src/state-machine.ts` | `maestroTaskStateMachine: StateMachineDef` constant |
| `packages/maestro/src/workspace/manager.ts` | `ensureWorkspace`, `removeWorkspace`, `startupTerminalCleanup` |
| `packages/maestro/src/prompt/render.ts` | `renderTaskPrompt(template, { task, attempt }): string` — thin wrapper around `interpolatePipelineVars` |
| `packages/maestro/src/agent/runner.ts` | `runAttempt(task, deps): Promise<AttemptOutcome>` — walks `setup → steps[*] → teardown`, calls `agent-spawn` per step, checks reconcile between steps |
| `packages/maestro/src/logging.ts` | `createLogger`, key=value formatting |
| `packages/maestro/test/*.spec.ts` | per the test table in §4 |

### Files to change

| File | Change |
| --- | --- |
| `src/cli/program.ts` | Register `maestro` command (calls into `@poe-code/maestro`) |
| `package.json` (workspace root) | Add `packages/maestro` to workspaces if not glob-covered |
| `tsconfig.base.json` or equivalent | Path mapping for `@poe-code/maestro` if used |

No changes to `task-list`, `pipeline`, `agent-spawn`, `markdown-reader`, `poe-code-config`, `file-lock`.

### New / modified function signatures

```ts
import type { OpenTaskListOptions, Task, TaskList } from "@poe-code/task-list";
import type { ResolvedStepsConfig, StepDefinitionOverrides } from "@poe-code/pipeline";

// config/load.ts
export function loadWorkflow(path: string): Promise<WorkflowDefinition>;
export interface WorkflowDefinition { config: unknown; promptTemplate: string; sourcePath: string }

// config/schema.ts
export function resolveConfig(raw: unknown, cwd: string): ResolvedConfig;
export interface ResolvedConfig {
  tasks: OpenTaskListOptions;
  active_states: string[];
  terminal_states: string[];
  polling: { intervalMs: number };
  workspace: { root: string };
  agent: { service: string; list: string; maxConcurrentAgents: number; maxRetryBackoffMs: number };
  stepOverrides: StepDefinitionOverrides;
}

// runtime/sanitize.ts
export function sanitizeWorkspaceKey(qualifiedId: string): string;

// workspace/manager.ts
export function ensureWorkspace(root: string, qualifiedId: string): Promise<{ path: string; createdNow: boolean }>;
export function removeWorkspace(root: string, qualifiedId: string): Promise<void>;
export function startupTerminalCleanup(root: string, terminalQualifiedIds: string[]): Promise<{ removed: number }>;

// prompt/render.ts
export function renderTaskPrompt(template: string, vars: { task: Task; attempt: number | null }): string;
export function renderStepPrompt(step: StepDefinition, vars: { prompt: string; task: Task; attempt: number | null }): string;

// runtime/state.ts
export function createState(cfg: ResolvedConfig): MaestroState;
export function claim(state: MaestroState, taskId: string): boolean;
export function release(state: MaestroState, taskId: string): void;
export function markRunning(state: MaestroState, entry: RunningEntry): void;
export function markCompleted(state: MaestroState, taskId: string): void;
export function scheduleRetry(state: MaestroState, entry: RetryEntry): void;
export function cancelRetry(state: MaestroState, taskId: string): void;

// runtime/loop.ts
export interface Deps {
  tasks: TaskList;
  steps: ResolvedStepsConfig;
  cfg: ResolvedConfig;
  spawn: typeof import("@poe-code/agent-spawn").spawn;
  onEvent?: (e: MaestroEvent) => void;
  logger: Logger;
}
export function tick(state: MaestroState, deps: Deps): Promise<void>;

// runtime/reconcile.ts
export function reconcileRunning(state: MaestroState, deps: Deps): Promise<void>;

// agent/runner.ts
export interface AttemptOutcome { reason: "normal" | "abnormal"; failure?: FailureCategory; failedStep?: string; error?: string }
export function runAttempt(args: { task: Task; attempt: number | null; cfg: ResolvedConfig; steps: ResolvedStepsConfig; deps: Deps; abort: AbortSignal }): Promise<AttemptOutcome>;

// index.ts
export function runMaestro(opts?: RunMaestroOptions): Promise<() => Promise<void>>;
```

### Build order (keeps main green at every step)

1. Scaffold package, `package.json`, empty `src/index.ts`, README skeleton. Add to workspaces. `npm run build` passes.
2. `runtime/sanitize.ts` + tests.
3. `runtime/phases.ts` + tests (pure transition table; no IO).
4. `state-machine.ts` (`maestroTaskStateMachine`) + tests (uses `validateMachine` from task-list).
5. `config/load.ts` + `config/schema.ts` + `config/validate.ts` + tests (validate the steps file via `loadResolvedSteps` from pipeline).
6. `prompt/render.ts` + tests (`renderTaskPrompt`, `renderStepPrompt`, both delegating to `interpolatePipelineVars`).
7. `workspace/manager.ts` + tests (memfs).
8. `runtime/retry.ts` + `runtime/state.ts` + tests (retry policy reads phase + failure category).
9. `runtime/reconcile.ts` + tests (in-memory markdown-dir `TaskList` against memfs).
10. `agent/runner.ts` + tests (mock `agent-spawn`; assert phase + step sequence; setup-fail / step-fail / teardown-fail / mid-step-cancel paths).
11. `runtime/loop.ts` + tests.
12. `index.ts` wiring + integration tests (default state machine + recommended state machine, both using a real `steps.yaml` in memfs).
13. `src/cli/program.ts` registers the command.
14. Manual `--dry-run` smoke test against a hand-written `WORKFLOW.md` + the existing `.poe-code/pipeline/steps.yaml` in this repo.

### v2 follow-ups (separate plans, not this one)

Shell hooks subsystem; dynamic `WORKFLOW.md` watch/reload; per-state concurrency; stall detection; HTTP server + `/api/v1/*`; SSH worker extension; token + rate-limit aggregation; restart recovery with persisted retry queue; multi-list polling in one daemon; agent-side `tasks.fire` tool surface; Linear backend in `@poe-code/task-list` (new file in that package, not here).
