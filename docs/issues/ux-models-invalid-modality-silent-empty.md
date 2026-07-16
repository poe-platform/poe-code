---
severity: medium
impact: correctness
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/models.ts:203-211 parseModalityFilter only trims/lowercases and rejects empty entries, never checks the text/image/audio/video allow-list documented at line 288, so --input smell passes and lines 411-416 filter to 0, printing only '0/341 models' plus line 433 'No models match the given filters.'"
comment: "Contentless duplicate within the silent-filter-validation cluster; retire into ux-models-feature-bogus-silent-empty.md."
---

# UX: Invalid --input silent empty

## Summary

--input smell → 0/341.

## Evidence

models.

## Why it matters

Same class.

## Suggested direction

Validate modalities.

## Severity

Medium

## Area

Models
