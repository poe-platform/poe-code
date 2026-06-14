---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: states-schema
    title: Add states map to WORKFLOW.md schema (additive, build stays green)
    prompt: |
      Goal: introduce a `states:` block in WORKFLOW.md frontmatter that
      will unify what is today split across `active_states`,
      `terminal_states`, `step_overrides`, and the implicit "steps come
      from .poe-code/pipeline/steps.yaml" path. THIS TASK IS ADDITIVE
      ONLY — the new fields land alongside the old ones so the build
      stays green. The next task (state-driven-driver) removes the old
      fields and rewires the runtime in one coherent change. The
      pipeline package's own `steps.yaml` mechanism is a separate
      feature for standalone `poe-code pipeline run` and must not be
      touched.

      Files:
      - packages/maestro/src/config/schema.ts
      - packages/maestro/src/config/validate.ts
      - Do NOT modify index.ts, reconcile.ts, or loop.ts in this task.
        They keep reading the old `active_states`/`terminal_states`/
        `step_overrides` fields until the next task swaps them.

      Schema additions:
      - Add `states: Record<string, StateDefinition>` to
        `WorkflowConfig` as REQUIRED (must have at least one entry).
        The map MUST preserve declaration order — read it from the
        parsed YAML as an ordered object/map and expose
        `cfg.stateOrder: readonly string[]` matching that order.
      - `StateDefinition` fields:
        - `prompt` (string, optional) — agent prompt rendered every
          tick the task is in this state.
        - `agent` (string, optional) — overrides workflow-level
          `agent.service`.
        - `model` (string, optional) — overrides the workflow's
          default model.
        - `mode` (`"yolo" | "edit" | "read"`, optional) — defaults to
          `yolo`.
        - `terminal` (boolean, optional) — when `true`, marks the
          state terminal.
      - Validation: a state entry must have exactly one of `prompt` or
        `terminal: true`. Both-or-neither is a validation error.
      - Preserve user-supplied `undefined` for `agent`/`model`/`mode`;
        fallback resolution happens at the driver boundary in the next
        task.
      - Keep `active_states`, `terminal_states`, and `step_overrides`
        on `WorkflowConfig` as they are. The next task removes them.

      Derived views exposed on the typed `WorkflowConfig` (computed once
      at config load):
      - `activeStateNames`: ordered list of states where `prompt` is set.
      - `terminalStateNames`: list of states where `terminal === true`.
      - `stateOrder`: full ordered list of declared state names.

      Tests (TDD, fast unit tests with memfs):
      - schema.test.ts: parse a WORKFLOW.md that declares BOTH a
        `states:` map AND the old `active_states`/`terminal_states`
        fields (simulating mid-migration). Assert that the new typed
        fields appear and the old ones still parse — they coexist.
      - schema.test.ts: ordering preservation —
        `cfg.stateOrder` matches YAML declaration order across at least
        four states.
      - schema.test.ts: a state with `agent: "claude"` and
        `model: "claude-sonnet-4-6"` round-trips those values; a state
        without them keeps `undefined`.
      - validate.test.ts failure cases:
        - state with both `prompt` and `terminal: true`
        - state with neither `prompt` nor `terminal: true`
        - empty `states` map
        - bad `mode` literal
        - missing `states` block (REQUIRED)

      Out of scope:
      - Removing the old `active_states` / `terminal_states` /
        `step_overrides` fields — next task.
      - Wiring the driver to dispatch by state — next task.
      - Adding richer task template variables — separate task.
      - Touching packages/pipeline/* or any disk-based step resolution.
      - Transition guards / role enforcement.
    status:
      implement: done
      test: done
      commit: done
  - id: template-vars
    title: Add task.url and task.metadata to the prompt renderer
    prompt: |
      Goal: the new state-driven prompts need `task.url` (the GH issue
      URL, or empty for file backends) and `task.metadata` (the raw
      backend metadata map). The other documented placeholders —
      `task.id`, `task.qualifiedId`, `task.name`, `task.state`,
      `task.description`, `task.list` — are ALREADY exposed in
      packages/maestro/src/prompt/render.ts:28-33 and require no
      changes.

      Files:
      - packages/maestro/src/prompt/render.ts (the actual
        renderer; the DEFAULT_TASK_PROMPT and the variable map are at
        the top of the file).
      - packages/maestro/src/prompt/render.test.ts
      - packages/task-list/src/types.ts (ONLY if you choose to promote
        `url` to a normalized Task field — see the design decision
        below).

      Design decision on `task.url`:
      The gh-issues backend stores the issue URL at
      `task.metadata.url` (see
      packages/task-list/src/backends/gh-issues.ts:917). Markdown-dir
      and yaml-file backends do not populate any `url` in metadata.
      Pick the simpler path:
      - Expose `task.url` in the renderer by reading
        `task.metadata.url` if it is a string, else empty string.
        Do not add a top-level `url` field to the `Task` interface.
        This keeps the Task model unchanged and concentrates the
        backend-specific knowledge in the renderer.
      - `task.metadata` is exposed as a JSON-serialized string (so it
        is safe to interpolate) — agents that need a specific field
        should reach for it directly via the CLI rather than parsing
        a stringified blob from the prompt.

      Behavior:
      - Add `task.url` to the renderer's variable map. Value:
        `typeof task.metadata?.url === "string" ? task.metadata.url : ""`.
      - Add `task.metadata` to the renderer's variable map. Value:
        `JSON.stringify(task.metadata)`. (The existing interpolator
        only substitutes string values, so this must be a string.)
      - On every tick, the task record passed to the renderer MUST be a
        freshly fetched copy — not a cached snapshot from when the
        task was first picked up. The body/description can change
        between dispatches (the previous tick's agent may have edited
        it), and the next tick's prompt has to see the updated
        artifact. Audit the existing dispatch path
        (packages/maestro/src/index.ts and
        packages/maestro/src/drivers/pipeline.ts) and add a
        re-fetch immediately before render if one is not already
        happening.

      Tests (TDD, fast unit tests with memfs / fake gh client):
      - render.test.ts: render a prompt that references
        `\{{ task.url }}` against a Task whose `metadata.url` is set —
        assert the URL substitutes verbatim.
      - render.test.ts: same prompt against a Task whose metadata has
        no `url` key — assert the placeholder renders as an empty
        string, not "undefined" or "null".
      - render.test.ts: a prompt referencing `\{{ task.metadata }}` is
        rendered with a JSON.stringify of the metadata object; cover a
        nested-object case.
      - integration-ish test: mutate the task description between two
        renders and confirm the second render sees the new body
        (forces the re-fetch behavior).

      Out of scope:
      - Adding `task.identifier` — the codebase uses `task.qualifiedId`
        which is already exposed. Do not introduce an `identifier` alias.
      - Adding write-side helpers in the renderer — agents write
        through the new CLI (separate task).
      - Changing the placeholder syntax. The existing pipeline
        interpolator is reused as-is.
    status:
      implement: done
      test: done
      commit: done
  - id: state-driven-driver
    title: Dispatch one prompt per tick keyed by task state; drop old config fields
    prompt: |
      Goal: rewrite the dispatch path of maestro's "pipeline" driver so
      that, for each tick, it picks `cfg.states[task.state].prompt`,
      resolves agent/model/mode fallback, and spawns one agent
      execution per runnable task. Simultaneously remove the now-dead
      `active_states`, `terminal_states`, and `step_overrides` fields
      from `WorkflowConfig` and all their consumers. After this task,
      maestro no longer imports anything from `@poe-code/pipeline`.

      Files:
      - packages/maestro/src/drivers/pipeline.ts
      - packages/maestro/src/index.ts (both `loadResolvedSteps`
        callsites currently at lines 102 and 214; also the imports at
        line 6 and the related plumbing)
      - packages/maestro/src/runtime/loop.ts (the worker
        invocation path; switch from `cfg.active_states` to
        `cfg.activeStateNames`)
      - packages/maestro/src/runtime/reconcile.ts (switch from
        `cfg.terminal_states` to `cfg.terminalStateNames`)
      - packages/maestro/src/config/schema.ts (remove the now-dead
        `active_states`, `terminal_states`, `step_overrides` fields
        from `WorkflowConfig`)
      - packages/maestro/src/config/validate.ts (remove validation
        for the old fields)

      Behavior:
      - For a task in state S, look up `cfg.states[S]`.
        - If missing, log a structured "unconfigured state" warning and
          skip dispatch. The operator either adds the state to
          WORKFLOW.md or transitions the task elsewhere.
        - If `cfg.states[S].terminal === true`, do not dispatch; let
          the existing reconcile path release the task (reconcile
          already consumes `terminalStateNames` after the previous
          task, so this falls through naturally).
      - Per-state agent/model/mode fallback resolved at the driver
        boundary, not in the schema layer:
        - agent → `cfg.states[S].agent ?? cfg.agent.service`
        - model → `cfg.states[S].model` (undefined → runner default)
        - mode  → `cfg.states[S].mode ?? "yolo"`
      - Build the prompt by rendering `cfg.states[S].prompt` through the
        existing interpolator using the template variables introduced by
        the previous task.
      - Drop all use of `loadResolvedSteps`,
        `ResolvedStepDefinitions`, `setup`, `teardown`,
        `step_overrides`, and the pipeline-package runner from maestro.
        After this task, `import` of `@poe-code/pipeline` is removed
        from packages/maestro/src/index.ts.
      - Continuation behavior: while the task remains in an active state
        between ticks, maestro re-dispatches the same state's prompt on
        the next poll. The agent is responsible for transitioning the
        task (via the new `poe-code tasks next` / `set-state` CLI) when
        the work for that tick is done.

      Tests (TDD):
      - drivers/pipeline.test.ts: a task in state `planned` dispatches
        with the `planned` prompt, the workflow-default agent, the
        workflow-default model (undefined → runner default).
      - drivers/pipeline.test.ts: a state that sets `agent: claude` and
        `model: claude-sonnet-4-6` dispatches with those exact values
        even when the workflow default is `codex`.
      - drivers/pipeline.test.ts: a task in a state with `terminal: true`
        is not dispatched; the existing reconcile path is allowed to
        release it.
      - drivers/pipeline.test.ts: a task in a state with no `cfg.states`
        entry logs a warning and is not dispatched.
      - Add a grep test (cheap; runs in the package's test setup) that
        the maestro package no longer imports `loadResolvedSteps`.
      - Delete or rewrite the existing pipeline-driver tests that
        assumed step-sequence execution.

      Constraints:
      - Do not modify packages/pipeline/* — the standalone pipeline
        runner is unaffected.
      - No half-implementations: if a behavior referenced by the old
        pipeline-driver tests (setup/teardown hooks, per-step
        concurrency) is no longer applicable, delete the test, do not
        leave it `xfail` / skipped.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: tasks-cli
    title: Add backend-agnostic poe-code tasks CLI (get/set/set-state/next/comment)
    prompt: >
      Goal: expose the task-list package's existing read/write API as

      `poe-code tasks` subcommands so the agent in any state can mutate

      the artifact and advance the workflow through one interface

      regardless of backend. The agent never invokes `gh issue edit` or

      hand-edits markdown files directly — it shells out to these

      commands.


      Files:

      - src/cli/commands/tasks.ts (existing `verify` / `sync`
        subcommands are at lines 22 and 35; add the new ones alongside)
      - src/cli/commands/tasks-options.ts (extend options types as
        needed)
      - src/cli/commands/tasks-command.test.ts

      - packages/task-list/src/index.ts (only if a needed method is not
        already exported)
      - packages/task-list/src/backends/gh-issues.ts (if `comment` is
        not yet on the gh-issues backend, add a narrow
        `comment(id, body)` method; surface it through the `Tasks`
        interface)

      Maestro must construct an any-to-any state machine from

      `cfg.stateOrder` (one event per declared state, `from: "*"`,

      `to: <state-name>`) and pass it to `openTaskList({ stateMachine })`.

      For gh-issues, the backend already builds an equivalent dynamic

      machine from Project Status options — no override needed there.

      For markdown-dir / yaml-file, the maestro-supplied machine

      overrides the default strict machine. This shared machine is what

      backs every CLI subcommand below; the CLI never bypasses it.


      New subcommands:


      `poe-code tasks get <id> [--field <name>] [--json]`

      - `<id>` is a qualified task id (e.g. `plans/foo` for markdown-dir,
        `owner/number#42` for gh-issues).
      - With no `--field`, prints the full task as JSON when `--json`,
        otherwise a human-formatted block via the design-system writer.
      - With `--field description`, prints just that field's value to
        stdout with a trailing newline; useful for shell substitution
        (`$(poe-code tasks get <id> --field description)`).

      `poe-code tasks set <id> [--description-file <path>] [--description
      <string>] [--name <string>] [--metadata-json <json>]`

      - Exactly one description source MUST be provided when updating
        description (`--description-file` or `--description`); reject
        both.
      - Wraps `Tasks.update(id, { description, name, metadata })`.


      `poe-code tasks set-state <id> <state>`

      - Direct state assignment. Wraps `Tasks.fire(id, state)` using the
        maestro-supplied any-to-any state machine, where event name
        equals target state name.
      - Errors:
        - target state not declared in WORKFLOW.md → exit code 2 with
          message including the list of declared states.
        - task already in `<state>` → success no-op (idempotent).

      `poe-code tasks next <id>`

      - Reads the current state from `Tasks.get(id)`, looks up the
        next entry in `cfg.stateOrder`, and fires it via
        `set-state`-equivalent path.
      - Errors:
        - current state is the last entry in `cfg.stateOrder` → exit
          code 2 with message "no state after `<X>`; use `set-state` to
          override".
        - current state is not in `cfg.stateOrder` (operator removed
          it from WORKFLOW.md while a task was there) → exit code 2 with
          a clear message.

      `poe-code tasks comment <id> [--file <path>] [--message <string>]`

      - Exactly one of `--file` / `--message`.

      - On gh-issues, posts an issue comment via the backend's new
        `comment` method.
      - On markdown-dir / yaml-file, the CLI prints
        `comment is unsupported on the <backend-type> task backend` and
        exits with code 2 (configuration problem), not 1.

      All subcommands MUST:

      - Resolve the list from `./WORKFLOW.md` by default, matching the
        existing `verify` / `sync` pattern. Allow `--workflow <path>`
        override.
      - Use the design-system writer for output, not raw `console.log`
        or chalk/clack directly, per CLAUDE.md.
      - Support `--yes` for non-interactive runs (no prompts in any of
        these subcommands; `--yes` is wired for parity).

      Tests (TDD, fast unit tests with memfs and a fake gh client):

      - tasks-command.test.ts: each subcommand exercised against a
        markdown-dir backend (memfs-backed) — happy path and one
        error path each.
      - `next` happy path: task at state[0] advances to state[1].

      - `next` at the last state: exit code 2 with the documented
        message.
      - `set-state` to an undeclared state: exit code 2 with the
        documented message.
      - `comment` against markdown-dir: exit code 2 with the documented
        message.
      - `comment` against a fake gh-issues backend hits the backend's
        comment method.
      - `set` rejects both `--description-file` and `--description`
        together.

      Out of scope:

      - Role/actor enforcement (`--as agent` / `--as human`). Any state
        can move to any state by any caller; no guards.
      - Graph / visualization subcommand.

      - SDK parity: the task-list package's existing API already serves
        SDK callers — each CLI subcommand is a thin wrapper over an
        existing SDK method.
      - Auth wiring: existing `verify` / `sync` auth resolution already
        covers gh-issues; reuse it.
    status:
      implement: done
      test: done
      commit: done
  - id: migrate-workflow
    title: Rewrite root WORKFLOW.md as a state-machine workflow
    prompt: |
      Goal: convert the project's root WORKFLOW.md from the old
      step-based config to the new `states:`-based shape, using the
      lifecycle the user actually wants: idea → planned → in-review →
      done, with `archived` as a separate terminal. Each state's prompt
      invokes the new `poe-code tasks` CLI for artifact reads/writes
      and state advancement, so the same prompts work whether the
      active backend is gh-issues or markdown-dir.

      Files:
      - /Users/kjopek/Workspace/poe-code/WORKFLOW.md

      Target shape (use as structural guide; tune prompt wording to
      match the project's voice and the agents actually configured
      locally; PRESERVE existing fields not shown here — see below):

      ```
      ---
      tasks:
        type: markdown-dir
        path: ./docs/plans
        singleList: plans
        frontmatterMode: passthrough
        create: false
        lockStaleMs: 30000
        lockRetries: 20
      agent:
        service: codex
        list: plans
        max_concurrent_agents: 1
        max_turns: 20
        max_retry_backoff_ms: 300000
      polling:
        interval_ms: 30000
      workspace:
        root: ./.poe-code/maestro/workspaces

      states:
        idea:
          agent: claude
          prompt: |
            Task: \{{ task.qualifiedId }} (\{{ task.url }})
            Read \{{ task.description }}. Run /poe-code-plan to draft
            a plan. Write the plan back:
              poe-code tasks set \{{ task.id }} --description-file <plan>
            Advance:
              poe-code tasks next \{{ task.id }}

        planned:
          prompt: |
            Task: \{{ task.qualifiedId }} (\{{ task.url }})
            Read \{{ task.description }} for the plan. Implement it.
            Open a PR. Advance:
              poe-code tasks next \{{ task.id }}

        in-review:
          prompt: |
            Task: \{{ task.qualifiedId }} (\{{ task.url }})
            `gh pr view --json reviews,comments`. Address any
            unaddressed feedback, push, rebase if needed.
            If approved + merged, advance:
              poe-code tasks next \{{ task.id }}
            Otherwise exit; we re-check next tick.

        done:
          terminal: true
        archived:
          terminal: true
      ---
      \{{ task.qualifiedId }}: \{{ task.name }}

      \{{ task.description }}
      ```

      Migration steps:
      - Read the current root WORKFLOW.md first. Preserve every field
        in the existing `tasks:`, `agent:`, `polling:`, and
        `workspace:` blocks that is not explicitly removed below. The
        target shape above is structural — do not lose `create`,
        `lockStaleMs`, `lockRetries`, or any other field already
        configured on the project.
      - Remove the existing frontmatter `active_states`,
        `terminal_states`, and `step_overrides` blocks. Replace with
        the new `states:` block as shown.
      - Keep the body template — the new state-driven driver still
        uses it as the per-dispatch fallback rendering context.
      - Sanity-check by loading the file through maestro's typed
        config loader.
      - Confirm the agent-fallback path works by leaving `agent` unset
        on `planned`/`in-review` (they inherit `codex` from
        `agent.service`) and explicitly setting it on `idea`
        (overrides to `claude`).

      Out of scope:
      - Deleting `.poe-code/pipeline/steps.yaml`. That file belongs to
        the pipeline package's separate steps mechanism and stays.
      - Changing where the project's tasks live — `markdown-dir` at
        `./docs/plans` stays the default for the project.
    status:
      implement: done
      commit: done
  - id: docs-state-machine
    title: Update maestro README for state-machine workflows
    prompt: |
      Goal: rewrite the relevant sections of the maestro README
      so the docs reflect: `states:` block schema, state-driven
      dispatch, the new `poe-code tasks` CLI (`get` / `set` /
      `set-state` / `next` / `comment`), and the expanded template
      variables. The pipeline package README and the top-level project
      README MUST NOT be touched in this task.

      Files:
      - packages/maestro/README.md
      - Do NOT modify packages/pipeline/README.md.
      - Do NOT modify the top-level README.md (per CLAUDE.md, that
        file is user-scoped).

      Edits in packages/maestro/README.md:
      - Config table: replace the `active_states`,
        `terminal_states`, and `step_overrides` rows with a `states`
        row whose Behavior column describes the map and its lifecycle
        roles (active = `prompt`, terminal = `terminal: true`).
      - Add a new "State definition fields" sub-table covering
        `prompt`, `agent`, `model`, `mode`, `terminal`, with explicit
        notes that `agent` falls back to the workflow-level
        `agent.service` when omitted and `model` falls back to the
        agent runner's default.
      - Add a "Template variables" sub-section listing
        `task.id`, `task.qualifiedId`, `task.url`, `task.description`,
        `task.name`, `task.state`, `task.metadata`, `task.list` and
        noting that `task.url` renders empty on file backends and that
        `task.metadata` is JSON-stringified.
      - Add an "Artifact and transitions" section describing the model:
        the artifact is `task.description`; agents read/write via
        `poe-code tasks get|set`; happy-path advance via `poe-code
        tasks next`; explicit jumps via `poe-code tasks set-state`;
        comments via `poe-code tasks comment` (gh-issues only).
        Mention that declaration order in `states:` is the happy path
        but any state can transition to any other.
      - Replace the three example WORKFLOW.md blocks (`markdown-dir`,
        `yaml-file`, `gh-issues`) so each declares a minimal `states:`
        block, with at least one example overriding `agent` per state.
      - Remove any text that references `step_overrides`,
        `active_states`, `terminal_states`, or
        `.poe-code/pipeline/steps.yaml` as a maestro configuration
        path. If the README needs to mention the pipeline package's
        steps.yaml at all, clarify that it is an independent feature
        for standalone `poe-code pipeline run` usage, not something
        maestro reads.

      Constraints:
      - Match the existing terse README voice. No marketing prose, no
        emoji.
      - Tables stay in the same Markdown table style as the rest of the
        file.
    status:
      implement: done
      commit: done
name: workflow-state-machine
state: archived
---

# Workflow state machine

## Why

Today the maestro workflow is split awkwardly across four config concepts:

- `active_states` / `terminal_states` (lifecycle filter)
- `step_overrides` (per-step prompt/agent overrides)
- `.poe-code/pipeline/steps.yaml` (the actual step prompts, owned by the
  pipeline package)
- pipeline-driver step sequencing (run all steps per dispatch)

That model fits a "run a sequence of steps on every task" view of the world,
not the lifecycle the user actually wants: an idea becomes a plan, the plan
gets implemented, a PR is opened, reviews come in and get addressed, and
eventually the task ends. Each of those phases is one prompt; the agent
loops back through them as state changes.

OpenAI's Symphony spec has the same shape: one prompt template owned by the
workflow file, one dispatch per tick, transitions tracked in the issue
tracker. We adopt the same posture but expose the prompt per *state* instead
of one global prompt with `if issue.state == "X"` branches.

## Target model

```yaml
states:
  idea:       { prompt: "...", agent: claude }
  planned:    { prompt: "..." }                # inherits agent.service
  in-review:  { prompt: "..." }                # agent polls for review changes
  done:       { terminal: true }
  archived:   { terminal: true }
```

Two roles:

- **Active** — `prompt` set, `terminal` unset. Maestro renders and dispatches
  this prompt every tick the task is in this state. The agent decides when to
  exit and when to advance (via `poe-code tasks next` / `set-state`).
- **Terminal** — `terminal: true`. Maestro releases the task and cleans the
  workspace; no dispatch.

There is no "wait" state. A state that needs to wait for something external
(reviewer action, PR merge) still has a prompt; the agent in that state
polls the relevant external system (e.g. `gh pr view --json reviews`) and
exits quickly when there is nothing to do. The daemon's existing
`polling.interval_ms` provides the re-check cadence.

States are listed in declaration order, which defines the happy path:
`poe-code tasks next` advances to the next entry. The runtime does NOT
enforce that order — any state can transition to any other via
`poe-code tasks set-state`. The order in YAML is documentation + the
happy-path default, not a guard.

## Backend independence

The artifact (the user's idea, the plan, etc.) lives in `task.description`
across all backends:

- `gh-issues`: issue body
- `markdown-dir`: the markdown file's body (post-frontmatter)
- `yaml-file`: the `description` field

State transitions live in `task.state`. The agent reads and writes both
through the new `poe-code tasks` CLI, which wraps the task-list package's
existing read/write API. Prompts never call `gh issue edit` or hand-edit
markdown files directly, so the same WORKFLOW.md works against any
backend.

Comments are the one operation that does not generalize: only gh-issues
has them natively. `poe-code tasks comment` errors with a clear
"unsupported on this backend" message when invoked against file backends.

## CLI surface for agents

| Command                                       | Purpose                                              |
| --------------------------------------------- | ---------------------------------------------------- |
| `poe-code tasks get <id> [--field <name>]`    | Read the task. With `--field description`, prints just the artifact body. |
| `poe-code tasks set <id> [--description-file ...]` | Write the artifact body / name / metadata.       |
| `poe-code tasks next <id>`                    | Advance to the next state in declaration order.       |
| `poe-code tasks set-state <id> <state>`       | Explicit jump to any declared state.                  |
| `poe-code tasks comment <id> [--file ...]`    | Post a comment (gh-issues only; error elsewhere).     |

## Out of scope

- Per-state concurrency limits (`max_concurrent_agents_by_state` from
  Symphony). Reasonable follow-up but not required for the workflow
  itself.
- Replacing the pipeline package or its standalone `steps.yaml`. That is
  a separate feature for `poe-code pipeline run` invocations and stays.
- Changing the `ralph` driver. Plan-doc tasks with `kind: ralph`
  continue to route through it.
- Role/actor enforcement on transitions. Any caller can fire any
  transition.
- Graph / visualization subcommand. Declaration order in WORKFLOW.md
  is documentation enough.
- Per-state webhook triggers (instead of polling). The polling model is
  enough for v1; webhooks can layer on later.
