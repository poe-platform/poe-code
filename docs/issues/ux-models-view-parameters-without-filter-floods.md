---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/models.ts:449-478 builds parameter rows for every filtered model; options at :265-279 include no --limit and no requirement for --model/--search"
comment: "Same unbounded-output problem as ux-models-dumps-full-catalog.md but worse for this view, since parameters emits a block per model rather than a row. Its suggestion is right and more specific than a global --limit: require --model or --search for parameters, because an unfiltered parameters dump has no plausible use. Consolidate with the --limit work (ux-models-no-limit-flag-confirmed.md)."
---

# UX: models --view parameters without filter floods all models

## Summary

models --view parameters without --model/--search dumps parameters for entire catalog (starts with random models) — no default limit; hard to use.

## Evidence

models --view parameters → multi-model parameter dump for 341 models.

## Why it matters

Parameters view needs model filter or top-N default.

## Suggested direction

Require --model/--search for parameters view or paginate.

## Severity

Medium

## Area

Models
