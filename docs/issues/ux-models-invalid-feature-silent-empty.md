---
severity: medium
impact: correctness
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/models.ts:195-201 normalizeRequiredFilter only trims/lowercases and rejects empty (no allow-list); line 325 applies it to --feature and line 392 filters via hasFeature (lines 130-132), which returns false for unknown names, so every model drops and 0 results print silently. Behaviour is real but canonically tracked in ux-models-feature-bogus-silent-empty.md (reproduced: y, recommendation: fix)."
comment: "Contentless duplicate within the silent-filter-validation cluster; retire into ux-models-feature-bogus-silent-empty.md."
---

# UX: Invalid --feature silent empty

## Summary

--feature notreal → 0/341.

## Evidence

models.

## Why it matters

Typo looks empty.

## Suggested direction

Validate enum.

## Severity

Medium

## Area

Models
