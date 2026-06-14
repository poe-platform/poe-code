---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: driver-interface
    title: WorkflowDriver interface and registry in maestro
    prompt: >
      Add a pluggable workflow driver layer to `@poe-code/maestro`.


      Create `packages/maestro/src/drivers/types.ts` defining:


      ```ts

      export interface WorkflowDriverContext {
        task: Task;                       // from @poe-code/task-list
        attempt: number | null;
        workspaceDir: string;
        planPath: string | null;          // absolute path to the task's source doc, or null for backends without files (gh-issues)
        cfg: ResolvedConfig;              // maestro config
        steps: ResolvedStepsConfig;       // pipeline steps, kept for pipeline driver and as a shared resource
        abort: AbortSignal;
        emit: (event: AttemptEvent) => void;
        spawn: typeof import("@poe-code/agent-spawn").spawn;
        logger: { warn(msg: string, meta?: Record<string, unknown>): void };
      }


      export interface WorkflowDriver {
        readonly kind: string;            // matches plan frontmatter `kind:`
        run(ctx: WorkflowDriverContext): Promise<AttemptOutcome>;
      }

      ```


      Create `packages/maestro/src/drivers/registry.ts` exposing:


      - `registerDriver(driver: WorkflowDriver): void`

      - `getDriver(kind: string): WorkflowDriver | undefined`

      - `listDrivers(): readonly WorkflowDriver[]`


      Registry is a module-level Map keyed by `kind`. `registerDriver` is

      idempotent on identical (===) driver instances and throws on a kind

      collision with a different instance.


      Export both modules from `packages/maestro/src/index.ts`.


      Constraints:

      - Do not touch `AttemptRunner` yet — this task is types and registry only.

      - No driver implementations in this task.

      - Re-use existing `AttemptOutcome` / `AttemptEvent` from `agent/runner.ts`
        (move them to a sibling file if importing causes a cycle).
      - Tests in `drivers/registry.test.ts`: register/get/list; collision
      throws;
        idempotent on same instance.

      Conventional commit: `feat(maestro): workflow driver interface and
      registry`.
    status:
      implement: done
      test: done
      commit: done
  - id: pipeline-driver
    title: Extract current pipeline behavior into PipelineDriver
    prompt: |
      Move the body of `AttemptRunner.run()` into a new
      `packages/maestro/src/drivers/pipeline.ts` exporting a
      `pipelineDriver: WorkflowDriver` with `kind: "pipeline"`.

      The driver receives `WorkflowDriverContext` and must reproduce today's
      behavior exactly: setup -> each named step -> teardown, with the same
      retry/cancel/abort/phase-transition semantics.

      Refactor `AttemptRunner` to:
      1. Resolve a driver via `getDriver(planKind)`, where `planKind` is read
         from `task.metadata.kind` if present, otherwise defaults to
         `"pipeline"` (preserves behavior for tasks without a `kind:` field,
         e.g. yaml-file backend).
      2. Throw a clear "no driver registered for kind X" error if missing.
      3. Construct `WorkflowDriverContext` and call `driver.run(ctx)`.

      Register `pipelineDriver` at maestro module load (alongside any
      future built-ins) in a new `packages/maestro/src/drivers/index.ts`
      that calls `registerDriver(pipelineDriver)`. `src/index.ts` imports
      this for side effects.

      Constraints:
      - Zero behavior change for existing pipeline tasks. All existing
        `maestro` tests must pass with no test edits except imports.
      - Phase transitions, retry backoff, and `AttemptEvent` shapes are
        unchanged.
      - `runner.ts` becomes the thin coordinator; the pipeline-specific
        step loop lives entirely in `drivers/pipeline.ts`.

      Tests: existing `agent/runner.test.ts` must pass. Add one test verifying
      that a task with `metadata.kind: "pipeline"` and one without both route
      through `pipelineDriver`.

      Conventional commit: `refactor(maestro): extract pipeline driver`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: expose-plan-path
    title: Expose plan file path through task-list and maestro
    prompt: >
      Drivers other than `pipeline` need the absolute path to the plan's

      source markdown file (ralph reads/writes frontmatter on it in place).

      `task-list`'s `Task` interface intentionally hides storage details, so

      thread the path through a sibling channel.


      In `packages/task-list/src/types.ts`, add to `Task`:


      ```ts

      sourcePath?: string;     // backend-specific absolute path, set by
      file-based backends

      ```


      Markdown-dir and yaml-file backends populate `sourcePath` when reading

      a task (absolute path to the on-disk file). `gh-issues` leaves it

      `undefined`.


      In `maestro`, set `WorkflowDriverContext.planPath = task.sourcePath
      ?? null`.


      Constraints:

      - Optional field; no existing call sites need updates.

      - Tests in `markdown-dir.test.ts` and `yaml-file.test.ts`: assert
        `sourcePath` is set and absolute on read.
      - Tests in `gh-issues.test.ts`: assert `sourcePath` is `undefined`.


      Conventional commit: `feat(task-list): expose sourcePath on Task`.
    status:
      implement: done
      test: done
      commit: done
  - id: ralph-driver
    title: RalphDriver that delegates to @poe-code/ralph runRalph
    prompt: >
      Add `packages/maestro/src/drivers/ralph.ts` exporting

      `ralphDriver: WorkflowDriver` with `kind: "ralph"`.


      Implementation:


      1. Require `ctx.planPath` to be set; if null, fail the attempt with
         `failure: "step_failed"`, `failedStep: "ralph"`, error message
         "ralph driver requires a file-backed task".
      2. Copy the plan doc into `ctx.workspaceDir` so ralph's
         in-place frontmatter writes don't mutate `docs/plans/`. Use the
         original file's basename. The copy is the canonical doc for the
         attempt.
      3. Call `runRalph` from `@poe-code/ralph` with:
         - `cwd: ctx.workspaceDir`
         - `homeDir: os.homedir()`
         - `docPath: <workspace copy>`
         - `agent`: read from doc frontmatter (ralph already handles this)
         - `maxIterations`: read from doc frontmatter (default in ralph)
         - `runAgent`: wrap `ctx.spawn` — translate ralph's
           `{ agent, prompt, cwd, model, signal }` into a `spawn` call.
         - `signal: ctx.abort`
      4. On success, copy the (possibly updated) doc back to `ctx.planPath`
         so iteration status is persisted to `docs/plans/`. Use a temp file
         + rename for atomicity.
      5. Emit `attempt_phase` with phase `"running-step"` and `step: "ralph"`
         around the call; emit `agent_event` for each ralph iteration that
         completes (use ralph's existing event hooks if exposed, else emit
         one event per `runAgent` invocation).
      6. Map ralph result to `AttemptOutcome`:
         - normal completion -> `{ reason: "normal" }`
         - ralph reports failure -> `{ reason: "abnormal", failure: "step_failed", failedStep: "ralph", error: <message> }`
         - abort / cancel -> `{ reason: "abnormal", failure: "canceled" }`
         - activity timeout from spawn -> `failure: "step_timeout"`

      Register `ralphDriver` in `drivers/index.ts`.


      Add `@poe-code/ralph` as a regular `dependencies` entry in

      `packages/maestro/package.json`. Do not use optional peers.


      Tests in `drivers/ralph.test.ts`:

      1. Drives a 1-iteration plan to completion; verifies the workspace
         copy was edited and the original was overwritten.
      2. `planPath === null` fails with the expected outcome.

      3. Abort mid-iteration produces `failure: "canceled"`.

      4. Spawn throwing an activity timeout yields `failure: "step_timeout"`.

      5. The `runAgent` wrapper forwards `agent`, `prompt`, `model`, `signal`
         to `spawn` unchanged.

      Use memfs + a mock `runAgent` (do not invoke real agents in unit tests).


      Conventional commit: `feat(maestro): ralph workflow driver`.
    status:
      implement: done
      test: done
      commit: done
  - id: kind-validation
    title: Validate task kind at dispatch and surface unsupported kinds early
    prompt: >
      Today `runMaestro` opens the task store and silently dispatches

      anything in `active_states`. With pluggable drivers, a task whose

      plan declares `kind: superintendent` (no driver registered) must fail

      fast with an actionable error rather than crashing inside the runner.


      Changes in `packages/maestro/src/runtime/loop.ts` `tick()`:


      1. Before acquiring a dispatch slot for a task, read
         `task.metadata.kind` (default `"pipeline"`).
      2. If `getDriver(kind) === undefined`, emit a new event
         `{ type: "task_skipped"; task_id; reason: "unsupported_kind"; kind }`
         and skip the task this tick. Do not transition state.
      3. Add `task_skipped` to `MaestroEvent` and `TickEvent`.


      In `--dry-run`, the CLI surface reports the count of skipped tasks

      and lists their kinds in the log line that today reports

      `candidates`.


      Tests in `runtime/loop.test.ts`:

      1. Task with `kind: "pipeline"` and pipeline driver registered:
      dispatched.

      2. Task with `kind: "ralph"` and only pipeline registered: skipped,
         event emitted.
      3. Task with no `kind`: dispatched via pipeline (default).


      Conventional commit: `feat(maestro): skip tasks with unsupported
      workflow kind`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: docs-readme
    title: Document workflow drivers in maestro README
    prompt: >
      Update `packages/maestro/README.md`:


      - New section "Workflow drivers" between "Examples" and the existing
        sections. Lists the built-in drivers (`pipeline`, `ralph`) and
        explains that the driver is chosen from the task's plan doc
        frontmatter `kind:` field, defaulting to `pipeline` when absent.
      - Add a row to the agent-config table noting that for `ralph` tasks,
        `agent.service` is ignored (ralph reads its agent from the plan
        frontmatter).
      - Add a `gh-issues` caveat: ralph driver requires a file-backed
        backend; gh-issues tasks always use pipeline.
      - Update the `markdown-dir` example WORKFLOW.md to include a
        `tasks` block with `frontmatterMode: passthrough` and `singleList: plans`
        as one of the example flavors, since that is what plan-docs-as-tasks
        configurations use.

      No code changes. Documentation only.


      Conventional commit: `docs(maestro): workflow drivers and ralph
      integration`.
    status:
      implement: done
      commit: done
  - id: deferred-drivers
    title: Stubs for experiment, superintendent, harness drivers
    prompt: >
      Not in use today but the registry should be obvious to extend. Add

      three placeholder files under `packages/maestro/src/drivers/`:


      - `experiment.ts`: `experimentDriver` with `kind: "experiment"` whose
        `run()` throws `Error("experiment driver not implemented")`. Not
        auto-registered.
      - `superintendent.ts`: same pattern, `kind: "superintendent"`.

      - `harness.ts`: same pattern, `kind: "harness"`.


      Each file imports the relevant package's public entry point as a

      type-only import so changes there get caught at build time:


      ```ts

      import type { runLoop } from "@poe-code/superintendent";

      ```


      Add `@poe-code/experiment-loop`, `@poe-code/superintendent`,

      `@poe-code/agent-harness` to `maestro` `dependencies`.


      `drivers/index.ts` documents (in a one-line comment) that these

      drivers exist but are not registered by default; users opt in by

      calling `registerDriver(experimentDriver)` from their own code.


      No tests for the stubs themselves; the registry tests already cover

      register/get.


      Conventional commit: `feat(maestro): scaffold
      experiment/superintendent/harness driver stubs`.
    status:
      implement: done
      commit: done
