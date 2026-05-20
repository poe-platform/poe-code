---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: plan-explorer-config-builder
    title: Build ExplorerConfig from PlanEntry list (plan-browser)
    prompt: |
      In `packages/plan-browser/src/`, add a new module `explorer-config.ts`
      that exports `buildPlanExplorerConfig(options) -> ExplorerConfig<void>`
      from `@poe-code/design-system` (the explorer at
      `packages/design-system/src/explorer/`). Export the new symbol from
      `packages/plan-browser/src/index.ts`.

      Inputs to the builder:
        - plans: PlanEntry[]               (from this package's discovery)
        - fs: ActionFs & DiscoveryFs       (used by edit/archive/delete)
        - variables: Record<string, string | undefined>
        - onRefresh: () => Promise<PlanEntry[]>
        - onCreatePlan?: () => Promise<void>     (optional; wired by the CLI
                                                  layer because plan-browser
                                                  must not depend on sdk-spawn
                                                  or the planning skill)
        - loadDetailMarkdown?: (entry, fs) => Promise<string>
          (defaults to `loadPlanPreviewMarkdown`)

      Mapping PlanEntry -> Row:
        - id          = entry.absolutePath
        - title       = path.basename(entry.path)
        - subtitle    = entry.detail
        - badge.text  = entry.typeLabel
        - group       = entry.kind
      Keep an internal `Map<rowId, PlanEntry>` for handler lookups; do not
      try to extend the Row shape.

      Detail loader (config.detail.items): call `loadDetailMarkdown(entry,
      fs)` and return a single DetailItem `{ id: entry.absolutePath,
      render: () => markdown }`. Respect `ctx.signal`: if it aborts during
      the load, return an empty array.

      Actions (config.actions):
        - id: "edit",    key: "e", label: "Edit in $EDITOR".
          Handler wraps `editPlan(entry.absolutePath, { env: variables })`
          in `ctx.suspendAnd(...)` so $EDITOR takes the TTY, then
          `await ctx.refresh()` and `ctx.toast("Edited <basename>", "info")`.
        - id: "archive", key: "a", label: "Archive", destructive: true.
          Handler calls `archivePlan(entry, fs as ActionFs)`, then
          `await ctx.refresh()` and `ctx.toast("Archived <basename>",
          "warning")`. The explorer's built-in confirm modal handles
          the destructive prompt; do not also call `ctx.confirm`.
        - id: "delete",  key: "d", label: "Delete", destructive: true.
          Same pattern using `deletePlan`, toast tone "error".
        - id: "new", key: "n", primary: true, label: "New plan".
          predicate: () => onCreatePlan != null.
          Handler calls `ctx.suspendAnd(() => onCreatePlan!())` then
          `await ctx.refresh()`. Omit this action entirely from
          config.actions when `onCreatePlan` is undefined (do not register
          a no-op).

      Implement `ctx.refresh` plumbing by exposing a builder-returned
      `refresh(): Promise<void>` callback the runtime can call. The
      builder must rebuild the internal rowId->PlanEntry map on each
      refresh so handlers always see fresh entries.

      Config knobs:
        - title: `"Plans"`
        - multiSelect: false
        - emptyHint: "No plans found"
        - reorder: omit

      Other rules:
        - No new dependencies. `@poe-code/design-system` and
          `@poe-code/plan-browser` already see each other.
        - No regex parsing of files; lean on existing discovery and
          format helpers in this package.
        - Do not introduce a constants module just to hold action ids;
          inline the strings at the action definition site.
    status:
      implement: open
      test: open
      commit: open

  - id: plan-browser-uses-explorer
    title: Run plan browse through the explorer
    prompt: |
      Rewrite `runPlanBrowser` in `packages/plan-browser/src/browser.ts`
      to drive the explorer:

      1. Extend the options type with an optional
         `onCreatePlan?: () => Promise<void>` field. All other fields
         stay as-is (signature stays backwards-compatible for callers).

      2. Behavior:
         - Discover plans once with `discoverAllPlans(...)`.
         - If `plans.length === 0`: write `"No plans found.\n"` to stdout
           and return (unchanged from today).
         - If `options.assumeYes` is true OR
           `process.stdin.isTTY === false`: render a preview of the first
           plan via `loadPlanPreviewMarkdown` + `renderMarkdown` and
           return. This preserves the non-interactive path expected by
           CI and by `--yes`. Do not launch the explorer in this branch.
         - Otherwise: build an `ExplorerConfig` via
           `buildPlanExplorerConfig({ plans, fs, variables, onRefresh,
           onCreatePlan })`, where `onRefresh` re-runs `discoverAllPlans`
           with the same arguments, and call `runExplorer(config)`.

      3. Remove the manual `select` + per-action `confirmOrCancel` loop;
         the explorer owns selection, navigation, destructive confirm,
         and edit/archive/delete dispatch via the builder from task 1.

      4. Tests:
         - In `packages/plan-browser/src/browser.e2e.test.ts`, drop the
           assertions that depend on the legacy `select`-based loop and
           replace them with a test that drives `buildPlanExplorerConfig`
           directly (memfs-backed PlanEntry fixtures): assert the row
           mapping (id/title/subtitle/badge/group) and that calling each
           action handler invokes the expected `editPlan` / `archivePlan`
           / `deletePlan` / `onCreatePlan` exactly once with the right
           args. Stub `ctx` with the minimum fields each handler reads
           (`suspendAnd`, `refresh`, `toast`).
         - Add a separate test for the non-interactive branch: when
           `assumeYes: true`, the explorer is not invoked (inject a
           seam, e.g. an optional `runExplorerImpl` option defaulted to
           the real `runExplorer`, for the test only).
         - Tests must use memfs, must not query an LLM, and must
           complete in under one second each.

      5. Update `packages/plan-browser/README.md`: document the new
         optional `onCreatePlan` callback, the destructive-confirm
         behavior, and the non-interactive (`assumeYes` / no-TTY)
         fallback. Do not add a new env variable or config option.
    status:
      implement: open
      test: open
      commit: open

  - id: plan-default-opens-explorer
    title: Default `poe-code plan` opens the explorer
    prompt: |
      Change the top-level `poe-code plan` command in
      `src/cli/commands/plan.ts` so that with no `questionArg` and no
      `--yes` it opens the explorer over the configured plan directory.

      1. Extract a helper `runPlanSessionWithPrompt(container, agent,
         assumeYes): Promise<void>` that:
            - resolves the question (existing `resolvePlanQuestion` path)
            - returns early if cancelled
            - calls the existing `runPlanSession(...)`.
         Use this helper from both the question-arg path and the
         explorer's "new plan" action.

      2. Update the `.command("plan")` action handler:
            - if `questionArg` is a non-empty string -> call
              `runPlanSession({ container, agent, question })` as today.
            - else if `flags.assumeYes` -> throw the existing
              ValidationError ("A question is required ...").
            - else -> call `runPlanBrowser({
                cwd, homeDir, configPath, projectConfigPath, fs,
                kind: resolveKind(opts.kind),
                variables: container.env.variables,
                assumeYes: false,
                onCreatePlan: () => runPlanSessionWithPrompt(
                  container, agent, false
                )
              })`.
              Wrap the call in `intro("plan")`.

      3. Add a `--kind <kind>` option to the top-level `plan` command
         (same valid values and error message as `plan browse`). Pass
         it through to `runPlanBrowser`. Do not change the `plan browse`
         subcommand; it keeps working unchanged via the same updated
         `runPlanBrowser`.

      4. The existing `plan browse` subcommand action should be a
         single call into `runPlanBrowser(...)` (no `onCreatePlan`); do
         not duplicate the wiring between the two commands.

      5. Update or add tests in `src/cli/commands/plan.test.ts` (or
         create it if missing) covering:
            - `plan <question>` -> spawns a session, never opens the
              explorer (inject a fake `runPlanBrowser` and assert it was
              not called).
            - `plan --yes` (no question) -> throws ValidationError.
            - `plan` (no question, interactive) -> calls
              `runPlanBrowser` exactly once with `onCreatePlan`
              defined.
            - `--kind invalid` -> throws ValidationError.
         Tests must not spawn a real agent; mock `sdkSpawn` and inject
         a fake browser entry point.
    status:
      implement: open
      test: open
      commit: open

  - id: plan-cli-help-docs
    title: Document the new default in plan help text
    prompt: |
      Update user-facing copy only; no behavior changes.

      1. In `src/cli/commands/plan.ts`, change the `.description(...)`
         for the top-level `plan` command to:
         `"Browse plans in an interactive explorer, or draft a new plan
         when given a question."`. Keep the description for `plan browse`
         consistent (point at the explorer experience). Mention the
         keymap (`e` edit, `a` archive, `d` delete, `n` new) in the
         top-level command help via `.addHelpText("after", ...)`.

      2. Update `packages/plan-browser/README.md`'s usage section to
         show the new default-explorer flow and the non-interactive
         fallback. Do not add new env variables or config options.
         Do not edit the repo-root README (per CLAUDE.md, that needs
         explicit permission).
    status:
      implement: open
      commit: open
---

# Context

`poe-code plan` today either drafts a new plan via an agent session
(question arg or interactive `promptText`) or, via `plan browse`, walks
a flat `select` list. The explorer in
`packages/design-system/src/explorer/` is the shared TUI building block
(list + detail, fuzzy filter, async detail loader, action keymap,
destructive confirm modal, toasts). This pipeline wires the explorer in
as the default surface for `poe-code plan`, keeps `plan browse` working
through the same code path, and preserves the existing non-interactive
contract:

- `poe-code plan "<question>"` -> agent planning session (unchanged).
- `poe-code plan --yes` with no question -> existing ValidationError.
- `poe-code plan` with no question, TTY present -> opens the explorer
  over the configured plan directory.
- `poe-code plan` piped / no TTY / `--yes` with `plan browse` -> falls
  back to the previous preview-and-exit behavior so CI keeps working.

## Constraints

- Extend `@poe-code/plan-browser`; do not add a parallel browser
  implementation elsewhere.
- `@poe-code/plan-browser` cannot import `sdkSpawn` or the planning
  skill template — the CLI layer wires the "new plan" action through an
  `onCreatePlan` callback.
- No regex parsing of plan files. Use existing discovery/format helpers.
- Tests must use memfs and must not spawn real agents.
- No new dependencies. No optional peer deps. No zod.

## Out of scope

- Changing what a plan is, the discovery rules, or any schema.
- Multi-select bulk actions (explorer supports it but plans don't need
  it yet — keep `multiSelect: false`).
- Adding new flags beyond `--kind` on the top-level `plan` command.
- Touching `plan list`, `plan view`, `plan markdown-read*`, or
  `plan install`.
