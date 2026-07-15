---
severity: low
impact: none
comment: "Positive pattern; near-duplicate of ux-traces-since-and-source-limit-work.md. Consolidate. Its value is comparative and now well established across the audit: traces has --limit and models does not (ux-models-no-limit-flag-confirmed.md), so the convention exists and only needs propagating."
---

# UX: traces --limit 3 works (positive)

## Summary

traces --limit 3 shows 3 recent traces table (claude/codex/pi) — --limit works on traces (models still lack it).

## Evidence

3-row table with Source/Title/Updated/Cwd

## Why it matters

Positive --limit pattern to copy to models and runtime jobs ls.

## Suggested direction

Keep; apply to models.

## Severity

Low

## Area

Traces / positive pattern
