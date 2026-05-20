# @poe-code/plan-browser

Unified discovery, formatting, interactive browsing, and file actions for plan documents across:

- Pipeline plans
- Experiment docs
- Ralph plans

## What it does

- Discovers plans across all supported plan systems
- Normalizes them into one list
- Formats per-source detail strings and previews
- Supports edit, archive, delete, and optional create actions
- Powers `poe-code plan`

## Configuration

This package does not introduce any new config keys.

It respects the existing config options:

- `pipeline.plan_directory`
- `experiment.plan_directory`
- `ralph.plan_directory`

It also respects the existing environment variables:

- `POE_PIPELINE_PLAN_DIRECTORY`
- `POE_EXPERIMENT_PLAN_DIRECTORY`
- `POE_RALPH_PLAN_DIRECTORY`

## Public API

- `discoverAllPlans()`
- `runPlanBrowser()`
- `loadPlanPreviewMarkdown()`
- `archivePlan()`
- `deletePlan()`
- `editPlan()`

`runPlanBrowser()` accepts an optional `onCreatePlan?: () => Promise<void>` callback.
When provided, the interactive explorer exposes a new-plan action and refreshes the
plan list after the callback completes.

Archive and delete are marked as destructive explorer actions. The explorer owns
the confirmation prompt before dispatching either file action.

When `assumeYes` is true, or stdin is not a TTY, `runPlanBrowser()` does not start
the interactive explorer. It renders a preview of the first discovered plan and exits,
which keeps CI and non-interactive usage deterministic.
