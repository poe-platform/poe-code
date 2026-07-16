---
severity: low
impact: none
comment: "Positive pattern; near-duplicate of ux-models-openai-tools-capabilities-good.md (same filter, with and without the capabilities view). Retire into the consolidated filter-composition note."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/models.ts:322-327 provider substring filter and :356-358 tools feature filter chain conjunctively on the same list; no defect described"
---

# UX: models --provider openai --tools works well (positive)

## Summary

models --provider openai --tools returns tool-capable openai models cleanly.

## Evidence

models --provider openai --tools → 41 models with tools.

## Why it matters

Positive multi-filter composition.

## Suggested direction

Keep.

## Severity

Low

## Area

Models / positive pattern
