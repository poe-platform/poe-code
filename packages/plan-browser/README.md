# @poe-code/plan-browser

Unified discovery, formatting, interactive browsing, and file actions for plan documents across:

- Pipeline plans
- Experiment docs
- Ralph plans

## What it does

- Discovers plans across all supported plan systems
- Normalizes them into one list
- Formats per-source detail strings and previews
- Supports edit, archive, and delete actions
- Powers `poe-code plan`

## Usage

`poe-code plan` opens the interactive explorer by default. From there, use `e` to
edit, `a` to archive, or `d` to delete.

```sh
poe-code plan
poe-code plan browse
```

Non-interactive callers must select a plan explicitly:

```sh
poe-code plan view docs/plans/my-plan.md
```

## Configuration Options

This package does not introduce any new config keys.

It discovers markdown plans from the shared plan directory. The default is
`docs/plans`.

It respects the existing config option:

- `plan.plan_directory`

It also respects the existing environment variable:

- `POE_PLAN_DIRECTORY`

## Environment Variables

- `POE_PLAN_DIRECTORY`: overrides the shared plan directory.

## Public API

- `discoverAllPlans()`
- `runPlanBrowser()`
- `loadPlanPreviewMarkdown()`
- `archivePlan()`
- `deletePlan()`
- `editPlan()`

Archive and delete are marked as destructive explorer actions. The explorer owns
the confirmation prompt before dispatching either file action.
