---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: add-stateless-tick-subcommand
    title: Add stateless `maestro tick` CLI subcommand
    prompt: |
      Add a new subcommand `poe-code maestro tick` in
      packages/maestro/src/cli (or wherever maestro registers its
      CLI; check src/cli/program.ts around lines 473-554 for where the
      existing `maestro` and `maestro tui` are wired).

      Signature:
        poe-code maestro tick --task <qualifiedId>
                              --transition <fromState>:<toState>
                              [--list <name>]
                              [--config <path>]

      Behavior:
      - Load the configured task-list backend via the same
        `OpenTaskListOptions` path the daemon uses (config/schema.ts:20).
      - Read the task by `qualifiedId`. If not found, exit non-zero with
        a clear message.
      - Validate that `--transition` matches a real state-machine edge
        in packages/maestro/src/runtime/state-machine.ts. If not,
        exit non-zero.
      - For this task, emit a MaestroEvent of kind `tick_started` to
        stdout (NDJSON, one event per line, matching existing event
        shape exported from packages/maestro/src/index.ts:39-71).
      - No retry queue. No in-memory `running`/`claimed`/`completed`
        maps. No worker spawning yet — that comes in a later task.
      - Exit 0 on clean run.

      The point: a stateless one-shot that any external trigger (GitHub
      Actions, a git hook, a TUI key) can invoke. Each invocation is a
      fresh process. No cross-invocation state.

      TDD: write tests first using memfs + an in-memory fake task-list
      backend. Cover: unknown task id, invalid transition, valid
      transition produces expected event, exits cleanly.
    status:
      implement: done
      test: done
      commit: done
  - id: dispatch-on-queued-transition
    title: Dispatch via label/state change on `*:queued` transition
    prompt: |
      Extend `poe-code maestro tick` so that when the transition is
      `*:queued`, it advances the task to `agent-running` via the
      task-list backend's existing API
      (packages/task-list/src/types.ts:48-62 — likely `.fire(id, event)`
      or `.update(id, ...)`; check what the daemon currently calls in
      packages/maestro/src/runtime/loop.ts around lines 213-235).

      Critically: the tick does NOT spawn a worker process. In the
      stateless / GH Actions model, the worker is a separate workflow
      job triggered by the resulting label change on the issue. The
      tick's only responsibility on `*:queued` is to apply the state
      transition through the backend and exit.

      Extract whatever shared "advance to running" logic exists in the
      daemon loop into a function callable by both daemon and tick, so
      we don't duplicate. Do not refactor unrelated daemon code.

      TDD: test with the gh-issues backend mocked (no real network).
      Verify the backend receives the right call and only that call.
      Verify tick exits 0. Verify a transition that isn't `*:queued`
      is a no-op for dispatch (still emits the tick_started event,
      still exits 0).
    status:
      implement: done
      test: done
      commit: done
  - id: gh-actions-workflow-template
    title: Add GitHub Actions workflow template for turn-based maestro
    prompt: |
      Add a workflow template under
      .github/workflow-templates/maestro-turn.yml (or, if that
      directory isn't conventional in this repo, under
      docs/examples/maestro/turn-workflow.yml — check existing patterns
      first; do not invent a new location).

      The template demonstrates the turn-based wiring on the gh-issues
      backend:
      - Trigger: `on: issues` with `types: [labeled, unlabeled,
        opened]`.
      - Concurrency: a per-issue group keyed on the issue number from
        the event context, so two near-simultaneous events on the same
        issue serialize.
      - Steps:
        1. Checkout.
        2. Setup Node (use repo's standard action version).
        3. Install poe-code (npm i -g or npx).
        4. Derive `from` and `to` from the event payload. Label added
           means the added label is the `to` state and the previous
           state must be inferred (read the issue's current label set
           and pick the one that's a known maestro state). Label
           removed means the removed label is the `from`. The opened
           action maps to a `:queued` transition.
        5. Invoke `poe-code maestro tick --task <issue-number>
           --transition <from>:<to>` with the values from step 4.
      - Use a secret named MAESTRO_GH_TOKEN (a PAT or GitHub App
        token) for any push/label step so that downstream label
        changes re-fire this workflow. The default workflow token
        will not chain.

      No unit tests for the workflow per CLAUDE.md. Run `npm run
      lint:workflows` after writing.
    status:
      implement: done
      commit: done
  - id: document-turn-mode
    title: Document turn-based maestro mode in maestro README
    prompt: |
      Update packages/maestro/README.md with a new section
      "Turn-based mode" covering:

      - What it is: each iteration is one short-lived process driven
        by an external event, with no in-memory state across
        invocations. Contrast with the existing daemon mode.
      - When to use it: GitHub Actions, git hooks, any environment
        where you can't or don't want to keep a long-running process.
      - CLI: `poe-code maestro tick --task <id> --transition
        <from>:<to>`. List all flags.
      - The gh-issues backend: a pointer to the task-list package's
        gh-issues backend
        (packages/task-list/src/backends/gh-issues.ts) and how to
        configure it.
      - Limitation: no time-based retries in this mode. If you need
        backoff, run the daemon. Retries are in-memory only and
        intentionally lost on restart in both modes.
      - GitHub Actions gotcha: workflows triggered by `GITHUB_TOKEN`
        do not chain. Use a PAT or GitHub App token to keep the chain
        alive.
      - Link to the workflow template added in the previous task.

      Do not duplicate existing daemon-mode docs; reference them. Keep
      the section terse — no marketing prose.

      Per CLAUDE.md, README must list any new env vars or config
      options exposed. The `--config` flag and any `MAESTRO_GH_TOKEN`
      env requirement count.
    status:
      implement: done
      commit: done
name: maestro-turn-mode
state: archived
---

# Context

## Goal

Add a stateless, event-driven flavor of `maestro` that can be invoked
once per status change instead of running as a long-lived daemon. The
driving use case is GitHub Actions: workflows fire on issue label
changes and invoke `maestro tick` with the transition in the event
payload.

## Why now

The current `runMaestro()` in
[packages/maestro/src/index.ts:168](packages/maestro/src/index.ts#L168)
is a `setInterval`-driven daemon. It owns several in-memory state
containers (`running`, `claimed`, `retry_attempts`, `completed` in
[packages/maestro/src/runtime/state.ts:17-23](packages/maestro/src/runtime/state.ts#L17-L23))
that don't survive a process restart. That model doesn't fit GitHub
Actions, where every event is a fresh process and the platform owns
"what's in flight" via concurrency groups and the runs API.

## Architectural decisions

- **Two coexisting modes, one storage layer.** The existing daemon
  stays as-is. The new `maestro tick` subcommand is the stateless
  flavor. Both read/write through the existing
  [task-list backend abstraction](packages/task-list/src/types.ts#L48-L62);
  no new storage layer.
- **GitHub Issues is the source of truth in turn-based mode.** The
  `gh-issues` backend already exists at
  [packages/task-list/src/backends/gh-issues.ts](packages/task-list/src/backends/gh-issues.ts)
  and is sibling to the file backends. No state files in the repo.
  Labels are the state machine; issue events are the trigger.
- **Each tick is scoped to one task.** Args carry "what moved"
  (`--task` + `--transition`). No scanning the full task list per
  invocation. This is what makes the tick fit into a per-event GH
  Actions job.
- **No retries in turn-based mode.** Time-based retries
  ([loop.ts:359-388](packages/maestro/src/runtime/loop.ts#L359-L388))
  require a wall clock, which doesn't survive a stateless tick. The
  daemon keeps them. Retries are in-memory only in both modes; on
  restart they are lost, which is acceptable.
- **The tick does not spawn a worker.** In GH Actions, the worker is
  a separate workflow job triggered by the label transition the tick
  applies. This is what keeps the tick truly stateless and
  short-lived.
- **Concurrency safety via GH primitives.** A per-issue
  `concurrency: group` on the workflow serializes near-simultaneous
  events. No need for maestro's internal `claimed` set in this mode.

## Out of scope

- Persisting the retry queue to disk.
- Refactoring the existing daemon beyond extracting shared transition
  helpers needed by the tick.
- A new task-list backend. The `gh-issues` backend already exists.
- Webhook receivers outside GH Actions.