name: maestro-workflow-drivers
state: archived
---

# Maestro workflow drivers

Maestro picks tasks from a task list and runs work against each. Today the "work" is hardcoded to a pipeline of agent-spawn invocations driven by `.poe-code/pipeline/steps.yaml`. Plan documents in `docs/plans/` already declare a `kind:` field (`pipeline`, `ralph`, `experiment`, `superintendent`, `harness`); maestro should honor it.

## Why

Plan kinds describe different execution shapes:

- `pipeline` — sequential agent-spawn steps with retry semantics. Already implemented.
- `ralph` — iterative loop on a single doc; agent and iteration count live in the doc's frontmatter. Implemented in `@poe-code/ralph` as `runRalph`.
- `experiment`, `superintendent`, `harness` — declared in the codebase but not in active use.

A plan with `kind: ralph` is unrunnable today because maestro's `AttemptRunner` only knows pipeline steps. The fix is a `WorkflowDriver` registry keyed by `kind`, with the pipeline path lifted into a `pipelineDriver` and a new `ralphDriver` added.

## Shape

1. `WorkflowDriver` interface + module-level registry (`registerDriver` / `getDriver`).
2. `AttemptRunner` becomes a thin coordinator that resolves a driver from `task.metadata.kind` (default `"pipeline"`) and delegates.
3. `pipelineDriver` is the current implementation, extracted with no behavior change.
4. `ralphDriver` wraps `@poe-code/ralph` `runRalph`; uses the task's source file (exposed via `task.sourcePath` from file-based backends), copies it into the workspace, runs the loop, copies the updated doc back.
5. `tick()` skips tasks whose declared kind has no registered driver; emits a `task_skipped` event with the kind.
6. `experiment`, `superintendent`, `harness` get stub driver files that exist but are not registered by default — opting in is a one-line user call.

## Constraints

- No behavior change for existing pipeline tasks.
- `@poe-code/ralph` is a normal `dependencies` entry on `maestro`. Not optional, not a peer.
- `task-list`'s `Task` gains an optional `sourcePath` for file-based backends; `gh-issues` leaves it undefined and is therefore pipeline-only for now.
- Ralph driver mutates a copy in the workspace and rsyncs the result back to `docs/plans/`, so the on-disk plan remains the source of truth across attempts.

## Out of scope

- Implementing experiment / superintendent / harness drivers (stubs only).
- Mixed-kind composition (e.g. a pipeline step that runs ralph).
- gh-issues parity for ralph (would require a path-less ralph mode).
