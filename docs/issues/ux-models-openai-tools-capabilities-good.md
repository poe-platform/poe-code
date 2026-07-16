---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/models.ts:371-409 - filters AND-narrow sequentially (--provider owned_by substring at :372, --tools hasFeature at :409); no defect, positive note"
comment: "Positive pattern; duplicate within the large models filter-composition positive family. Retire into the consolidated note - this family now holds roughly ten near-identical files establishing one fact (filters compose correctly), the single clearest source of count inflation in the audit."
---

# UX: models --provider openai --tools capabilities works (positive)

## Summary

models --view capabilities --provider openai --tools returns 41 tool-capable openai models.

## Evidence

41/341 openai tools models.

## Why it matters

Positive multi-filter composition.

## Suggested direction

Keep.

## Severity

Low

## Area

Models / positive pattern
