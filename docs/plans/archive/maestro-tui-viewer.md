---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: scaffold-maestro-tui-package
    title: Scaffold @poe-code/maestro-tui package
    prompt: |
      Create a new workspace package at `packages/maestro-tui` that will host
      a read-only TUI for maestro task lists. Mirror the structure used by
      `packages/plan-browser` (package.json scripts, tsconfig, src/index.ts).

      package.json:
      - name: `@poe-code/maestro-tui`
      - same `"build"`, `"test"`, `"test:unit"` script style as
        `packages/plan-browser/package.json`
      - dependencies: `@poe-code/design-system` (for `runExplorer`,
        `ExplorerConfig`), `@poe-code/task-list` (for `TaskList`, `Task`,
        `openTaskList`), `@poe-code/maestro` (to load the workflow
        config — it already parses `states` / `events`)
      - no `@modelcontextprotocol/sdk`, no zod (see CLAUDE.md and memory)

      tsconfig.json: extend the same base used by plan-browser.

      `src/index.ts` exports the public surface that later tasks will fill in:
      `runMaestroTui`, `buildMaestroExplorerConfig`. Stub them so the package
      builds; later tasks implement the bodies.

      Add the new package to the root `package.json` workspaces list if a
      whitelist exists, and add a path mapping if the root tsconfig keeps one.

      Write a minimal `README.md` listing the package purpose, the exported
      API surface, and any env vars or config options (per CLAUDE.md
      package rules).
    status:
      implement: done
      commit: done
  - id: build-maestro-explorer-config
    title: Build maestro explorer config from a TaskList
    prompt: |
      In `packages/maestro-tui/src/explorer-config.ts`, implement
      `buildMaestroExplorerConfig(options)` returning
      `ExplorerConfig<void>` from `@poe-code/design-system`. Follow the
      shape used by `packages/plan-browser/src/explorer-config.ts`.

      Inputs (`BuildMaestroExplorerConfigOptions`):
      - `tasks: Task[]` — initial snapshot from `TaskList.allTasks()`
      - `taskList: TaskList` — used to resolve a `Tasks` per row
        (`taskList.list(row.task.list)`) for `events()` / `canFire()` / `fire()`
      - `onRefresh: () => Promise<Task[]>` — re-fetch on `runExplorer` refresh

      Row mapping (one row per task):
      - `id`: `task.qualifiedId`
      - `title`: `task.name`
      - `subtitle`: `\`${task.list} · ${task.qualifiedId}\`` so the list
        affiliation stays visible after state-grouping moves it out of
        the group header.
      - `badge`: `{ text: task.state, tone: toneForState(task.state) }`
        where `toneForState` maps:
          `"draft"` → `"muted"`, `"planned"` → `"info"`,
          `"in-progress"` → `"warning"`, `"done"` → `"success"`,
          `"archived"` → `"muted"`, anything else → `"info"`.
        Do not hardcode state names anywhere else.
      - `group`: `task.state` — rows are grouped by state, not by list.

      Group ordering: emit rows in this state order so active work
      surfaces first and terminal work sinks to the bottom:
      `in-progress`, `planned`, `draft`, `done`, `archived`, then any
      other state names in alphabetical order. The explorer renders
      groups in row-emission order, so sort `tasks` accordingly before
      mapping to rows. Within a group, preserve the order returned by
      `taskList.allTasks()` (the backends already apply their own
      priority/created ordering).

      Detail items (right pane) for the selected row, in order:
      1. Heading line: `# {task.name}` plus `**State:** {task.state}`.
      2. Markdown rendering of `task.description` (pass through; do not
         re-parse). If empty, render `_No description._`.
      3. A "Metadata" section: render `task.metadata` as a fenced
         ```yaml``` block using the same yaml writer used elsewhere in
         poe-code (search `packages` for the existing yaml dump helper;
         if none, use `js-yaml` already in the monorepo).
      4. A "Next" section listing the result of
         `taskList.list(task.list).events(task.id)` — one bullet per
         event. If the list is empty, render `_Terminal state — no events
         available._`. Treat `events()` errors as rendering
         `_Could not load events: {err.message}_` (do not throw).

      Detail rendering must respect `ctx.signal.aborted` (copy the
      `loadMarkdownUnlessAborted` pattern from
      `packages/plan-browser/src/explorer-config.ts`).

      Title of the explorer: `"Maestro tasks"`. `emptyHint`:
      `"No tasks found"`. `multiSelect`: `false`.

      No actions are wired in this task — separate follow-up tasks add
      them. Leave the `actions: []` slot in place so later tasks can
      append without restructuring.
    status:
      implement: done
      test: done
      commit: done
  - id: action-fire-event
    title: Add "Move to state…" action (cross-state task movement)
    prompt: |
      In `packages/maestro-tui/src/actions.ts`, add an action that lets
      the user move a task to a different state by firing the workflow
      event that targets that state. Because rows are grouped by state
      in the list, this is the cross-group move. Wire it into the
      `actions` array returned by `buildMaestroExplorerConfig` (in
      `packages/maestro-tui/src/explorer-config.ts`).

      Action definition (`Action<void>` from `@poe-code/design-system`):
      - `id: "move-state"`
      - `key: "f"`
      - `label: "Move to state…"`
      - `primary: true`
      - `predicate`: hide when the task's `events()` list is empty.
        Compute predicate state from the cached events map that the
        builder maintains alongside the rows (mirror the pattern used
        for `entryByRowId` in plan-browser).
      - `handler`:
        1. Resolve the `Tasks` (`taskList.list(task.list)`) and the
           current `Task` from the cached row map.
        2. Read `await tasks.events(task.id)`. For each event, look up
           its target state from `tasks.stateMachine` (the
           `StateMachineDef` exposed on `Tasks`). Build a picker entry
           per event with the label `\`${event}    → ${targetState}\``.
        3. If the list is empty, `ctx.toast` an info message and return.
        4. Show the selection prompt. Use the existing design-system
           prompt primitive (search `packages/design-system/src` for
           the select/picker that `ctx.suspendAnd` exposes — do not
           introduce a new prompt lib).
        5. If the user cancels, return silently.
        6. Call `await tasks.fire(taskId, event)`. On
           `InvalidTransitionError` (imported from `@poe-code/task-list`),
           `ctx.toast(err.reason, "error")` and return.
        7. `await ctx.refresh()` and `ctx.toast(\`Moved to ${targetState}\`,
           "info")`. The list re-groups automatically because the row's
           `group` is derived from `task.state`.

      Do not call `setState` directly — only `fire`. Do not branch on
      backend type; all backends implement `Tasks.fire`.
    status:
      implement: done
      test: done
      commit: done
  - id: reorder-within-state-group
    title: Reorder rows within a state group via Shift+↑/↓
    prompt: |
      Wire the explorer's `reorder` hook so users can reprioritise
      tasks inside a state group. The reducer in
      `packages/design-system/src/explorer/reducer.ts` already moves
      rows on `Shift+Up` / `Shift+Down` and emits the new id order
      through `ExplorerConfig.reorder.onReorder(ids)` — confirm this
      keybind is exposed by reading the keymap and footer text.

      Implementation in
      `packages/maestro-tui/src/explorer-config.ts`:

      1. In `buildMaestroExplorerConfig`, populate
         `config.reorder = { onReorder }`.
      2. `onReorder(allIds)` receives the new flat order across all
         groups. Re-derive per-list order:
         - Walk `allIds`; for each id, look up the cached `Task`.
         - Group ids by `task.list`, preserving the new sequence.
         - For each list whose intra-list order changed, call
           `taskList.list(listName).reorder(idsForThatList.map(qid =>
             stripListPrefix(qid))`. Use a helper to convert
           `qualifiedId` → backend-local `id` based on the `Task` cache
           (do not re-parse).
      3. If `Tasks.reorder` throws `OrderMismatchError`, surface a
         `ctx.toast` with the error message and refresh from
         `taskList.allTasks()` to recover (do not retry; the user
         picked an invalid order — show why and let them try again).
      4. Cross-state reordering (dragging a row from `planned` into
         `draft`) must not change the task's state. The state group is
         purely visual; only `move-state` changes state. If the
         reordered position lands the row in a different group, the
         explorer will visually re-sort it back to its true state group
         on the next `refresh()` — that's the correct behaviour.
         Document this in a one-line comment next to `onReorder`.

      Footer hint: ensure the footer text includes
      `"⇧↑↓ reorder (within state)"` so the affordance is discoverable.
      The footer is rendered from action labels plus a keymap hint
      block — check `packages/design-system/src/explorer/render` for
      how plan-browser surfaces the equivalent hint, and reuse the same
      mechanism.
    status:
      implement: done
      test: done
      commit: done
  - id: action-open-source
    title: Add "open in $EDITOR" action for file-backed tasks
    prompt: |
      In `packages/maestro-tui/src/actions.ts`, add an action that opens
      the task's underlying file in `$EDITOR` for backends that set
      `Task.sourcePath` (markdown-dir, yaml-file). Wire it into the
      `actions` array in `packages/maestro-tui/src/explorer-config.ts`.

      Action:
      - `id: "open-source"`
      - `key: "o"`
      - `label: "Open in $EDITOR"`
      - `predicate`: row's `task.sourcePath != null`. Do not check
        backend type — `sourcePath` is the signal.
      - `handler`:
        1. Resolve `task` from the cached row map.
        2. `await ctx.suspendAnd(async () => { editFile(task.sourcePath!,
           { env: variables }); })` using the same editor launcher
           plan-browser uses (`packages/plan-browser/src/actions.ts`
           `editPlan`). Extract or import that helper rather than
           duplicating the spawn logic (see memory:
           extend-not-duplicate).
        3. `await ctx.refresh()`; `ctx.toast(\`Edited ${task.qualifiedId}\`,
           "info")`.

      Add `variables: Record<string, string | undefined>` to
      `BuildMaestroExplorerConfigOptions` and thread it through (same
      shape plan-browser uses).
    status:
      implement: done
      test: done
      commit: done
  - id: action-open-issue
    title: Add "open issue in browser" action for gh-issues tasks
    prompt: |
      In `packages/maestro-tui/src/actions.ts`, add an action that opens
      the GitHub issue URL for tasks that originate from the gh-issues
      backend. Wire it into `actions` in
      `packages/maestro-tui/src/explorer-config.ts`.

      The gh-issues backend stores the issue URL on the task — verify
      the exact key by reading
      `packages/task-list/src/backends/gh-issues` (the field is on
      `task.metadata`; pick the existing key, do not invent one). If no
      such key exists, store one when the gh-issues backend builds a
      Task (smallest change in that backend) and add a comment there
      explaining the TUI consumes it.

      Action:
      - `id: "open-issue"`
      - `key: "g"`
      - `label: "Open issue in browser"`
      - `predicate`: row's `task.metadata[<the key>]` is a non-empty
        string starting with `http`.
      - `handler`: read the URL, call the existing design-system
        `openExternal` / browser-launcher helper (search
        `packages/design-system/src` — do not shell out to `open`
        directly). Toast `\`Opened ${task.qualifiedId}\`` on success.

      Backend type is never checked — the URL field's presence is the
      switch (see memory: explicit-over-implicit; the value itself is
      the signal, not the backend name).
    status:
      implement: done
      test: done
      commit: done
  - id: run-maestro-tui-entry
    title: Implement runMaestroTui entrypoint
    prompt: |
      In `packages/maestro-tui/src/run.ts`, implement and export
      `runMaestroTui(options)`. Re-export from
      `packages/maestro-tui/src/index.ts`.

      Signature:

      ```ts
      export interface RunMaestroTuiOptions {
        workflowPath?: string;          // defaults: same default as runMaestro
        taskList?: TaskList;            // pre-built; skips workflow loading
        variables?: Record<string, string | undefined>; // default: process.env
      }

      export async function runMaestroTui(
        options?: RunMaestroTuiOptions
      ): Promise<void>;
      ```

      Behaviour:
      1. If `options.taskList` is provided, use it. Otherwise load the
         workflow config via the same loader `runMaestro` uses
         (`packages/maestro/src/config`), extract the configured
         task-list options, and call `openTaskList(...)` from
         `@poe-code/task-list`. Do not duplicate workflow parsing —
         import and reuse.
      2. Define `loadTasks = () => taskList.allTasks()`. Call it once
         for the initial snapshot.
      3. Build the config with
         `buildMaestroExplorerConfig({ tasks, taskList, variables,
           onRefresh: loadTasks })`.
      4. `await runExplorer(config)` from `@poe-code/design-system`.

      No spawn, no dispatch, no state writes beyond what the wired
      actions perform. This is a pure viewer.
    status:
      implement: done
      test: done
      commit: done
  - id: poe-code-cli-maestro-tui-subcommand
    title: Wire `poe-code maestro tui` CLI subcommand
    prompt: |
      Expose `runMaestroTui` through the poe-code CLI as
      `poe-code maestro tui`.

      Steps:
      1. Find the existing poe-code CLI entry — search the repo for the
         `bin` field in package.json files and for an existing
         `maestro` subcommand (`grep -rn '"maestro"' packages` and
         `grep -rn 'commander\|cmdkit' packages/maestro`). If a
         `maestro` command already exists, add `tui` as a subcommand
         underneath it; if it does not, register a new `maestro`
         command with a single `tui` subcommand.
      2. The subcommand accepts:
         - `--workflow <path>` (forwarded as `workflowPath`)
         - no other flags
      3. Implementation imports `runMaestroTui` from
         `@poe-code/maestro-tui` and awaits it. Exit 0 on normal close,
         non-zero with a one-line error on thrown errors (mirror the
         error handling in the existing `poe-code plan browse` command
         that runs the plan explorer).
      4. Keep CLI/SDK parity: the SDK entry already is `runMaestroTui`,
         so the CLI must accept the same options under the same names
         (see CLAUDE.md "CLI vs SDK" rule).
      5. No interactive prompts at startup — open the TUI immediately
         (defaults come from the workflow config, not from a prompt;
         see CLAUDE.md "--yes option" + memory: explicit-over-implicit).
    status:
      implement: done
      test: done
      commit: done
  - id: screenshot-validate-tui
    title: Visual-validate the maestro TUI via screenshots
    prompt: |
      Per CLAUDE.md "Visual testing — use screenshots to see", capture
      screenshots of the maestro TUI in its key states and inspect them
      for layout/style issues. Do not write screenshot tests — these are
      adhoc validation only.

      Steps:
      1. Run `npm run screenshot-poe-code -- maestro tui --workflow
         <path-to-a-test-workflow-with-3-5-seeded-tasks>`. If a suitable
         fixture workflow does not exist, create one under
         `packages/maestro-tui/fixtures/` using the markdown-dir backend
         with tasks in `draft`, `planned`, `in-progress`, and `done`
         states (so all badge tones render).
      2. Capture screenshots for:
         - initial list view grouped by state, all five state groups
           visible (in-progress, planned, draft, done, archived) with
           correct group ordering
         - detail pane with description + metadata + Next events
         - detail pane on a terminal-state task (Next section shows the
           terminal hint)
         - "Move to state…" modal showing `event → state` rows
         - mid-reorder state (a row visibly held with Shift+↑ inside
           its group)
         - footer showing both the action keys and the
           `⇧↑↓ reorder (within state)` hint
      3. Inspect each screenshot for: badge tone correctness, header
         alignment, action key hints in the footer, no overflow in the
         metadata yaml block.
      4. Fix any visual regressions found, then re-capture. Do not move
         on until screenshots look correct.
    status:
      implement: done
      commit: done
