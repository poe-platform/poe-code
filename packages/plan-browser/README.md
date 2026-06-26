# @poe-code/plan-browser

Unified discovery, formatting, interactive browsing, and file actions for plan documents across:

- Pipeline plans
- Experiment docs
- Ralph plans

## What it does

- Discovers plans across all supported plan systems
- Normalizes them into one list
- Formats per-source detail strings and previews
- Supports edit, save-for-later/restore, archive, delete, and optional create actions
- Powers `poe-code plan`

## Usage

`poe-code plan` opens the interactive explorer by default. From there, use `e` to
edit, `s` to save an active plan for later or restore a saved plan, `a` to archive,
`d` to delete, or `n` to draft a new plan.

```sh
poe-code plan
poe-code plan browse
```

Passing a question drafts a new plan instead of opening the explorer:

```sh
poe-code plan "Design the onboarding flow"
```

For non-interactive usage, pass `--yes`. The browser renders a deterministic
preview of the first discovered plan and exits:

```sh
poe-code --yes plan browse
```

## Configuration

This package does not introduce any new config keys.

It discovers markdown plans from the shared plan directory. The default is
`docs/plans`.

YAML pipeline plans are discovered from the same directory. Plans in the `later/`
subdirectory are listed after active plans and grouped as saved for later. Broken
symlinks are skipped during discovery. Editor commands prefer `VISUAL` over `EDITOR`
and keep escaped spaces inside command tokens.

It respects the existing config option:

- `plan.plan_directory`

It also respects the existing environment variable:

- `POE_PLAN_DIRECTORY`

## Public API

- `discoverAllPlans()`
- `runPlanBrowser()`
- `loadPlanPreviewMarkdown()`
- `savePlanForLater()`
- `restorePlanFromLater()`
- `archivePlan()`
- `deletePlan()`
- `editPlan()`

`runPlanBrowser()` accepts an optional `onCreatePlan?: () => Promise<void>` callback.
When provided, the interactive explorer exposes a new-plan action and refreshes the
plan list after the callback completes.

Save-for-later moves a plan into `later/`, records a required
`saved_for_later.reason` when the plan does not already have one, and restores saved
plans back to the active directory. Archive and delete are marked as destructive
explorer actions. The explorer owns the confirmation prompt before dispatching either
file action.

When `assumeYes` is true, or stdin is not a TTY, `runPlanBrowser()` does not start
the interactive explorer. It renders a preview of the first discovered plan and exits,
which keeps CI and non-interactive usage deterministic.
