---
severity: low
impact: none
comment: "Positive pattern; consolidate with the other spawn-works positives. Its useful detail is the Resume line rendering as 'cd /tmp && claude --resume ...' - the resume hint correctly carries the cwd, a nice touch worth preserving in any resume-line rework."
---

# UX: spawn -C /tmp works (positive)

## Summary

spawn with -C /tmp succeeds; Resume line shows cd /tmp && claude --resume — cwd override works.

## Evidence

spawn … -C /tmp → ✓ agent; Resume: cd /tmp && claude --resume …

## Why it matters

Positive cwd override.

## Suggested direction

Keep.

## Severity

Low

## Area

Spawn / positive pattern
