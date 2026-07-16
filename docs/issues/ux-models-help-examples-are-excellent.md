---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/models.ts:280-307 addHelpText renders Filters/Views/Examples sections; positive note, no defect"
comment: "Genuinely valuable positive: it identifies the template the rest of the CLI needs, and its suggestion (copy the Filters/Views/Examples shape to spawn/configure) is the answer to the whole missing-examples cluster (ux-primary-commands-lack-examples-in-help.md, ux-configure-help-missing-examples.md). Keep as the reference; near-duplicate of ux-models-help-examples-still-best-in-class.md, so consolidate. Note the tension with ux-models-help-duplicate-sections-unstyled.md: copy the content, not the unstyled rendering."
---

# UX: models --help examples and filter docs are excellent (positive)

## Summary

models --help includes Filters, Views, and Examples sections — best-in-class help in the CLI; other primary commands lack this depth.

## Evidence

models --help has Filters/Views/Examples sections with concrete commands.

## Why it matters

Positive pattern to copy to spawn/configure/gaslight help.

## Suggested direction

Template help sections for other top commands.

## Severity

Low

## Area

Models / positive pattern
