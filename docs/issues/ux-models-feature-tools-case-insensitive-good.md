---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/models.ts:196 normalizeRequiredFilter lowercases --feature before src/cli/commands/models.ts:132 hasFeature exact match; positive note, no defect"
comment: "The most useful of the models positives because it establishes a cross-command inconsistency: --feature accepts TOOLS case-insensitively while --mode rejects AUTO (ux-spawn-mode-case-sensitive.md). Cite it from that file as the in-product precedent - enum case handling should be one rule and this is the better half. Keep; do not merge into the generic filter positives."
---

# UX: models --feature TOOLS is case-insensitive (positive)

## Summary

models --feature TOOLS returns 139 tool models same as tools — case-insensitive feature filter.

## Evidence

--feature TOOLS → 139/341 models

## Why it matters

Positive case handling (contrast --mode AUTO).

## Suggested direction

Keep; apply to mode enums.

## Severity

Low

## Area

Models / positive pattern
