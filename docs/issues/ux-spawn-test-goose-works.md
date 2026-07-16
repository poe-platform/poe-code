---
severity: low
impact: none
comment: "Positive pattern; consolidate with the other spawn/test-works positives. Its 'never embed sonnet-5 in goose lists' aside is the actionable half and belongs with ux-goose-configure-still-embeds-sonnet-5-in-models-list.md - goose works with a live model while our own configure writes a dead one into its catalog."
reproduced: n
recommendation: no-fix
evidence: "Positive note, no defect: goose test/spawn paths intact at src/providers/goose.ts:339 and :350; sonnet-5 aside tracked in ux-goose-configure-still-embeds-sonnet-5-in-models-list.md"
---

# UX: spawn/test goose with haiku work (positive)

## Summary

spawn goose and test goose with anthropic/claude-haiku-4.5 succeed.

## Evidence

spawn goose → ok; test goose → Tested Goose.

## Why it matters

Positive goose path with valid model.

## Suggested direction

Keep; never embed sonnet-5 in goose lists.

## Severity

Low

## Area

Spawn / positive pattern