name: maestro-tui-viewer
state: archived
---

# Context

Build a read-only TUI for maestro that visualises task status and next
moves, backed by the existing `@poe-code/task-list` abstraction so it
works identically across `markdown-dir`, `yaml-file`, and `gh-issues`
backends. Reuses the generic `runExplorer` primitive from
`@poe-code/design-system` (the same one `@poe-code/plan-browser`
already wires up) rather than introducing a new TUI framework.

## Why a new package

`packages/maestro` is the runtime (polling, drivers, dispatch).
Pulling `@poe-code/design-system` into it would couple the runtime to
TUI rendering. A thin `@poe-code/maestro-tui` package sits beside it,
depends on both, and contributes the CLI surface — same split that
`maestro` + `maestro-tui` mirrors for `plans` + `plan-browser`.

## Backend agnosticism

The TUI never branches on backend type. Capability detection comes
from the data:

- `Task.sourcePath` present → "Open in $EDITOR" available.
- Issue-URL metadata key present → "Open in browser" available.
- `Tasks.events(id)` non-empty → "Fire event…" available.

This matches the `feedback_explicit_over_implicit` memory: behaviour is
gated on the value, not on a backend tag.

## Next-state computation

The "Next" section in the detail pane lists `Tasks.events(id)` results
— i.e. transitions actually reachable from the task's current state
given the workflow config. The TUI does not parse the workflow itself;
that work is already done inside `@poe-code/task-list` /
`@poe-code/maestro`'s state machine.

## Out of scope

- Dispatch / spawn — viewer only.
- Mutating task descriptions or metadata — only `fire` is allowed.
- Multi-select, bulk operations, reorder.
- Filter/search beyond what `runExplorer` provides out of the box.
