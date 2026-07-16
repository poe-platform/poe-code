---
severity: low
impact: none
comment: "Positive pattern, duplicate of ux-harness-run-no-path-says-no-pairs.md which files the same output as a gap; retire into it. The two disagree about one message: this calls it clear, that calls it incomplete. The gap reading is better - 'No harness pairs found' is accurate but terminal, and it uses an error glyph for an empty state."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/harness.ts:700 - resolveDiscoveredHarness throws ValidationError('No harness pairs found.') when discoverProjectThenUserHarnesses returns none, so the quoted text exists but is an error throw, not the praised empty state; duplicate of ux-harness-run-no-path-says-no-pairs.md which files the same output as a usability gap"
---

# UX: harness run with no pairs is clear (positive)

## Summary

harness run with no pairs: No harness pairs found — clear empty state.

## Evidence

■  No harness pairs found.

## Why it matters

Positive empty harness message.

## Suggested direction

Keep; suggest harness new.

## Severity

Low

## Area

Harness / positive pattern
