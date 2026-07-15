---
severity: low
impact: none
comment: "Positive pattern; duplicate of ux-markdown-read-section-by-number-works.md (same command, different section number). Consolidate. Its value is bounding the wrong-hint bug: lookup by number works, so only the miss path is broken."
---

# UX: plan markdown-read-section by number works (positive)

## Summary

plan markdown-read-section … "2" returns section 2 User-facing shape content correctly.

## Evidence

markdown-read-section by "2" → ## 2. User-facing shape body.

## Why it matters

Positive section selection by number.

## Suggested direction

Keep; fix wrong recovery command on miss.

## Severity

Low

## Area

Plan / positive pattern
