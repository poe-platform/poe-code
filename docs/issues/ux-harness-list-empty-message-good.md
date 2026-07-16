---
severity: low
impact: none
comment: "Duplicate of ux-harness-list-empty-good.md; retire. Its contrast with plan list's empty table chrome is the valuable part and should survive in the plan-list cluster (ux-plan-list-empty-table-no-message.md): a plain message beats an empty bordered table, so harness is the precedent to copy."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/harness.ts:656-660 - executeHarnessList returns early with logger.info('No harness pairs found.') before any table rendering; asserted in src/cli/commands/harness-command.test.ts:1478"
---

# UX: harness list empty message is good (positive)

## Summary

harness list: No harness pairs found — clear empty state (no empty table).

## Evidence

●  No harness pairs found.

## Why it matters

Positive empty list pattern (contrast plan list empty table).

## Suggested direction

Keep; apply to plan list empty kinds.

## Severity

Low

## Area

Harness / positive pattern
