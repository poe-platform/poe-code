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
